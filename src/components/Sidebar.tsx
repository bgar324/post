import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ChevronDown,
  FilePenLine,
  Inbox,
  AtSign,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
  Settings,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { AccountId, AppState, MailboxView } from "../model";
import { selectUnreadCount, selectViewCount } from "../selectors";
import { AccountAvatar } from "./AccountAvatar";
import { useFocusTrap } from "../useFocusTrap";

const NAV_ITEMS = [
  { view: "inbox", label: "Inbox", icon: Inbox },
  { view: "starred", label: "Starred", icon: Star },
  { view: "sent", label: "Sent", icon: Send },
  { view: "drafts", label: "Drafts", icon: FilePenLine },
  { view: "archive", label: "Archive", icon: Archive },
  { view: "trash", label: "Trash", icon: Trash2 },
] satisfies ReadonlyArray<{ view: MailboxView; label: string; icon: LucideIcon }>;

const CATEGORY_ITEMS = [
  { view: "promotions", label: "Promotions" },
  { view: "social", label: "Social" },
  { view: "updates", label: "Updates" },
  { view: "forums", label: "Forums" },
  { view: "spam", label: "Spam" },
] satisfies ReadonlyArray<{ view: MailboxView; label: string }>;

type SidebarProps = {
  state: AppState;
  collapsed: boolean;
  onNavigate: (view: MailboxView) => void;
  onSettings: () => void;
  onCompose: () => void;
  onConnect: () => void;
  onAccountFilter: (accountId: AccountId | null) => void;
  onClose: () => void;
  onToggleCollapsed: () => void;
};

export function Sidebar({
  state,
  collapsed,
  onNavigate,
  onSettings,
  onCompose,
  onConnect,
  onAccountFilter,
  onClose,
  onToggleCollapsed,
}: SidebarProps) {
  const activeView = state.route.kind === "mailbox" ? state.route.view : null;
  const drawerRef = useFocusTrap<HTMLElement>(state.sidebarOpen);

  return (
    <aside
      ref={drawerRef}
      className={`sidebar ${state.sidebarOpen ? "sidebar--open" : ""}`}
      role={state.sidebarOpen ? "dialog" : undefined}
      aria-modal={state.sidebarOpen ? true : undefined}
      aria-label="Primary navigation"
      tabIndex={-1}
    >
      <div className="sidebar__brand-row">
        <button className="wordmark" type="button" onClick={() => onNavigate("inbox")} aria-label="Post inbox">
          <span className="wordmark__name">Post</span>
        </button>
        <button
          className="icon-button sidebar__collapse"
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
          aria-pressed={collapsed}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <button className="icon-button sidebar__close" type="button" onClick={onClose} aria-label="Close navigation">
          <X size={18} />
        </button>
      </div>

      <button className="compose-button" type="button" onClick={onCompose} disabled={state.store.accounts.length === 0}>
        New message
      </button>

      <nav className="nav-list" aria-label="Mailboxes">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const count = selectViewCount(state, item.view);
          const isActive = activeView === item.view && state.accountFilter === null;
          return (
            <button
              className={`nav-item ${isActive ? "nav-item--active" : ""}`}
              type="button"
              key={item.view}
              onClick={() => onNavigate(item.view)}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={16} />
              <span>{item.label}</span>
              {count > 0 ? <span className="nav-item__count">{count}</span> : null}
            </button>
          );
        })}
      </nav>

      <details className="category-section" open>
        <summary className="category-nav__heading">
          <span>Categories</span>
          <ChevronDown className="category-nav__chevron" size={14} aria-hidden="true" />
        </summary>
        <nav className="category-nav" aria-label="Gmail categories">
          {CATEGORY_ITEMS.map((item) => {
            const count = selectViewCount(state, item.view);
            const isActive = activeView === item.view;
            return (
              <button
                className={`category-item ${isActive ? "category-item--active" : ""}`}
                type="button"
                key={item.view}
                onClick={() => onNavigate(item.view)}
                aria-current={isActive ? "page" : undefined}
              >
                <span>{item.label}</span>
                {count > 0 ? <span className="nav-item__count">{count}</span> : null}
              </button>
            );
          })}
        </nav>
      </details>

      <div className="sidebar__rule" />

      <section className="account-nav" aria-labelledby="accounts-label">
        <div className="account-nav__heading">
          <span id="accounts-label">Accounts</span>
          {state.store.accounts.length > 0 ? (
            <button className="account-nav__add" type="button" onClick={onConnect} aria-label="Connect Gmail">
              <Plus size={13} />
            </button>
          ) : null}
        </div>
        <button
          className={`account-nav__item ${state.accountFilter === null ? "account-nav__item--active" : ""}`}
          type="button"
          onClick={() => onAccountFilter(null)}
        >
          <span className="account-nav__icon"><AtSign size={15} /></span>
          <span className="account-nav__label">All</span>
        </button>
        {state.store.accounts.map((account) => {
          const unread = selectUnreadCount(state, account.id);
          const active = state.accountFilter === account.id;
          return (
            <button
              className={`account-nav__item ${active ? "account-nav__item--active" : ""}`}
              type="button"
              key={account.id}
              onClick={() => onAccountFilter(account.id)}
              aria-pressed={active}
            >
              <AccountAvatar account={account} />
              <span className="account-nav__label">
                <span>{account.badgeLabel}</span>
                <small>{account.email}</small>
              </span>
              {unread > 0 ? <span className="account-nav__unread">{unread}</span> : null}
            </button>
          );
        })}
      </section>

      <div className="sidebar__spacer" />

      <button
        className={`nav-item sidebar__settings ${state.route.kind === "settings" ? "nav-item--active" : ""}`}
        type="button"
        onClick={onSettings}
        aria-current={state.route.kind === "settings" ? "page" : undefined}
      >
        <Settings size={16} />
        <span>Settings</span>
      </button>

    </aside>
  );
}
