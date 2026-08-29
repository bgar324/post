import type { FormEvent, KeyboardEvent } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  AccountIdSchema,
  validateDraftRecipients,
  type Account,
  type AccountId,
  type ComposerState,
  type Draft,
  type DraftPatch,
} from "../model";
import { AccountBadge } from "./AccountBadge";
import { AccountAvatar } from "./AccountAvatar";
import { useFocusTrap } from "../useFocusTrap";

type ComposerProps = {
  draft: Draft;
  account: Account;
  accounts: Account[];
  busy: boolean;
  composer: ComposerState;
  onPatch: (patch: DraftPatch) => void;
  onClose: () => void;
  onDelete: () => void;
  onRequestIdentity: (accountId: AccountId) => void;
  onCancelIdentity: () => void;
  onConfirmIdentity: () => void;
  onSend: () => void;
};

function draftContext(draft: Draft): string {
  switch (draft.origin.kind) {
    case "new":
      return "New message";
    case "reply":
      return "Reply";
    case "replyAll":
      return "Reply all";
    default: {
      const exhaustive: never = draft.origin;
      return exhaustive;
    }
  }
}

export function Composer({
  draft,
  account,
  accounts,
  busy,
  composer,
  onPatch,
  onClose,
  onDelete,
  onRequestIdentity,
  onCancelIdentity,
  onConfirmIdentity,
  onSend,
}: ComposerProps) {
  const recipientValidation = validateDraftRecipients(draft);
  const invalidRecipient =
    recipientValidation.kind === "invalid" ? recipientValidation.values[0] : null;
  const composerRef = useFocusTrap<HTMLElement>(composer.kind !== "confirmIdentity");
  const identityRef = useFocusTrap<HTMLElement>(composer.kind === "confirmIdentity");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSend();
  };

  const submitShortcut = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <>
      <div className="compose-scrim" onMouseDown={onClose} aria-hidden="true" />
      <section
        ref={composerRef}
        className="composer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
        tabIndex={-1}
      >
        <header className="composer__header">
          <h2 id="composer-title">{draftContext(draft)}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close and save draft" disabled={busy}>
            <X size={19} />
          </button>
        </header>

        <form className="composer__form" onSubmit={submit} onKeyDown={submitShortcut}>
          <label className="composer-field composer-field--identity">
            <span>From</span>
            <span className="identity-select">
              <AccountAvatar account={account} />
              <select
                disabled={busy}
                value={account.id}
                onChange={(event) => {
                  const parsed = AccountIdSchema.safeParse(event.currentTarget.value);
                  if (parsed.success) onRequestIdentity(parsed.data);
                }}
                aria-label="Sending account"
              >
                {accounts.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.badgeLabel} · {item.email}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </span>
          </label>

          <label className="composer-field">
            <span>To</span>
            <input
              disabled={busy}
              value={draft.to}
              onChange={(event) => onPatch({ to: event.currentTarget.value })}
              placeholder="Name or email"
              autoComplete="off"
              data-initial-focus
            />
          </label>
          <label className="composer-field composer-field--cc">
            <span>Cc</span>
            <input
              disabled={busy}
              value={draft.cc}
              onChange={(event) => onPatch({ cc: event.currentTarget.value })}
              placeholder="Optional"
              autoComplete="off"
            />
          </label>
          <label className="composer-field composer-field--subject">
            <span>Subject</span>
            <input
              disabled={busy}
              value={draft.subject}
              onChange={(event) => onPatch({ subject: event.currentTarget.value })}
              readOnly={draft.origin.kind !== "new"}
              placeholder="Subject"
            />
          </label>
          <label className="composer-body">
            <span className="sr-only">Message body</span>
            <textarea
              disabled={busy}
              value={draft.body}
              onChange={(event) => onPatch({ body: event.currentTarget.value })}
              placeholder="Message"
            />
          </label>


          {invalidRecipient === null ? null : (
            <div className="composer__warning" role="alert">
              <AlertTriangle size={17} />
              <span>
                <strong>Check recipient “{invalidRecipient}”.</strong> Use a complete email address.
              </span>
            </div>
          )}


          <footer className="composer__footer">
            <div className="composer__actions">
              <button className="icon-button composer__discard" type="button" onClick={onDelete} aria-label="Discard draft" disabled={busy}>
                <Trash2 size={18} />
              </button>
              <button
                className="send-button"
                type="submit"
                disabled={recipientValidation.kind !== "valid" || busy}
              >
                <Send size={16} /> {busy ? "Sending" : "Send"}
                <kbd>⌘↵</kbd>
              </button>
            </div>
          </footer>
        </form>
      </section>

      {composer.kind === "confirmIdentity" ? (
        <div className="dialog-scrim" role="presentation">
          <section
            ref={identityRef}
            className="identity-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="identity-dialog-title"
            tabIndex={-1}
          >
            <span className="identity-dialog__icon"><AlertTriangle size={22} /></span>
            <h2 id="identity-dialog-title">Send this from a different account?</h2>
            <p>
              Changing accounts starts a new conversation. The draft content stays the same.
            </p>
            <div className="identity-dialog__route">
              <AccountBadge account={account} />
              <span aria-hidden="true">→</span>
              {accounts.map((item) =>
                item.id === composer.targetAccountId ? <AccountBadge account={item} key={item.id} /> : null,
              )}
            </div>
            <div className="identity-dialog__actions">
              <button type="button" className="secondary-button" onClick={onCancelIdentity} disabled={busy}>
                Keep original
              </button>
              <button type="button" className="primary-button" onClick={onConfirmIdentity} disabled={busy}>
                Switch account
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
