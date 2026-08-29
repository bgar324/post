import type { RefObject } from "react";
import {
  FilePenLine,
  Menu,
  Paperclip,
  Search,
  Star,
  X,
} from "lucide-react";
import type { AppState, Draft, MailThread, ThreadId } from "../model";
import { getAccount, latestMessage, threadHasAttachments } from "../model";
import type { ParsedSearch } from "../search";
import { threadSender, VIEW_TITLES } from "../selectors";
import { AccountBadge } from "./AccountBadge";


type ThreadListProps = {
  state: AppState;
  threads: MailThread[];
  drafts: Draft[];
  parsedSearch: ParsedSearch;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onMenu: () => void;
  onSearchChange: (query: string) => void;
  connectLabel: string;
  onConnect: () => void;
  onOpenThread: (threadId: ThreadId) => void;
  onOpenDraft: (draft: Draft) => void;
  onToggleStar: (threadId: ThreadId) => void;
};

const TIME_FORMAT = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
});
const DATE_FORMAT = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

function displayDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? TIME_FORMAT.format(date)
    : DATE_FORMAT.format(date);
}

export function ThreadList({
  state,
  threads,
  drafts,
  parsedSearch,
  searchInputRef,
  onMenu,
  onSearchChange,
  connectLabel,
  onConnect,
  onOpenThread,
  onOpenDraft,
  onToggleStar,
}: ThreadListProps) {
  if (state.route.kind !== "mailbox") return null;

  const selectedId = state.route.selectedThreadId;
  const currentAccount =
    state.accountFilter === null ? undefined : getAccount(state.store, state.accountFilter);
  const viewTitle = VIEW_TITLES[state.route.view];
  const itemCount = state.route.view === "drafts" ? drafts.length : threads.length;

  return (
    <section className="thread-pane" aria-labelledby="mailbox-title">
      <header className="thread-pane__header">
        <div className="thread-pane__title-row">
          <button className="icon-button mobile-menu" type="button" onClick={onMenu} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <div className="thread-pane__heading">
            <h1 id="mailbox-title">{viewTitle}</h1>
            {currentAccount === undefined ? null : <AccountBadge account={currentAccount} compact />}
          </div>
          <span className="thread-pane__count">{itemCount}</span>
        </div>

        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            value={state.searchQuery}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
            placeholder="Search mail"
            aria-label="Search every account"
            spellCheck="false"
          />
          {state.searchQuery.length > 0 ? (
            <button type="button" onClick={() => onSearchChange("")} aria-label="Clear search">
              <X size={15} />
            </button>
          ) : null}
        </label>

        {parsedSearch.errors.length > 0 ? (
          <p className="search-error">{parsedSearch.errors[0]}</p>
        ) : null}
      </header>


      <div className="thread-list" role="list">
        {state.route.view === "drafts"
          ? drafts.map((draft) => {
              const account = getAccount(state.store, draft.accountId);
              return (
                <article
                  className="draft-row"
                  key={draft.id}
                  role="listitem"
                >
                  <button className="draft-row__main" type="button" onClick={() => onOpenDraft(draft)}>
                    <span className="draft-row__icon"><FilePenLine size={18} /></span>
                    <span className="draft-row__content">
                      <span className="draft-row__topline">
                        <strong>{draft.to.length > 0 ? `To: ${draft.to}` : "No recipient"}</strong>
                        <time>{displayDate(draft.updatedAt)}</time>
                      </span>
                      <span className="draft-row__subject">
                        <em>Draft</em> {draft.subject || "(no subject)"}
                      </span>
                      <span className="draft-row__snippet">{draft.body || "Empty draft"}</span>
                      {account === undefined ? null : <AccountBadge account={account} compact />}
                    </span>
                  </button>
                </article>
              );
            })
          : threads.map((thread) => {
              const account = getAccount(state.store, thread.accountId);
              const lastMessage = latestMessage(thread);
              const selected = selectedId === thread.id;
              return (
                <article
                  className={`thread-row ${thread.unread ? "thread-row--unread" : ""} ${selected ? "thread-row--selected" : ""}`}
                  key={thread.id}
                  role="listitem"
                >
                  <button
                    className="thread-row__main"
                    type="button"
                    onClick={() => onOpenThread(thread.id)}
                    aria-label={`${thread.unread ? "Unread: " : ""}${threadSender(thread)}, ${thread.subject}`}
                  >
                    <span className="thread-row__content">
                      <span className="thread-row__topline">
                        {thread.unread ? <span className="unread-dot" aria-hidden="true" /> : null}
                        <strong>{threadSender(thread)}</strong>
                        <time dateTime={thread.lastMessageAt}>{displayDate(thread.lastMessageAt)}</time>
                      </span>
                      <span className="thread-row__subject">{thread.subject}</span>
                      <span className="thread-row__snippet">{thread.snippet}</span>
                      <span className="thread-row__meta">
                        {account === undefined ? null : <AccountBadge account={account} compact />}
                        {threadHasAttachments(thread) ? (
                          <span className="attachment-mark" title="Has attachment">
                            <Paperclip size={12} />
                          </span>
                        ) : null}
                        {lastMessage.direction === "outgoing" ? <span className="sent-mark">Sent</span> : null}
                      </span>
                    </span>
                  </button>
                  <button
                    className={`thread-row__star ${thread.starred ? "thread-row__star--active" : ""}`}
                    type="button"
                    onClick={() => onToggleStar(thread.id)}
                    aria-label={thread.starred ? "Unstar conversation" : "Star conversation"}
                  >
                    <Star size={16} fill={thread.starred ? "currentColor" : "none"} />
                  </button>
                </article>
              );
            })}

        {itemCount === 0 ? (
          state.store.accounts.length === 0 ? (
            <div className="empty-list connection-empty">
              <button className="primary-button" type="button" onClick={onConnect}>{connectLabel}</button>
            </div>
          ) : (
            <div className="empty-list">
              <h2>{state.searchQuery.length > 0 ? "No results" : "Empty"}</h2>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
