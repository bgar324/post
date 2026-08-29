import type { Account } from "../model";

type AccountAvatarProps = {
  account: Account;
};

export function AccountAvatar({ account }: AccountAvatarProps) {
  return (
    <span className="account-avatar" aria-hidden="true">
      {account.avatarUrl === null ? (
        account.badgeLabel.slice(0, 1)
      ) : (
        <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" />
      )}
    </span>
  );
}
