import { Menu, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  AccountIdSchema,
  type Account,
  type AccountId,
  type AppState,
} from "../model";
import { AccountAvatar } from "./AccountAvatar";
import { AccountBadge } from "./AccountBadge";

type SettingsViewProps = {
  state: AppState;
  onMenu: () => void;
  onConnect: () => void;
  onSync: (accountId: AccountId) => void;
  onRemove: (account: Account) => void;
  onDefaultAccount: (accountId: AccountId) => void;
};

export function SettingsView({
  state,
  onMenu,
  onConnect,
  onSync,
  onRemove,
  onDefaultAccount,
}: SettingsViewProps) {
  return (
    <main className="settings-page" aria-labelledby="settings-title">
      <header className="settings-header">
        <button className="icon-button mobile-menu" type="button" onClick={onMenu} aria-label="Open navigation">
          <Menu size={20} />
        </button>
        <h1 id="settings-title">Settings</h1>
      </header>

      <section className="settings-section" aria-labelledby="accounts-title">
        <div className="settings-section__heading">
          <h2 id="accounts-title">Accounts</h2>
          <button className="settings-section__add" type="button" onClick={onConnect} aria-label="Connect Gmail">
            <Plus size={13} />
          </button>
        </div>

        <div className="account-settings-grid">
          {state.store.accounts.map((account) => (
            <article className="account-card" key={account.id}>
              <header className="account-card__header">
                <AccountAvatar account={account} />
                <span className="account-card__copy">
                  <AccountBadge account={account} />
                  <strong>{account.displayName}</strong>
                  <small>{account.email}</small>
                </span>
              </header>

              <footer className="account-card__footer">
                <button type="button" onClick={() => onSync(account.id)}>
                  <RefreshCw size={14} /> Sync
                </button>
                <button type="button" onClick={() => onRemove(account)}>
                  <Trash2 size={14} /> Disconnect
                </button>
              </footer>
            </article>
          ))}
        </div>
      </section>

      {state.store.accounts.length === 0 ? null : (
        <section className="settings-section" aria-labelledby="sending-title">
          <div className="settings-section__heading">
            <h2 id="sending-title">Sending</h2>
          </div>

          <div className="preference-card">
            <label className="preference-row">
              <span className="preference-row__copy">
                <strong>Default sending account</strong>
              </span>
              <select
                aria-label="Default sending account"
                value={state.store.preferences.defaultAccountId ?? ""}
                onChange={(event) => {
                  const parsed = AccountIdSchema.safeParse(event.currentTarget.value);
                  if (parsed.success) onDefaultAccount(parsed.data);
                }}
              >
                {state.store.accounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.badgeLabel} · {account.email}</option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}
    </main>
  );
}
