import type { Account } from "../model";

type AccountBadgeProps = {
  account: Account;
  compact?: boolean;
};

export function AccountBadge({ account, compact = false }: AccountBadgeProps) {
  return (
    <span
      className={`account-badge ${compact ? "account-badge--compact" : ""}`}
      title={`${account.badgeLabel} · ${account.email}`}
    >
      {account.badgeLabel}
    </span>
  );
}
