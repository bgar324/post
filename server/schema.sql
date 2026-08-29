create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  default_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_users add column if not exists last_compose_account_id text;


create table if not exists app_sessions (
  token_hash text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists mail_accounts (
  id text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  google_sub text not null,
  email text not null,
  display_name text not null,
  badge_label text not null,
  avatar_url text,
  enabled boolean not null default true,
  gmail_history_id text,
  last_synced_at timestamptz,
  gmail_backfill_page_token text,
  gmail_backfill_stage text not null default 'mail'
    constraint mail_accounts_gmail_backfill_stage_check
    check (gmail_backfill_stage in ('mail', 'spam', 'trash', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_sub),
  unique (user_id, email)
);
alter table mail_accounts add column if not exists gmail_backfill_page_token text;
alter table mail_accounts add column if not exists gmail_backfill_stage text;
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mail_accounts'
      and column_name = 'gmail_backfill_complete'
  ) then
    execute $migration$
      update mail_accounts
      set gmail_backfill_stage = case
        when gmail_backfill_complete then 'complete'
        else 'mail'
      end
      where gmail_backfill_stage is null
    $migration$;
  end if;
end
$$;
update mail_accounts set gmail_backfill_stage = 'mail' where gmail_backfill_stage is null;
alter table mail_accounts alter column gmail_backfill_stage set default 'mail';
alter table mail_accounts alter column gmail_backfill_stage set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mail_accounts_gmail_backfill_stage_check'
      and conrelid = 'mail_accounts'::regclass
  ) then
    alter table mail_accounts
      add constraint mail_accounts_gmail_backfill_stage_check
      check (gmail_backfill_stage in ('mail', 'spam', 'trash', 'complete'));
  end if;
end
$$;
alter table mail_accounts drop column if exists gmail_backfill_complete;

create unique index if not exists mail_accounts_google_sub_unique on mail_accounts (google_sub);


create table if not exists gmail_credentials (
  account_id text primary key references mail_accounts(id) on delete cascade,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expiry timestamptz,
  scope text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists mail_threads (
  id text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  account_id text not null references mail_accounts(id) on delete cascade,
  gmail_thread_id text not null,
  subject text not null,
  snippet text not null default '',
  mailbox_state text not null check (mailbox_state in ('inbox', 'archive', 'trash', 'sent', 'spam')),
  category text not null default 'primary' check (category in ('primary', 'promotions', 'social', 'updates', 'forums')),
  unread boolean not null default false,
  starred boolean not null default false,
  last_message_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, gmail_thread_id)
);
alter table mail_threads add column if not exists category text not null default 'primary';


create index if not exists mail_threads_inbox_idx
  on mail_threads (user_id, mailbox_state, last_message_at desc);
create index if not exists mail_threads_account_idx
  on mail_threads (user_id, account_id, last_message_at desc);

create table if not exists mail_messages (
  id text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  account_id text not null references mail_accounts(id) on delete cascade,
  thread_id text not null references mail_threads(id) on delete cascade,
  gmail_message_id text not null,
  direction text not null check (direction in ('incoming', 'outgoing')),
  from_json jsonb not null,
  to_json jsonb not null default '[]'::jsonb,
  cc_json jsonb not null default '[]'::jsonb,
  sent_at timestamptz not null,
  body text not null default '',
  html_body text,
  content_version integer not null default 0,
  internet_message_id text,
  references_header text,
  attachments_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, gmail_message_id)
);
alter table mail_messages add column if not exists html_body text;
alter table mail_messages add column if not exists content_version integer not null default 0;
alter table mail_messages add column if not exists content_cached_at timestamptz;


create index if not exists mail_messages_thread_idx on mail_messages (thread_id, sent_at);
drop index if exists mail_messages_body_search_idx;
create index if not exists mail_messages_content_cache_idx
  on mail_messages (user_id, content_cached_at desc)
  where content_cached_at is not null;

create table if not exists mail_drafts (
  id text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  account_id text not null references mail_accounts(id) on delete cascade,
  origin_kind text not null check (origin_kind in ('new', 'reply', 'replyAll')),
  source_thread_id text references mail_threads(id) on delete set null,
  to_text text not null default '',
  cc_text text not null default '',
  subject text not null default '',
  body text not null default '',
  gmail_draft_id text,
  sending_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table mail_drafts add column if not exists sending_at timestamptz;
alter table mail_drafts add column if not exists gmail_draft_id text;
create unique index if not exists mail_drafts_gmail_id_unique
  on mail_drafts (account_id, gmail_draft_id) where gmail_draft_id is not null;


create index if not exists mail_drafts_user_idx on mail_drafts (user_id, updated_at desc);

alter table app_users enable row level security;
alter table app_sessions enable row level security;
alter table mail_accounts enable row level security;
alter table gmail_credentials enable row level security;
alter table mail_threads enable row level security;
alter table mail_messages enable row level security;
alter table mail_drafts enable row level security;

revoke all on table app_users from anon, authenticated;
revoke all on table app_sessions from anon, authenticated;
revoke all on table mail_accounts from anon, authenticated;
revoke all on table gmail_credentials from anon, authenticated;
revoke all on table mail_threads from anon, authenticated;
revoke all on table mail_messages from anon, authenticated;
revoke all on table mail_drafts from anon, authenticated;
