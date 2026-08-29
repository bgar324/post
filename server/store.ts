import { z } from "zod";
import {
  AccountIdSchema,
  DraftIdSchema,
  GmailCategorySchema,
  MailStoreSchema,
  MailboxSchema,
  MessageIdSchema,
  ThreadIdSchema,
  type Account,
  type Draft,
  type MailStore,
  type MailThread,
  type Message,
} from "../src/model";
import { pool, query, transaction } from "./db";

const AddressSchema = z.object({ name: z.string(), email: z.string().email() });
const AddressListSchema = z.array(AddressSchema);
const AttachmentListSchema = z.array(z.object({ name: z.string(), size: z.string() }));

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

type AccountRow = {
  id: string;
  email: string;
  display_name: string;
  badge_label: string;
  avatar_url: string | null;
  enabled: boolean;
};

type ThreadRow = {
  id: string;
  account_id: string;
  subject: string;
  snippet: string;
  mailbox_state: string;
  category: string;
  unread: boolean;
  starred: boolean;
  last_message_at: Date | string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  direction: "incoming" | "outgoing";
  from_json: unknown;
  to_json: unknown;
  cc_json: unknown;
  sent_at: Date | string;
  html_body: string | null;
  body: string;
  attachments_json: unknown;
};

type DraftRow = {
  id: string;
  account_id: string;
  origin_kind: "new" | "reply" | "replyAll";
  source_thread_id: string | null;
  to_text: string;
  cc_text: string;
  subject: string;
  body: string;
  updated_at: Date | string;
};

type UserPreferenceRow = {
  default_account_id: string | null;
  last_compose_account_id: string | null;
};

export async function loadMailStore(
  userId: string,
  contentThreadId: string | null = null,
): Promise<MailStore> {
  const [accountRows, threadRows, draftRows, userRows] = await Promise.all([
    query<AccountRow>(
      `select id, email, display_name, badge_label, avatar_url, enabled
       from mail_accounts where user_id = $1 order by created_at`,
      [userId],
    ),
    query<ThreadRow>(
      `select id, account_id, subject, snippet, mailbox_state, category, unread, starred, last_message_at
       from mail_threads as thread
       where user_id = $1
         and exists (select 1 from mail_messages as message where message.thread_id = thread.id)
       order by last_message_at desc
       limit 500`,
      [userId],
    ),
    query<DraftRow>(
      `select id, account_id, origin_kind, source_thread_id, to_text, cc_text, subject, body, updated_at
       from mail_drafts where user_id = $1 order by updated_at desc`,
      [userId],
    ),
    query<UserPreferenceRow>(
      `select default_account_id, last_compose_account_id from app_users where id = $1`,
      [userId],
    ),
  ]);

  const threadIds = threadRows.map((row) => row.id);
  const messageRows: MessageRow[] = threadIds.length === 0
    ? []
    : await query<MessageRow>(
      `select id, thread_id, direction, from_json, to_json, cc_json, sent_at, body,
              case when thread_id = $3 then html_body else null end as html_body,
              attachments_json
       from mail_messages
       where user_id = $1 and thread_id = any($2::text[])
       order by sent_at`,
      [userId, threadIds, contentThreadId],
    );

  const accounts: Account[] = accountRows.map((row) => ({
    id: AccountIdSchema.parse(row.id),
    email: row.email,
    displayName: row.display_name,
    badgeLabel: row.badge_label,
    avatarUrl: row.avatar_url,
    enabled: row.enabled,
  }));

  const messagesByThread = new Map<string, Message[]>();
  for (const row of messageRows) {
    const message: Message = {
      id: MessageIdSchema.parse(row.id),
      direction: row.direction,
      from: AddressSchema.parse(row.from_json),
      to: AddressListSchema.parse(row.to_json),
      cc: AddressListSchema.parse(row.cc_json),
      sentAt: iso(row.sent_at),
      body: row.body,
      htmlBody: row.html_body,
      attachments: AttachmentListSchema.parse(row.attachments_json),
    };
    const existing = messagesByThread.get(row.thread_id);
    if (existing === undefined) messagesByThread.set(row.thread_id, [message]);
    else existing.push(message);
  }

  const threads: MailThread[] = [];
  for (const row of threadRows) {
    const messages = messagesByThread.get(row.id);
    if (messages === undefined || messages.length === 0) continue;
    threads.push({
      id: ThreadIdSchema.parse(row.id),
      accountId: AccountIdSchema.parse(row.account_id),
      subject: row.subject,
      snippet: row.snippet,
      mailbox: MailboxSchema.parse(row.mailbox_state),
      category: GmailCategorySchema.parse(row.category),
      unread: row.unread,
      starred: row.starred,
      lastMessageAt: iso(row.last_message_at),
      messages,
    });
  }

  const drafts: Draft[] = draftRows.map((row) => {
    const sourceThreadId = row.source_thread_id === null ? null : ThreadIdSchema.parse(row.source_thread_id);
    const origin: Draft["origin"] =
      sourceThreadId === null || row.origin_kind === "new"
        ? { kind: "new" }
        : { kind: row.origin_kind, sourceThreadId };
    return {
      id: DraftIdSchema.parse(row.id),
      accountId: AccountIdSchema.parse(row.account_id),
      origin,
      to: row.to_text,
      cc: row.cc_text,
      subject: row.subject,
      body: row.body,
      updatedAt: iso(row.updated_at),
    };
  });

  const preferences = userRows[0];
  const accountIds = new Set(accounts.map((account) => account.id));
  const defaultValue = preferences?.default_account_id;
  const recentValue = preferences?.last_compose_account_id;
  const defaultAccountId = defaultValue !== undefined && defaultValue !== null
    ? AccountIdSchema.safeParse(defaultValue)
    : null;
  const lastComposeAccountId = recentValue !== undefined && recentValue !== null
    ? AccountIdSchema.safeParse(recentValue)
    : null;

  return MailStoreSchema.parse({
    version: 1,
    accounts,
    threads,
    drafts,
    preferences: {
      defaultAccountId:
        defaultAccountId !== null && defaultAccountId.success && accountIds.has(defaultAccountId.data)
          ? defaultAccountId.data
          : accounts[0]?.id ?? null,
      lastComposeAccountId:
        lastComposeAccountId !== null && lastComposeAccountId.success && accountIds.has(lastComposeAccountId.data)
          ? lastComposeAccountId.data
          : null,
    },
  });
}

export async function saveDraft(userId: string, draft: Draft): Promise<void> {
  const sourceThreadId = draft.origin.kind === "new" ? null : draft.origin.sourceThreadId;
  await pool.query(
    `insert into mail_drafts
       (id, user_id, account_id, origin_kind, source_thread_id, to_text, cc_text, subject, body, updated_at)
     select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
     where exists (select 1 from mail_accounts where id = $3 and user_id = $2)
       and ($5::text is null or exists (select 1 from mail_threads where id = $5 and user_id = $2))
     on conflict (id) do update set
       account_id = excluded.account_id,
       origin_kind = excluded.origin_kind,
       source_thread_id = excluded.source_thread_id,
       to_text = excluded.to_text,
       cc_text = excluded.cc_text,
       subject = excluded.subject,
       body = excluded.body,
       updated_at = excluded.updated_at
     where mail_drafts.user_id = excluded.user_id and mail_drafts.sending_at is null`,
    [
      draft.id,
      userId,
      draft.accountId,
      draft.origin.kind,
      sourceThreadId,
      draft.to,
      draft.cc,
      draft.subject,
      draft.body,
      draft.updatedAt,
    ],
  );
}

export async function deleteDraft(userId: string, draftId: string): Promise<void> {
  await pool.query("delete from mail_drafts where id = $1 and user_id = $2", [draftId, userId]);
}

export async function claimDraftForSend(userId: string, draftId: string): Promise<boolean> {
  const result = await pool.query(
    `update mail_drafts set sending_at = now()
     where id = $1 and user_id = $2 and sending_at is null
     returning id`,
    [draftId, userId],
  );
  return result.rowCount === 1;
}

export async function releaseDraftSend(userId: string, draftId: string): Promise<void> {
  await pool.query(
    "update mail_drafts set sending_at = null where id = $1 and user_id = $2",
    [draftId, userId],
  );
}


export async function setDefaultAccount(userId: string, accountId: string): Promise<void> {
  await pool.query(
    `update app_users set default_account_id = $1, updated_at = now()
     where id = $2 and exists (select 1 from mail_accounts where id = $1 and user_id = $2)`,
    [accountId, userId],
  );
}

export async function disconnectAccount(userId: string, accountId: string): Promise<void> {
  await transaction(async (client) => {
    await client.query("delete from mail_accounts where id = $1 and user_id = $2", [accountId, userId]);
    await client.query(
      `update app_users set
         default_account_id = case when default_account_id = $1
           then (select id from mail_accounts where user_id = $2 order by created_at limit 1)
           else default_account_id end,
         last_compose_account_id = case when last_compose_account_id = $1 then null else last_compose_account_id end,
         updated_at = now()
       where id = $2`,
      [accountId, userId],
    );
  });
}

export async function recordLastComposeAccount(userId: string, accountId: string): Promise<void> {
  await pool.query(
    "update app_users set last_compose_account_id = $1, updated_at = now() where id = $2",
    [accountId, userId],
  );
}

