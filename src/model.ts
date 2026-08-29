import { z } from "zod";

export const AccountIdSchema = z.string().startsWith("acct_").brand<"AccountId">();
export const ThreadIdSchema = z.string().startsWith("thread_").brand<"ThreadId">();
export const MessageIdSchema = z.string().startsWith("msg_").brand<"MessageId">();
export const DraftIdSchema = z.string().startsWith("draft_").brand<"DraftId">();

export type AccountId = z.infer<typeof AccountIdSchema>;
export type ThreadId = z.infer<typeof ThreadIdSchema>;
export type MessageId = z.infer<typeof MessageIdSchema>;
export type DraftId = z.infer<typeof DraftIdSchema>;

const AddressSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

const AttachmentSchema = z.object({
  name: z.string(),
  size: z.string(),
});


const AccountSchema = z.object({
  id: AccountIdSchema,
  email: z.string().email(),
  displayName: z.string(),
  badgeLabel: z.string(),
  avatarUrl: z.string().url().nullable().default(null),
  enabled: z.boolean(),
});

const MessageSchema = z.object({
  id: MessageIdSchema,
  direction: z.enum(["incoming", "outgoing"]),
  from: AddressSchema,
  to: z.array(AddressSchema),
  cc: z.array(AddressSchema),
  sentAt: z.string(),
  body: z.string(),
  htmlBody: z.string().nullable().default(null),
  attachments: z.array(AttachmentSchema),
});

export const MailboxSchema = z.enum(["inbox", "archive", "trash", "sent", "spam"]);
export const GmailCategorySchema = z.enum(["primary", "promotions", "social", "updates", "forums"]);

const ThreadSchema = z.object({
  id: ThreadIdSchema,
  accountId: AccountIdSchema,
  subject: z.string(),
  snippet: z.string(),
  mailbox: MailboxSchema,
  category: GmailCategorySchema.default("primary"),
  unread: z.boolean(),
  starred: z.boolean(),
  lastMessageAt: z.string(),
  messages: z.array(MessageSchema).min(1),
});

const DraftOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }),
  z.object({ kind: z.literal("reply"), sourceThreadId: ThreadIdSchema }),
  z.object({ kind: z.literal("replyAll"), sourceThreadId: ThreadIdSchema }),
]);

const DraftSchema = z.object({
  id: DraftIdSchema,
  accountId: AccountIdSchema,
  origin: DraftOriginSchema,
  to: z.string(),
  cc: z.string(),
  subject: z.string(),
  body: z.string(),
  updatedAt: z.string(),
});

const PreferencesSchema = z.object({
  defaultAccountId: AccountIdSchema.nullable(),
  lastComposeAccountId: AccountIdSchema.nullable(),
});

export const MailStoreSchema = z.object({
  version: z.literal(1),
  accounts: z.array(AccountSchema),
  threads: z.array(ThreadSchema),
  drafts: z.array(DraftSchema),
  preferences: PreferencesSchema,
});

export type Address = z.infer<typeof AddressSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Mailbox = z.infer<typeof MailboxSchema>;
export type GmailCategory = z.infer<typeof GmailCategorySchema>;
export type MailThread = z.infer<typeof ThreadSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type MailStore = z.infer<typeof MailStoreSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;

export const emptyStore: MailStore = MailStoreSchema.parse({
  version: 1,
  accounts: [],
  threads: [],
  drafts: [],
  preferences: { defaultAccountId: null, lastComposeAccountId: null },
});

export const MailboxViewSchema = z.enum([
  "inbox",
  "promotions",
  "social",
  "updates",
  "forums",
  "spam",
  "starred",
  "sent",
  "drafts",
  "archive",
  "trash",
  "search",
]);

export type MailboxView = z.infer<typeof MailboxViewSchema>;

export type Route =
  | {
      kind: "mailbox";
      view: MailboxView;
      selectedThreadId: ThreadId | null;
    }
  | { kind: "settings" };

export type ComposerState =
  | { kind: "closed" }
  | { kind: "editing"; draftId: DraftId }
  | {
      kind: "confirmIdentity";
      draftId: DraftId;
      targetAccountId: AccountId;
    };

export type Toast =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export type AppState = {
  store: MailStore;
  route: Route;
  accountFilter: AccountId | null;
  searchQuery: string;
  composer: ComposerState;
  sidebarOpen: boolean;
  shortcutHelpOpen: boolean;
  toast: Toast | null;
};

export type DraftPatch = Partial<Pick<Draft, "to" | "cc" | "subject" | "body">>;

export type AppAction =
  | { type: "replaceStore"; store: MailStore }
  | { type: "navigate"; route: Route }
  | { type: "filterAccount"; accountId: AccountId | null }
  | { type: "setSearch"; query: string }
  | { type: "toggleSidebar"; open?: boolean }
  | { type: "toggleShortcutHelp"; open?: boolean }
  | { type: "threadRead"; threadId: ThreadId; read: boolean }
  | { type: "threadStar"; threadId: ThreadId }
  | { type: "threadMove"; threadId: ThreadId; mailbox: "inbox" | "archive" | "trash" }
  | { type: "composeNew"; draftId: DraftId; now: string }
  | {
      type: "composeFromThread";
      draftId: DraftId;
      threadId: ThreadId;
      mode: "reply" | "replyAll";
      now: string;
    }
  | { type: "draftOpen"; draftId: DraftId }
  | { type: "draftPatch"; draftId: DraftId; patch: DraftPatch; now: string }
  | { type: "draftClose" }
  | { type: "draftDelete"; draftId: DraftId }
  | { type: "draftRequestIdentity"; draftId: DraftId; targetAccountId: AccountId }
  | { type: "draftCancelIdentity" }
  | { type: "draftConfirmIdentity" }
  | {
      type: "draftSend";
      draftId: DraftId;
      threadId: ThreadId;
      messageId: MessageId;
      now: string;
    }
  | { type: "accountEnabled"; accountId: AccountId; enabled: boolean }
  | { type: "accountRemove"; accountId: AccountId }
  | { type: "preferenceDefault"; accountId: AccountId }
  | { type: "toast"; toast: Toast | null };


export function createDraftId(): DraftId {
  return DraftIdSchema.parse(`draft_${crypto.randomUUID()}`);
}

export function createThreadId(): ThreadId {
  return ThreadIdSchema.parse(`thread_${crypto.randomUUID()}`);
}

export function createMessageId(): MessageId {
  return MessageIdSchema.parse(`msg_${crypto.randomUUID()}`);
}


export function routeFromHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "settings") return { kind: "settings" };

  const parsedView = MailboxViewSchema.safeParse(parts[0] ?? "inbox");
  const view = parsedView.success ? parsedView.data : "inbox";
  const threadPart = parts[1] === "thread" ? parts[2] : undefined;
  const parsedThread = ThreadIdSchema.safeParse(threadPart);

  return {
    kind: "mailbox",
    view,
    selectedThreadId: parsedThread.success ? parsedThread.data : null,
  };
}

export function routeToHash(route: Route): string {
  if (route.kind === "settings") return "#/settings";
  const thread = route.selectedThreadId === null ? "" : `/thread/${route.selectedThreadId}`;
  return `#/${route.view}${thread}`;
}

export function createInitialState(store: MailStore, route: Route): AppState {
  return {
    store,
    route,
    accountFilter: null,
    searchQuery: "",
    composer: { kind: "closed" },
    sidebarOpen: false,
    shortcutHelpOpen: false,
    toast: null,
  };
}

function resolveComposeAccount(state: AppState): AccountId | undefined {
  const recent = state.store.preferences.lastComposeAccountId;
  if (recent !== null && state.store.accounts.some((account) => account.id === recent)) {
    return recent;
  }
  const filtered = state.accountFilter;
  if (filtered !== null && state.store.accounts.some((account) => account.id === filtered)) {
    return filtered;
  }
  return state.store.preferences.defaultAccountId ?? undefined;
}


function uniqueRecipientString(addresses: Address[], excludedEmails: string[]): string {
  const seen = new Set(excludedEmails.map((email) => email.toLocaleLowerCase()));
  const values: string[] = [];
  for (const address of addresses) {
    const normalized = address.email.toLocaleLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(address.name.length > 0 ? `${address.name} <${address.email}>` : address.email);
  }
  return values.join(", ");
}

function recipientAddress(value: string): Address | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const angle = /^(.*?)\s*<([^>]+)>$/.exec(trimmed);
  if (angle !== null) {
    const email = angle[2]?.trim() ?? "";
    const name = angle[1]?.trim() ?? "";
    if (z.string().email().safeParse(email).success) return { name, email };
  }
  if (z.string().email().safeParse(trimmed).success) return { name: "", email: trimmed };
  return null;
}

export type RecipientValidation =
  | { kind: "valid"; to: Address[]; cc: Address[] }
  | { kind: "empty" }
  | { kind: "invalid"; values: [string, ...string[]] };

export function validateDraftRecipients(
  draft: Pick<Draft, "to" | "cc">,
): RecipientValidation {
  const to: Address[] = [];
  const cc: Address[] = [];
  const invalid: string[] = [];
  for (const [value, target] of [[draft.to, to], [draft.cc, cc]] as const) {
    for (const part of value.split(",")) {
      const token = part.trim();
      if (token.length === 0) continue;
      const parsed = recipientAddress(token);
      if (parsed === null) invalid.push(token);
      else target.push(parsed);
    }
  }
  const firstInvalid = invalid[0];
  if (firstInvalid !== undefined) {
    return { kind: "invalid", values: [firstInvalid, ...invalid.slice(1)] };
  }
  if (to.length + cc.length === 0) return { kind: "empty" };
  return { kind: "valid", to, cc };
}

function updateThread(
  threads: MailThread[],
  threadId: ThreadId,
  update: (thread: MailThread) => MailThread,
): MailThread[] {
  return threads.map((thread) => (thread.id === threadId ? update(thread) : thread));
}

function findAccount(store: MailStore, accountId: AccountId): Account | undefined {
  return store.accounts.find((account) => account.id === accountId);
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "replaceStore":
      return { ...state, store: action.store };
    case "navigate":
      return { ...state, route: action.route, sidebarOpen: false };
    case "filterAccount":
      return { ...state, accountFilter: action.accountId, sidebarOpen: false };
    case "setSearch":
      return { ...state, searchQuery: action.query };
    case "toggleSidebar":
      return { ...state, sidebarOpen: action.open ?? !state.sidebarOpen };
    case "toggleShortcutHelp":
      return { ...state, shortcutHelpOpen: action.open ?? !state.shortcutHelpOpen };
    case "threadRead":
      return {
        ...state,
        store: {
          ...state.store,
          threads: updateThread(state.store.threads, action.threadId, (thread) => ({
            ...thread,
            unread: !action.read,
          })),
        },
        toast: { kind: "success", message: action.read ? "Marked as read" : "Marked as unread" },
      };
    case "threadStar":
      return {
        ...state,
        store: {
          ...state.store,
          threads: updateThread(state.store.threads, action.threadId, (thread) => ({
            ...thread,
            starred: !thread.starred,
          })),
        },
        toast: { kind: "success", message: "Star updated" },
      };
    case "threadMove":
      return {
        ...state,
        store: {
          ...state.store,
          threads: updateThread(state.store.threads, action.threadId, (thread) => ({
            ...thread,
            mailbox: action.mailbox,
            unread: action.mailbox === "trash" ? false : thread.unread,
          })),
        },
        toast: {
          kind: "success",
          message:
            action.mailbox === "archive"
              ? "Conversation archived"
              : action.mailbox === "trash"
                ? "Conversation moved to trash"
                : "Conversation moved to inbox",
        },
      };
    case "composeNew": {
      const accountId = resolveComposeAccount(state);
      if (accountId === undefined) {
        return { ...state, toast: { kind: "error", message: "Connect a Gmail account first" } };
      }
      const draft: Draft = {
        id: action.draftId,
        accountId,
        origin: { kind: "new" },
        to: "",
        cc: "",
        subject: "",
        body: "",
        updatedAt: action.now,
      };
      return {
        ...state,
        store: { ...state.store, drafts: [draft, ...state.store.drafts] },
        composer: { kind: "editing", draftId: draft.id },
        sidebarOpen: false,
      };
    }
    case "composeFromThread": {
      const thread = state.store.threads.find((item) => item.id === action.threadId);
      if (thread === undefined || thread.mailbox === "trash") return state;
      const account = findAccount(state.store, thread.accountId);
      const lastMessage = thread.messages.at(-1);
      if (account === undefined || lastMessage === undefined) return state;

      const replyRecipients =
        lastMessage.direction === "incoming"
          ? [lastMessage.from]
          : lastMessage.to.length > 0
            ? lastMessage.to
            : lastMessage.cc;
      const replyAllToRecipients = [lastMessage.from, ...lastMessage.to];
      const to =
        action.mode === "replyAll"
          ? uniqueRecipientString(replyAllToRecipients, [account.email])
          : uniqueRecipientString(replyRecipients, [account.email]);
      const cc =
        action.mode === "replyAll"
          ? uniqueRecipientString(lastMessage.cc, [
              account.email,
              ...replyAllToRecipients.map((address) => address.email),
            ])
          : "";
      const draft: Draft = {
        id: action.draftId,
        accountId: thread.accountId,
        origin: { kind: action.mode, sourceThreadId: thread.id },
        to,
        cc,
        subject: thread.subject.toLocaleLowerCase().startsWith("re:")
          ? thread.subject
          : `Re: ${thread.subject}`,
        body: "",
        updatedAt: action.now,
      };
      return {
        ...state,
        store: { ...state.store, drafts: [draft, ...state.store.drafts] },
        composer: { kind: "editing", draftId: draft.id },
      };
    }
    case "draftOpen":
      return { ...state, composer: { kind: "editing", draftId: action.draftId } };
    case "draftPatch":
      return {
        ...state,
        store: {
          ...state.store,
          drafts: state.store.drafts.map((draft) =>
            draft.id === action.draftId
              ? { ...draft, ...action.patch, updatedAt: action.now }
              : draft,
          ),
        },
      };
    case "draftClose":
      return { ...state, composer: { kind: "closed" } };
    case "draftDelete":
      return {
        ...state,
        store: {
          ...state.store,
          drafts: state.store.drafts.filter((draft) => draft.id !== action.draftId),
        },
        composer: { kind: "closed" },
        toast: { kind: "success", message: "Draft discarded" },
      };
    case "draftRequestIdentity": {
      const draft = state.store.drafts.find((item) => item.id === action.draftId);
      if (draft === undefined || draft.accountId === action.targetAccountId) return state;
      const populated =
        draft.origin.kind !== "new" ||
        draft.to.trim().length > 0 ||
        draft.cc.trim().length > 0 ||
        draft.subject.trim().length > 0 ||
        draft.body.trim().length > 0;
      if (populated) {
        return {
          ...state,
          composer: {
            kind: "confirmIdentity",
            draftId: draft.id,
            targetAccountId: action.targetAccountId,
          },
        };
      }
      return {
        ...state,
        store: {
          ...state.store,
          drafts: state.store.drafts.map((item) =>
            item.id === draft.id
              ? { ...item, accountId: action.targetAccountId, origin: { kind: "new" } }
              : item,
          ),
        },
      };
    }
    case "draftCancelIdentity":
      return state.composer.kind === "confirmIdentity"
        ? { ...state, composer: { kind: "editing", draftId: state.composer.draftId } }
        : state;
    case "draftConfirmIdentity": {
      if (state.composer.kind !== "confirmIdentity") return state;
      const { draftId, targetAccountId } = state.composer;
      return {
        ...state,
        store: {
          ...state.store,
          drafts: state.store.drafts.map((draft) =>
            draft.id === draftId
              ? { ...draft, accountId: targetAccountId, origin: { kind: "new" } }
              : draft,
          ),
        },
        composer: { kind: "editing", draftId },
        toast: { kind: "success", message: "Sending identity changed; reply threading detached" },
      };
    }
    case "draftSend": {
      const draft = state.store.drafts.find((item) => item.id === action.draftId);
      if (draft === undefined) return state;
      const account = findAccount(state.store, draft.accountId);
      const recipientValidation = validateDraftRecipients(draft);
      if (account === undefined || recipientValidation.kind !== "valid") {
        return {
          ...state,
          toast: {
            kind: "error",
            message:
              recipientValidation.kind === "invalid"
                ? `Fix invalid recipient “${recipientValidation.values[0]}”`
                : "Add at least one valid recipient",
          },
        };
      }
      const message: Message = {
        id: action.messageId,
        direction: "outgoing",
        from: { name: account.displayName, email: account.email },
        to: recipientValidation.to,
        cc: recipientValidation.cc,
        sentAt: action.now,
        body: draft.body,
        htmlBody: null,
        attachments: [],
      };
      const sourceThreadId =
        draft.origin.kind === "reply" || draft.origin.kind === "replyAll"
          ? draft.origin.sourceThreadId
          : null;
      const sourceThread =
        sourceThreadId === null
          ? undefined
          : state.store.threads.find(
              (item) =>
                item.id === sourceThreadId &&
                item.accountId === draft.accountId &&
                item.mailbox !== "trash",
            );
      let nextThreads: MailThread[];
      let selectedThreadId: ThreadId;
      if (sourceThread !== undefined) {
        nextThreads = state.store.threads.map((item) =>
          item.id === sourceThread.id
            ? {
                ...item,
                snippet: draft.body.trim().slice(0, 140) || "Sent without a message body",
                unread: false,
                lastMessageAt: action.now,
                messages: [...item.messages, message],
              }
            : item,
        );
        selectedThreadId = sourceThread.id;
      } else {
        const thread: MailThread = {
          id: action.threadId,
          accountId: draft.accountId,
          subject: draft.subject.trim().length > 0 ? draft.subject : "(no subject)",
          snippet: draft.body.trim().slice(0, 140) || "Sent without a message body",
          mailbox: "sent",
          category: "primary",
          unread: false,
          starred: false,
          lastMessageAt: action.now,
          messages: [message],
        };
        nextThreads = [thread, ...state.store.threads];
        selectedThreadId = thread.id;
      }
      return {
        ...state,
        store: {
          ...state.store,
          threads: nextThreads,
          drafts: state.store.drafts.filter((item) => item.id !== draft.id),
          preferences: {
            ...state.store.preferences,
            lastComposeAccountId: draft.accountId,
          },
        },
        composer: { kind: "closed" },
        route: { kind: "mailbox", view: "sent", selectedThreadId },
        toast: { kind: "success", message: "Added to local Sent" },
      };
    }
    case "accountEnabled":
      return {
        ...state,
        store: {
          ...state.store,
          accounts: state.store.accounts.map((account) =>
            account.id === action.accountId ? { ...account, enabled: action.enabled } : account,
          ),
        },
      };
    case "accountRemove": {
      const accounts = state.store.accounts.filter((account) => account.id !== action.accountId);
      const nextDefaultAccountId = accounts[0]?.id ?? null;
      const defaultAccountId =
        state.store.preferences.defaultAccountId === action.accountId
          ? nextDefaultAccountId
          : state.store.preferences.defaultAccountId;
      const lastComposeAccountId =
        state.store.preferences.lastComposeAccountId === action.accountId
          ? null
          : state.store.preferences.lastComposeAccountId;
      return {
        ...state,
        store: {
          ...state.store,
          accounts,
          threads: state.store.threads.filter((thread) => thread.accountId !== action.accountId),
          drafts: state.store.drafts.filter((draft) => draft.accountId !== action.accountId),
          preferences: { ...state.store.preferences, defaultAccountId, lastComposeAccountId },
        },
        accountFilter: state.accountFilter === action.accountId ? null : state.accountFilter,
        route: { kind: "settings" },
        toast: { kind: "success", message: "Gmail account disconnected" },
      };
    }
    case "preferenceDefault":
      return {
        ...state,
        store: {
          ...state.store,
          preferences: { ...state.store.preferences, defaultAccountId: action.accountId },
        },
      };
    case "toast":
      return { ...state, toast: action.toast };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function getAccount(store: MailStore, accountId: AccountId): Account | undefined {
  return findAccount(store, accountId);
}

export function getThread(store: MailStore, threadId: ThreadId): MailThread | undefined {
  return store.threads.find((thread) => thread.id === threadId);
}

export function getDraft(store: MailStore, draftId: DraftId): Draft | undefined {
  return store.drafts.find((draft) => draft.id === draftId);
}

export function latestMessage(thread: MailThread): Message {
  const last = thread.messages.at(-1);
  if (last === undefined) throw new Error("Thread schema guarantees at least one message");
  return last;
}

export function threadHasAttachments(thread: MailThread): boolean {
  return thread.messages.some((message) => message.attachments.length > 0);
}
