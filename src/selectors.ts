import {
  getAccount,
  getDraft,
  getThread,
  latestMessage,
  type Account,
  type AccountId,
  type AppState,
  type Draft,
  type MailboxView,
  type MailThread,
} from "./model";
import { searchThreads, type ParsedSearch } from "./search";

export type ThreadSelection = {
  threads: MailThread[];
  parsedSearch: ParsedSearch;
};

function isSentThread(thread: MailThread): boolean {
  return (
    thread.mailbox !== "trash" &&
    thread.mailbox !== "spam" &&
    thread.messages.some((message) => message.direction === "outgoing")
  );
}

function enabledAccountIds(state: AppState): Set<AccountId> {
  return new Set(
    state.store.accounts.filter((account) => account.enabled).map((account) => account.id),
  );
}

export function selectVisibleThreads(state: AppState): ThreadSelection {
  if (state.route.kind !== "mailbox" || state.route.view === "drafts") {
    return { threads: [], parsedSearch: { predicates: [], errors: [] } };
  }

  const view = state.route.view;
  const enabledIds = enabledAccountIds(state);
  let threads = state.store.threads.filter((thread) =>
    state.accountFilter === null
      ? enabledIds.has(thread.accountId)
      : thread.accountId === state.accountFilter,
  );

  switch (view) {
    case "inbox":
      threads = threads.filter((thread) => thread.mailbox === "inbox" && thread.category === "primary");
      break;
    case "promotions":
    case "social":
    case "updates":
    case "forums":
      threads = threads.filter(
        (thread) => thread.mailbox === "inbox" && thread.category === view,
      );
      break;
    case "spam":
      threads = threads.filter((thread) => thread.mailbox === "spam");
      break;
    case "starred":
      threads = threads.filter(
        (thread) => thread.starred && thread.mailbox !== "trash" && thread.mailbox !== "spam",
      );
      break;
    case "sent":
      threads = threads.filter(isSentThread);
      break;
    case "archive":
      threads = threads.filter((thread) => thread.mailbox === "archive");
      break;
    case "trash":
      threads = threads.filter((thread) => thread.mailbox === "trash");
      break;
    case "search":
      threads = threads.filter((thread) => thread.mailbox !== "trash" && thread.mailbox !== "spam");
      break;
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }

  const searched = searchThreads(threads, state.store.accounts, state.searchQuery);
  return {
    parsedSearch: searched.parsed,
    threads: searched.threads.toSorted(
      (left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt),
    ),
  };
}

export function selectVisibleDrafts(state: AppState): Draft[] {
  const enabledIds = enabledAccountIds(state);
  return state.store.drafts
    .filter((draft) =>
      state.accountFilter === null
        ? enabledIds.has(draft.accountId)
        : draft.accountId === state.accountFilter,
    )
    .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function selectCurrentThread(state: AppState): MailThread | undefined {
  if (state.route.kind !== "mailbox" || state.route.selectedThreadId === null) return undefined;
  const thread = getThread(state.store, state.route.selectedThreadId);
  if (thread === undefined) return undefined;
  if (state.accountFilter !== null) {
    return thread.accountId === state.accountFilter ? thread : undefined;
  }
  return getAccount(state.store, thread.accountId)?.enabled === true ? thread : undefined;
}

export function selectCurrentDraft(state: AppState): Draft | undefined {
  if (state.composer.kind === "closed") return undefined;
  return getDraft(state.store, state.composer.draftId);
}

export function selectAccountForThread(state: AppState, thread: MailThread): Account | undefined {
  return getAccount(state.store, thread.accountId);
}

export function selectUnreadCount(state: AppState, accountId?: AccountId): number {
  return state.store.threads.filter(
    (thread) =>
      thread.mailbox === "inbox" &&
      thread.unread &&
      (accountId === undefined || thread.accountId === accountId),
  ).length;
}

export function selectViewCount(state: AppState, view: MailboxView): number {
  const enabledIds = enabledAccountIds(state);
  const threads = state.store.threads.filter((thread) => enabledIds.has(thread.accountId));
  if (view === "drafts") {
    return state.store.drafts.filter((draft) => enabledIds.has(draft.accountId)).length;
  }
  if (view === "inbox") {
    return threads.filter((thread) => thread.mailbox === "inbox" && thread.category === "primary").length;
  }
  if (view === "promotions" || view === "social" || view === "updates" || view === "forums") {
    return threads.filter((thread) => thread.mailbox === "inbox" && thread.category === view).length;
  }
  if (view === "spam") return threads.filter((thread) => thread.mailbox === "spam").length;
  if (view === "starred") {
    return threads.filter(
      (thread) => thread.starred && thread.mailbox !== "trash" && thread.mailbox !== "spam",
    ).length;
  }
  if (view === "sent") return threads.filter(isSentThread).length;
  if (view === "archive") return threads.filter((thread) => thread.mailbox === "archive").length;
  if (view === "trash") return threads.filter((thread) => thread.mailbox === "trash").length;
  return 0;
}

export function threadSender(thread: MailThread): string {
  const message = latestMessage(thread);
  if (message.direction === "outgoing") {
    const recipient = message.to[0] ?? message.cc[0];
    const prefix = message.to.length > 0 ? "To" : "Cc";
    return recipient === undefined ? "Sent message" : `${prefix}: ${recipient.name || recipient.email}`;
  }
  return message.from.name || message.from.email;
}


export const VIEW_TITLES: Record<MailboxView, string> = {
  inbox: "Inbox",
  promotions: "Promotions",
  social: "Social",
  updates: "Updates",
  forums: "Forums",
  spam: "Spam",
  starred: "Starred",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  trash: "Trash",
  search: "Search",
};
