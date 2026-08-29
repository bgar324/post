import { randomUUID } from "node:crypto";
import { google, gmail_v1 } from "googleapis";
import type { Credentials } from "google-auth-library";
import { decode } from "html-entities";
import sanitizeHtml from "sanitize-html";
import type { PoolClient } from "pg";
import {
  validateDraftRecipients,
  type Address,
  type Draft,
  type GmailCategory,
} from "../src/model";
import { config } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import { pool, query, transaction } from "./db";
import { recordLastComposeAccount } from "./store";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
];

export function createGoogleOAuthClient() {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

export type GoogleIdentity = {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
};

type AccountCredentialRow = {
  account_id: string;
  email: string;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expiry: Date | null;
};

type GmailThreadAccessRow = {
  id: string;
  account_id: string;
  email: string;
  gmail_thread_id: string;
  mailbox_state: string;
};

type ReplySourceRow = {
  gmail_thread_id: string;
  internet_message_id: string | null;
  references_header: string | null;
};

type DraftProviderRow = {
  gmail_draft_id: string | null;
};
const MESSAGE_CONTENT_CACHE_BYTES = 64 * 1024 * 1024;
const GMAIL_METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Message-ID",
  "References",
];
type GmailBackfillStage = "mail" | "spam" | "trash" | "complete";

function nextBackfillStage(stage: GmailBackfillStage): GmailBackfillStage {
  if (stage === "mail") return "spam";
  if (stage === "spam") return "trash";
  return "complete";
}

function backfillLabel(stage: GmailBackfillStage): "SPAM" | "TRASH" | null {
  if (stage === "spam") return "SPAM";
  if (stage === "trash") return "TRASH";
  return null;
}



function encrypted(value: string | null | undefined): string | null {
  return value === null || value === undefined || value.length === 0 ? null : encryptSecret(value);
}

async function saveCredentialTokens(accountId: string, tokens: Credentials): Promise<void> {
  await pool.query(
    `update gmail_credentials set
       access_token_ciphertext = coalesce($1, access_token_ciphertext),
       refresh_token_ciphertext = coalesce($2, refresh_token_ciphertext),
       token_expiry = coalesce($3, token_expiry),
       scope = coalesce($4, scope),
       updated_at = now()
     where account_id = $5`,
    [
      encrypted(tokens.access_token),
      encrypted(tokens.refresh_token),
      tokens.expiry_date === null || tokens.expiry_date === undefined ? null : new Date(tokens.expiry_date),
      tokens.scope ?? null,
      accountId,
    ],
  );
}

export async function connectGoogleAccount(
  currentUserId: string | null,
  identity: GoogleIdentity,
  tokens: Credentials,
): Promise<{ userId: string; accountId: string }> {
  const result = await transaction(async (client) => {
    const existingAccount = await client.query<{ id: string; user_id: string }>(
      "select id, user_id from mail_accounts where google_sub = $1",
      [identity.sub],
    );
    const existing = existingAccount.rows[0];
    if (currentUserId !== null && existing !== undefined && existing.user_id !== currentUserId) {
      throw new Error("This Gmail account is already connected to another user");
    }
    let userId = currentUserId ?? existing?.user_id ?? null;
    if (userId === null) {
      const created = await client.query<{ id: string }>(
        "insert into app_users (email, display_name) values ($1, $2) returning id",
        [identity.email, identity.name],
      );
      const createdId = created.rows[0]?.id;
      if (createdId === undefined) throw new Error("Could not create user");
      userId = createdId;
    }
    const accountId = existing?.id ?? `acct_${randomUUID()}`;
    const accountResult = await client.query<{ id: string }>(
      `insert into mail_accounts
         (id, user_id, google_sub, email, display_name, badge_label, avatar_url, enabled, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, true, now())
       on conflict (google_sub) do update set
         email = excluded.email,
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         updated_at = now()
       where mail_accounts.user_id = excluded.user_id
       returning id`,
      [accountId, userId, identity.sub, identity.email, identity.name, identity.email.split("@")[0], identity.picture],
    );
    if (accountResult.rows[0] === undefined) {
      throw new Error("This Gmail account belongs to another user");
    }
    await client.query(
      `insert into gmail_credentials
         (account_id, access_token_ciphertext, refresh_token_ciphertext, token_expiry, scope, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (account_id) do update set
         access_token_ciphertext = coalesce(excluded.access_token_ciphertext, gmail_credentials.access_token_ciphertext),
         refresh_token_ciphertext = coalesce(excluded.refresh_token_ciphertext, gmail_credentials.refresh_token_ciphertext),
         token_expiry = coalesce(excluded.token_expiry, gmail_credentials.token_expiry),
         scope = excluded.scope,
         updated_at = now()`,
      [
        accountId,
        encrypted(tokens.access_token),
        encrypted(tokens.refresh_token),
        tokens.expiry_date === null || tokens.expiry_date === undefined ? null : new Date(tokens.expiry_date),
        tokens.scope ?? "",
      ],
    );
    await client.query(
      `update app_users set
         default_account_id = coalesce(default_account_id, $1),
         updated_at = now()
       where id = $2`,
      [accountId, userId],
    );
    return { userId, accountId };
  });
  return result;
}

async function authorizedGmail(userId: string, accountId: string) {
  const rows = await query<AccountCredentialRow>(
    `select a.id as account_id, a.email, c.access_token_ciphertext,
            c.refresh_token_ciphertext, c.token_expiry
     from mail_accounts a join gmail_credentials c on c.account_id = a.id
     where a.id = $1 and a.user_id = $2`,
    [accountId, userId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("Gmail account not found");
  const auth = createGoogleOAuthClient();
  auth.setCredentials({
    access_token: row.access_token_ciphertext === null ? undefined : decryptSecret(row.access_token_ciphertext),
    refresh_token: row.refresh_token_ciphertext === null ? undefined : decryptSecret(row.refresh_token_ciphertext),
    expiry_date: row.token_expiry?.getTime(),
  });
  auth.on("tokens", (tokens) => {
    void saveCredentialTokens(accountId, tokens).catch((error) => {
      console.error("Could not persist refreshed Google tokens", error);
    });
  });
  return { gmail: google.gmail({ version: "v1", auth }), account: row, auth };
}

function decodeBase64Url(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return "";
  return Buffer.from(value, "base64url").toString("utf8");
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | null | undefined, name: string): string {
  const value = headers?.find((item) => item.name?.toLocaleLowerCase() === name.toLocaleLowerCase())?.value;
  return value ?? "";
}

function parseAddresses(value: string): Address[] {
  const addresses: Address[] = [];
  const pattern = /(?:"([^"]*)"|([^,<]*?))?\s*<([^>]+)>|([^,\s]+@[^,\s]+)/g;
  for (const match of value.matchAll(pattern)) {
    const email = (match[3] ?? match[4] ?? "").trim();
    if (!email.includes("@")) continue;
    const name = (match[1] ?? match[2] ?? "").trim();
    addresses.push({ name, email });
  }
  return addresses;
}

function findPart(part: gmail_v1.Schema$MessagePart | undefined, mimeType: string): string {
  if (part === undefined) return "";
  if (part.mimeType === mimeType && part.body?.data !== undefined) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const value = findPart(child, mimeType);
    if (value.length > 0) return value;
  }
  return "";
}

export function htmlToText(value: string): string {
  return decode(
    value
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<\/(?:td|th)>/gi, "\t")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeEmailHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["style"],
      a: ["href", "name", "target", "rel", "title"],
      img: ["src", "alt", "width", "height", "title", "loading", "referrerpolicy"],
      td: ["colspan", "rowspan", "align", "valign"],
      th: ["colspan", "rowspan", "align", "valign"],
    },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([^)]+\)$/i, /^[a-z]+$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([^)]+\)$/i, /^[a-z]+$/i],
        "font-size": [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/],
        "font-style": [/^(?:normal|italic)$/],
        "text-align": [/^(?:left|right|center|justify)$/],
        "text-decoration": [/^(?:none|underline|line-through)$/],
        "line-height": [/^\d+(?:\.\d+)?(?:px|em|rem|%)?$/],
        width: [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        "max-width": [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        height: [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        margin: [/^[\d .%-]+$/],
        padding: [/^[\d .%-]+$/],
      },
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowedSchemesByTag: { img: ["data"] },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy", referrerpolicy: "no-referrer" }),
    },
    exclusiveFilter: (frame) => {
      if (frame.tag !== "img") return false;
      const source = frame.attribs.src?.trim().toLocaleLowerCase() ?? "";
      return source.startsWith("http://") || source.startsWith("https://") || source.startsWith("//");
    },
  });
}

function messageContent(message: gmail_v1.Schema$Message): { text: string; html: string | null } {
  const plain = findPart(message.payload ?? undefined, "text/plain");
  const explicitHtml = findPart(message.payload ?? undefined, "text/html");
  const plainLooksLikeHtml = /<\/?(?:html|body|p|div|table|ul|ol|li|br)\b/i.test(plain);
  const rawHtml = explicitHtml.length > 0 ? explicitHtml : plainLooksLikeHtml ? plain : "";
  const html = rawHtml.length === 0 ? null : sanitizeEmailHtml(rawHtml);
  const text = plain.length > 0 && !plainLooksLikeHtml
    ? decode(plain).replace(/\r\n/g, "\n").trim()
    : htmlToText(html ?? rawHtml);
  return { text, html: html === null || html.length === 0 ? null : html };
}

function attachmentMetadata(part: gmail_v1.Schema$MessagePart | undefined): Array<{ name: string; size: string }> {
  if (part === undefined) return [];
  const output: Array<{ name: string; size: string }> = [];
  if ((part.filename ?? "").length > 0) {
    const bytes = part.body?.size ?? 0;
    const size = bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    output.push({ name: part.filename ?? "attachment", size });
  }
  for (const child of part.parts ?? []) output.push(...attachmentMetadata(child));
  return output;
}

function gmailCategory(labels: Set<string>): GmailCategory {
  if (labels.has("CATEGORY_PROMOTIONS")) return "promotions";
  if (labels.has("CATEGORY_SOCIAL")) return "social";
  if (labels.has("CATEGORY_UPDATES")) return "updates";
  if (labels.has("CATEGORY_FORUMS")) return "forums";
  return "primary";
}

async function upsertGmailThread(
  client: PoolClient,
  userId: string,
  accountId: string,
  accountEmail: string,
  thread: gmail_v1.Schema$Thread,
  cacheContent = true,
): Promise<string | null> {
  const gmailThreadId = thread.id;
  if (gmailThreadId === null || gmailThreadId === undefined) {
    throw new Error("Gmail returned a thread without an ID");
  }
  const messages = (thread.messages ?? [])
    .filter((message) => !(message.labelIds ?? []).includes("DRAFT"))
    .toSorted((left, right) => Number(left.internalDate ?? 0) - Number(right.internalDate ?? 0));
  const latest = messages.at(-1);
  if (latest === undefined) {
    await client.query(
      "delete from mail_threads where account_id = $1 and gmail_thread_id = $2",
      [accountId, gmailThreadId],
    );
    return null;
  }
  const allLabels = new Set(messages.flatMap((message) => message.labelIds ?? []));
  const hasIncoming = messages.some((message) => {
    const from = parseAddresses(header(message.payload?.headers, "From"))[0];
    return from?.email.toLocaleLowerCase() !== accountEmail.toLocaleLowerCase();
  });
  const mailbox = allLabels.has("SPAM")
    ? "spam"
    : allLabels.has("TRASH")
      ? "trash"
      : allLabels.has("INBOX")
        ? "inbox"
        : hasIncoming
          ? "archive"
          : "sent";
  const category = gmailCategory(allLabels);
  const subject = header(latest.payload?.headers, "Subject") || "(no subject)";
  const sentAt = new Date(Number(latest.internalDate ?? Date.now()));
  const existing = await client.query<{ id: string }>(
    "select id from mail_threads where account_id = $1 and gmail_thread_id = $2",
    [accountId, gmailThreadId],
  );
  const threadId = existing.rows[0]?.id ?? `thread_${randomUUID()}`;
  await client.query(
    `insert into mail_threads
       (id, user_id, account_id, gmail_thread_id, subject, snippet, mailbox_state,
        category, unread, starred, last_message_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     on conflict (account_id, gmail_thread_id) do update set
       subject = excluded.subject,
       snippet = excluded.snippet,
       mailbox_state = excluded.mailbox_state,
       category = excluded.category,
       unread = excluded.unread,
       starred = excluded.starred,
       last_message_at = excluded.last_message_at,
       updated_at = now()`,
    [
      threadId,
      userId,
      accountId,
      gmailThreadId,
      subject,
      decode(latest.snippet ?? ""),
      mailbox,
      category,
      allLabels.has("UNREAD"),
      allLabels.has("STARRED"),
      sentAt,
    ],
  );

  const gmailMessageIds: string[] = [];
  for (const item of messages) {
    if (item.id === null || item.id === undefined) continue;
    gmailMessageIds.push(item.id);
    const headers = item.payload?.headers;
    const from = parseAddresses(header(headers, "From"))[0] ?? { name: "", email: accountEmail };
    const direction = from.email.toLocaleLowerCase() === accountEmail.toLocaleLowerCase()
      ? "outgoing"
      : "incoming";
    const content = cacheContent ? messageContent(item) : { text: "", html: null };
    const existingMessage = await client.query<{ id: string }>(
      "select id from mail_messages where account_id = $1 and gmail_message_id = $2",
      [accountId, item.id],
    );
    const messageId = existingMessage.rows[0]?.id ?? `msg_${randomUUID()}`;
    await client.query(
      `insert into mail_messages
         (id, user_id, account_id, thread_id, gmail_message_id, direction, from_json,
          to_json, cc_json, sent_at, body, html_body, internet_message_id, references_header,
          attachments_json, content_version, content_cached_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
               $10, $11, $12, $13, $14, $15::jsonb,
               case when $16 then 1 else 0 end,
               case when $16 then now() else null end,
               now())
       on conflict (account_id, gmail_message_id) do update set
         thread_id = excluded.thread_id,
         direction = excluded.direction,
         from_json = excluded.from_json,
         to_json = excluded.to_json,
         cc_json = excluded.cc_json,
         sent_at = excluded.sent_at,
         body = case when $16 then excluded.body else mail_messages.body end,
         html_body = case when $16 then excluded.html_body else mail_messages.html_body end,
         internet_message_id = excluded.internet_message_id,
         references_header = excluded.references_header,
         attachments_json = case
           when $16 then excluded.attachments_json
           else mail_messages.attachments_json
         end,
         content_version = case when $16 then 1 else mail_messages.content_version end,
         content_cached_at = case when $16 then now() else mail_messages.content_cached_at end,
         updated_at = now()`,
      [
        messageId,
        userId,
        accountId,
        threadId,
        item.id,
        direction,
        JSON.stringify(from),
        JSON.stringify(parseAddresses(header(headers, "To"))),
        JSON.stringify(parseAddresses(header(headers, "Cc"))),
        new Date(Number(item.internalDate ?? Date.now())),
        content.text,
        content.html,
        header(headers, "Message-ID") || null,
        header(headers, "References") || null,
        JSON.stringify(cacheContent ? attachmentMetadata(item.payload ?? undefined) : []),
        cacheContent,
      ],
    );
  }
  if (gmailMessageIds.length > 0) {
    await client.query(
      "delete from mail_messages where thread_id = $1 and not (gmail_message_id = any($2::text[]))",
      [threadId, gmailMessageIds],
    );
  }
  return threadId;
}
async function pruneCachedMessageContent(
  client: PoolClient,
  userId: string,
  protectedThreadId: string | null = null,
): Promise<void> {
  await client.query(
    `with ranked as (
       select
         id,
         thread_id,
         sum(
           pg_column_size(body)::bigint + coalesce(pg_column_size(html_body), 0)::bigint
         ) over (order by content_cached_at desc, id) as cumulative_bytes
       from mail_messages
       where user_id = $1 and content_cached_at is not null
     ),
     stale as (
       select id from ranked
       where cumulative_bytes > $2
         and ($3::text is null or thread_id <> $3)
     )
     update mail_messages as message set
       body = '',
       html_body = null,
       content_version = 0,
       content_cached_at = null,
       updated_at = now()
     from stale
     where message.id = stale.id`,
    [userId, MESSAGE_CONTENT_CACHE_BYTES, protectedThreadId],
  );
}


async function syncGmailDrafts(
  userId: string,
  accountId: string,
  gmail: gmail_v1.Gmail,
): Promise<void> {
  const gmailDraftIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const listed = await gmail.users.drafts.list({ userId: "me", maxResults: 500, pageToken });
    const draftIds = (listed.data.drafts ?? []).flatMap((draft) => draft.id ?? []);
    gmailDraftIds.push(...draftIds);
    for (let index = 0; index < draftIds.length; index += 10) {
      const batch = await Promise.all(
        draftIds.slice(index, index + 10).map((id) =>
          gmail.users.drafts.get({ userId: "me", id, format: "full" }),
        ),
      );
      await transaction(async (client) => {
        for (const result of batch) {
          const gmailDraftId = result.data.id;
          const message = result.data.message;
          if (gmailDraftId === null || gmailDraftId === undefined || message === undefined) continue;
          const headers = message.payload?.headers;
          const content = messageContent(message);
          const existing = await client.query<{ id: string }>(
            "select id from mail_drafts where account_id = $1 and gmail_draft_id = $2",
            [accountId, gmailDraftId],
          );
          const source = message.threadId === null || message.threadId === undefined
            ? undefined
            : (await client.query<{ id: string }>(
                "select id from mail_threads where account_id = $1 and gmail_thread_id = $2",
                [accountId, message.threadId],
              )).rows[0];
          const draftId = existing.rows[0]?.id ?? `draft_${randomUUID()}`;
          await client.query(
            `insert into mail_drafts
               (id, user_id, account_id, origin_kind, source_thread_id, to_text, cc_text,
                subject, body, gmail_draft_id, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             on conflict (id) do update set
               origin_kind = excluded.origin_kind,
               source_thread_id = excluded.source_thread_id,
               to_text = excluded.to_text,
               cc_text = excluded.cc_text,
               subject = excluded.subject,
               body = excluded.body,
               gmail_draft_id = excluded.gmail_draft_id,
               updated_at = excluded.updated_at
             where mail_drafts.user_id = excluded.user_id and mail_drafts.sending_at is null`,
            [
              draftId,
              userId,
              accountId,
              source === undefined ? "new" : "reply",
              source?.id ?? null,
              decode(header(headers, "To")),
              decode(header(headers, "Cc")),
              decode(header(headers, "Subject")),
              content.text,
              gmailDraftId,
              new Date(Number(message.internalDate ?? Date.now())),
            ],
          );
        }
      });
    }
    pageToken = listed.data.nextPageToken ?? undefined;
  } while (pageToken !== undefined);

  if (gmailDraftIds.length === 0) {
    await pool.query(
      "delete from mail_drafts where account_id = $1 and gmail_draft_id is not null and sending_at is null",
      [accountId],
    );
  } else {
    await pool.query(
      `delete from mail_drafts
       where account_id = $1 and gmail_draft_id is not null and sending_at is null
         and not (gmail_draft_id = any($2::text[]))`,
      [accountId, gmailDraftIds],
    );
  }
}

export async function syncGmailThread(
  userId: string,
  accountId: string,
  gmailThreadId: string,
): Promise<string> {
  const { gmail, account } = await authorizedGmail(userId, accountId);
  const response = await gmail.users.threads.get({ userId: "me", id: gmailThreadId, format: "full" });
  const threadId = await transaction(async (client) => {
    const syncedThreadId = await upsertGmailThread(
      client,
      userId,
      accountId,
      account.email,
      response.data,
    );
    await pruneCachedMessageContent(client, userId, syncedThreadId);
    return syncedThreadId;
  });
  if (threadId === null) throw new Error("Gmail thread contains only drafts");
  return threadId;
}

export async function syncGmailAccount(userId: string, accountId: string): Promise<void> {
  const { gmail, account } = await authorizedGmail(userId, accountId);
  const [recent, trash, spam, profile] = await Promise.all([
    gmail.users.threads.list({ userId: "me", maxResults: 100 }),
    gmail.users.threads.list({ userId: "me", labelIds: ["TRASH"], maxResults: 25, includeSpamTrash: true }),
    gmail.users.threads.list({ userId: "me", labelIds: ["SPAM"], maxResults: 25, includeSpamTrash: true }),
    gmail.users.getProfile({ userId: "me" }),
  ]);
  const ids = [...new Set([
    ...(recent.data.threads ?? []).flatMap((thread) => thread.id ?? []),
    ...(trash.data.threads ?? []).flatMap((thread) => thread.id ?? []),
    ...(spam.data.threads ?? []).flatMap((thread) => thread.id ?? []),
  ])];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const fetched = await Promise.all(
      batch.map((id) => gmail.users.threads.get({ userId: "me", id, format: "full" })),
    );
    await transaction(async (client) => {
      for (const response of fetched) {
        await upsertGmailThread(client, userId, accountId, account.email, response.data);
      }
      await pruneCachedMessageContent(client, userId);
    });
  }
  await syncGmailDrafts(userId, accountId, gmail);
  await pool.query(
    `update mail_accounts set gmail_history_id = $1, last_synced_at = now(), updated_at = now()
     where id = $2 and user_id = $3`,
    [profile.data.historyId ?? null, accountId, userId],
  );
}

export async function backfillGmailAccount(
  userId: string,
  accountId: string,
  maxPages = Number.POSITIVE_INFINITY,
): Promise<void> {
  const { gmail, account } = await authorizedGmail(userId, accountId);
  const rows = await query<{
    gmail_backfill_page_token: string | null;
    gmail_backfill_stage: GmailBackfillStage;
  }>(
    `select gmail_backfill_page_token, gmail_backfill_stage
     from mail_accounts where id = $1 and user_id = $2`,
    [accountId, userId],
  );
  const state = rows[0];
  if (state === undefined || state.gmail_backfill_stage === "complete") return;

  let stage: GmailBackfillStage = state.gmail_backfill_stage;
  let pageToken = state.gmail_backfill_page_token ?? undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const labelId = backfillLabel(stage);
    const listed = await gmail.users.threads.list({
      userId: "me",
      maxResults: 500,
      pageToken,
      ...(labelId === null
        ? {}
        : {
            labelIds: [labelId],
            includeSpamTrash: true,
          }),
    });
    const ids = (listed.data.threads ?? []).flatMap((thread) => thread.id ?? []);
    for (let index = 0; index < ids.length; index += 10) {
      const batch = await Promise.all(
        ids.slice(index, index + 10).map((id) =>
          gmail.users.threads.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: GMAIL_METADATA_HEADERS,
          }),
        ),
      );
      await transaction(async (client) => {
        for (const response of batch) {
          await upsertGmailThread(client, userId, accountId, account.email, response.data, false);
        }
      });
    }

    const nextPageToken = listed.data.nextPageToken ?? undefined;
    if (nextPageToken === undefined) stage = nextBackfillStage(stage);
    pageToken = nextPageToken;
    await pool.query(
      `update mail_accounts set
         gmail_backfill_page_token = $1,
         gmail_backfill_stage = $2,
         last_synced_at = now(),
         updated_at = now()
       where id = $3 and user_id = $4`,
      [pageToken ?? null, stage, accountId, userId],
    );
    if (stage === "complete") return;
  }
}

async function threadAccess(userId: string, threadId: string): Promise<GmailThreadAccessRow> {
  const rows = await query<GmailThreadAccessRow>(
    `select t.id, t.account_id, a.email, t.gmail_thread_id, t.mailbox_state
     from mail_threads t join mail_accounts a on a.id = t.account_id
     where t.id = $1 and t.user_id = $2`,
    [threadId, userId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("Thread not found");
  return row;
}

export async function mutateGmailThread(
  userId: string,
  threadId: string,
  mutation: "archive" | "inbox" | "trash" | "read" | "unread" | "star" | "unstar",
): Promise<void> {
  const access = await threadAccess(userId, threadId);
  const { gmail } = await authorizedGmail(userId, access.account_id);
  if (mutation === "trash") {
    await gmail.users.threads.trash({ userId: "me", id: access.gmail_thread_id });
  } else if (mutation === "inbox" && access.mailbox_state === "trash") {
    await gmail.users.threads.untrash({ userId: "me", id: access.gmail_thread_id });
    await gmail.users.threads.modify({
      userId: "me",
      id: access.gmail_thread_id,
      requestBody: { addLabelIds: ["INBOX"] },
    });

  } else {
    const addLabelIds: string[] = [];
    const removeLabelIds: string[] = [];
    if (mutation === "inbox" && access.mailbox_state === "spam") removeLabelIds.push("SPAM");
    if (mutation === "inbox") addLabelIds.push("INBOX");
    if (mutation === "archive") removeLabelIds.push("INBOX");
    if (mutation === "read") removeLabelIds.push("UNREAD");
    if (mutation === "unread") addLabelIds.push("UNREAD");
    if (mutation === "star") addLabelIds.push("STARRED");
    if (mutation === "unstar") removeLabelIds.push("STARRED");
    await gmail.users.threads.modify({
      userId: "me",
      id: access.gmail_thread_id,
      requestBody: { addLabelIds, removeLabelIds },
    });
  }
  await syncGmailThread(userId, access.account_id, access.gmail_thread_id);
}
export async function refreshGmailThread(userId: string, threadId: string): Promise<void> {
  const access = await threadAccess(userId, threadId);
  await syncGmailThread(userId, access.account_id, access.gmail_thread_id);
}

export async function revokeGmailAccount(userId: string, accountId: string): Promise<void> {
  const { auth } = await authorizedGmail(userId, accountId);
  const token = auth.credentials.refresh_token ?? auth.credentials.access_token;
  if (token === null || token === undefined) return;
  try {
    await auth.revokeToken(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("invalid_token") || message.includes("expired or revoked")) return;
    throw error;
  }
}

function cleanHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function formatAddress(address: Address): string {
  const name = cleanHeader(address.name).replace(/"/g, "\\\"");
  return name.length === 0 ? address.email : `"${name}" <${address.email}>`;
}

function encodedSubject(value: string): string {
  const clean = cleanHeader(value);
  return /^[\x20-\x7E]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function rawMessage(
  from: string,
  to: Address[],
  cc: Address[],
  subject: string,
  body: string,
  replyHeaders: { messageId: string | null; references: string | null },
): string {
  const headers = [
    `From: ${from}`,
    `To: ${to.map(formatAddress).join(", ")}`,
    ...(cc.length === 0 ? [] : [`Cc: ${cc.map(formatAddress).join(", ")}`]),
    `Subject: ${encodedSubject(subject)}`,
    ...(replyHeaders.messageId === null ? [] : [`In-Reply-To: ${cleanHeader(replyHeaders.messageId)}`]),
    ...(replyHeaders.messageId === null
      ? []
      : [`References: ${cleanHeader([replyHeaders.references, replyHeaders.messageId].filter(Boolean).join(" "))}`]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  const encodedBody = Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${encodedBody}`, "utf8").toString("base64url");
}

export class GmailSendFailure extends Error {
  constructor(message: string, readonly safeToRetry: boolean, cause: unknown) {
    super(message, { cause });
  }
}

function providerReturnedError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "response" in error && error.response != null;
}

export async function sendGmailDraft(userId: string, draft: Draft): Promise<string> {
  const validation = validateDraftRecipients(draft);
  if (validation.kind !== "valid") throw new Error("Draft has invalid recipients");
  const { gmail, account } = await authorizedGmail(userId, draft.accountId);
  const providerDraftRows = await query<DraftProviderRow>(
    "select gmail_draft_id from mail_drafts where id = $1 and user_id = $2 and account_id = $3",
    [draft.id, userId, draft.accountId],
  );
  const gmailDraftId = providerDraftRows[0]?.gmail_draft_id ?? null;
  let source: ReplySourceRow | undefined;
  if (draft.origin.kind !== "new") {
    const rows = await query<ReplySourceRow>(
      `select t.gmail_thread_id, m.internet_message_id, m.references_header
       from mail_threads t
       left join lateral (
         select internet_message_id, references_header from mail_messages
         where thread_id = t.id order by sent_at desc limit 1
       ) m on true
       where t.id = $1 and t.user_id = $2 and t.account_id = $3 and t.mailbox_state <> 'trash'`,
      [draft.origin.sourceThreadId, userId, draft.accountId],
    );
    source = rows[0];
  }
  let response: gmail_v1.Schema$Message;
  try {
    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: rawMessage(
          account.email,
          validation.to,
          validation.cc,
          draft.subject,
          draft.body,
          {
            messageId: source?.internet_message_id ?? null,
            references: source?.references_header ?? null,
          },
        ),
        threadId: source?.gmail_thread_id,
      },
    });
    response = result.data;
  } catch (error) {
    throw new GmailSendFailure("Gmail send failed", providerReturnedError(error), error);
  }
  const gmailThreadId = response.threadId;
  if (gmailThreadId === null || gmailThreadId === undefined) {
    throw new GmailSendFailure("Gmail accepted the message without a thread ID", false, undefined);
  }
  if (gmailDraftId !== null) {
    await gmail.users.drafts.delete({ userId: "me", id: gmailDraftId }).catch((error) => {
      throw new GmailSendFailure("Gmail sent the message but could not remove its draft", false, error);
    });
  }
  try {
    await Promise.all([
      pool.query("delete from mail_drafts where id = $1 and user_id = $2", [draft.id, userId]),
      recordLastComposeAccount(userId, draft.accountId),
    ]);
    return await syncGmailThread(userId, draft.accountId, gmailThreadId);
  } catch (error) {
    throw new GmailSendFailure("Gmail sent the message but local reconciliation failed", false, error);
  }
}
