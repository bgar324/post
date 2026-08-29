import {
  Archive,
  ArrowLeft,
  Mail,
  MailOpen,
  Paperclip,
  Reply,
  ReplyAll,
  Star,
  Trash2,
} from "lucide-react";
import type { Account, MailThread, ThreadId } from "../model";
import { EmailBody } from "./EmailBody";

const MESSAGE_DATE = new Intl.DateTimeFormat("en", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type ThreadReaderProps = {
  thread: MailThread | undefined;
  account: Account | undefined;
  onBack: () => void;
  onMove: (threadId: ThreadId, mailbox: "archive" | "trash" | "inbox") => void;
  onToggleStar: (threadId: ThreadId) => void;
  onSetRead: (threadId: ThreadId, read: boolean) => void;
  onComposeFromThread: (threadId: ThreadId, mode: "reply" | "replyAll") => void;
};

export function ThreadReader({
  thread,
  account,
  onBack,
  onMove,
  onToggleStar,
  onSetRead,
  onComposeFromThread,
}: ThreadReaderProps) {
  if (thread === undefined || account === undefined) return <ReaderWelcome />;
  const moveToInbox = thread.mailbox === "archive" || thread.mailbox === "spam";
  const canReply = thread.mailbox !== "trash" && thread.mailbox !== "spam";

  return (
    <section className="reader-pane" aria-labelledby="thread-subject">
      <div className="reader-toolbar" role="toolbar" aria-label="Conversation actions">
        <button className="icon-button reader-toolbar__back" type="button" onClick={onBack} aria-label="Back to message list">
          <ArrowLeft size={18} />
        </button>
        <div className="reader-toolbar__group">
          <button
            className="toolbar-button"
            type="button"
            onClick={() => onMove(thread.id, moveToInbox ? "inbox" : "archive")}
            aria-label={moveToInbox ? "Move to inbox" : "Archive conversation"}
            title={moveToInbox ? "Move to inbox (e)" : "Archive (e)"}
          >
            {moveToInbox ? <Mail size={16} /> : <Archive size={16} />}
            <span>{moveToInbox ? "Inbox" : "Archive"}</span>
          </button>
          <button
            className="toolbar-button"
            type="button"
            onClick={() => onMove(thread.id, thread.mailbox === "trash" ? "inbox" : "trash")}
            aria-label={thread.mailbox === "trash" ? "Restore conversation" : "Move conversation to trash"}
            title="Trash (#)"
          >
            <Trash2 size={16} />
            <span>{thread.mailbox === "trash" ? "Restore" : "Trash"}</span>
          </button>
          <button
            className={`toolbar-button ${thread.starred ? "toolbar-button--active" : ""}`}
            type="button"
            onClick={() => onToggleStar(thread.id)}
            aria-label={thread.starred ? "Unstar conversation" : "Star conversation"}
            title="Star (s)"
          >
            <Star size={16} fill={thread.starred ? "currentColor" : "none"} />
            <span>{thread.starred ? "Starred" : "Star"}</span>
          </button>
          <button
            className="toolbar-button"
            type="button"
            onClick={() => onSetRead(thread.id, thread.unread)}
            aria-label={thread.unread ? "Mark conversation as read" : "Mark conversation as unread"}
            title="Mark unread (u)"
          >
            {thread.unread ? <MailOpen size={16} /> : <Mail size={16} />}
            <span>{thread.unread ? "Read" : "Unread"}</span>
          </button>
        </div>
        <span className="reader-toolbar__identity">{account.email}</span>
      </div>

      <div className="reader-scroll">
        <header className="thread-heading">
          <h1 id="thread-subject">{thread.subject}</h1>
        </header>

        <div className="message-stack">
          {thread.messages.map((message, index) => {
            const isLast = index === thread.messages.length - 1;
            return (
              <article className={`message-card ${isLast ? "message-card--latest" : ""}`} key={message.id}>
                <header className="message-card__header">
                  <span className="message-card__sender">
                    <strong>{message.from.name || message.from.email}</strong>
                    <span>{message.from.email}</span>
                  </span>
                  <span className="message-card__meta">
                    <time dateTime={message.sentAt}>{MESSAGE_DATE.format(new Date(message.sentAt))}</time>
                    {isLast && canReply ? (
                      <span className="message-card__actions" role="group" aria-label="Reply actions">
                        <button
                          className="message-card__action"
                          type="button"
                          onClick={() => onComposeFromThread(thread.id, "reply")}
                          aria-label="Reply"
                          title="Reply"
                        >
                          <Reply size={15} />
                        </button>
                        <button
                          className="message-card__action"
                          type="button"
                          onClick={() => onComposeFromThread(thread.id, "replyAll")}
                          aria-label="Reply all"
                          title="Reply all"
                        >
                          <ReplyAll size={15} />
                        </button>
                      </span>
                    ) : null}
                  </span>
                  <details className="message-card__details">
                    <summary>Details</summary>
                    <dl>
                      <div><dt>From</dt><dd>{message.from.email}</dd></div>
                      <div><dt>To</dt><dd>{message.to.map((address) => address.email).join(", ")}</dd></div>
                      {message.cc.length > 0 ? (
                        <div><dt>Cc</dt><dd>{message.cc.map((address) => address.email).join(", ")}</dd></div>
                      ) : null}
                    </dl>
                  </details>
                </header>
                <EmailBody message={message} />
                {message.attachments.length > 0 ? (
                  <div className="attachment-list" aria-label="Attachments">
                    {message.attachments.map((attachment) => (
                      <span className="attachment-pill" key={attachment.name}>
                        <Paperclip size={14} />
                        <span><strong>{attachment.name}</strong><small>{attachment.size}</small></span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

      </div>
    </section>
  );
}

function ReaderWelcome() {
  return (
    <section className="reader-pane reader-welcome" aria-labelledby="welcome-title">
      <div className="reader-welcome__content">
        <Mail size={22} />
        <h1 id="welcome-title">Select a message</h1>
      </div>
    </section>
  );
}
