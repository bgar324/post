import { backfillGmailAccount, syncGmailAccount } from "./gmail";
import { migrateDatabase, pool, query, transaction } from "./db";

type AccountRow = {
  id: string;
  user_id: string;
};

type SizeRow = {
  database_bytes: string;
  messages_bytes: string;
};

async function storageSize(): Promise<SizeRow> {
  const rows = await query<SizeRow>(
    `select
       pg_database_size(current_database())::bigint::text as database_bytes,
       pg_total_relation_size('mail_messages'::regclass)::bigint::text as messages_bytes`,
  );
  const size = rows[0];
  if (size === undefined) throw new Error("Could not measure mail cache storage");
  return size;
}

const mode = process.argv[2];
if (mode !== "--reset-derived-cache" && mode !== "--resume") {
  throw new Error("Use --reset-derived-cache to reclaim storage or --resume to continue metadata backfill");
}

try {
  await migrateDatabase();
  const before = await storageSize();
  console.log(`Database before: ${before.database_bytes} bytes; messages: ${before.messages_bytes} bytes`);

  if (mode === "--reset-derived-cache") {
    await transaction(async (client) => {
      await client.query("truncate table mail_messages");
      await client.query(
        `update mail_accounts set
           gmail_backfill_page_token = null,
           gmail_backfill_stage = 'mail',
           updated_at = now()`,
      );
    });
    const resetSize = await storageSize();
    console.log(`Derived message cache reset: ${resetSize.messages_bytes} bytes`);
  }

  const accounts = await query<AccountRow>(
    "select id, user_id from mail_accounts order by created_at",
  );
  for (const [index, account] of accounts.entries()) {
    console.log(`Syncing recent content for account ${index + 1}/${accounts.length}`);
    await syncGmailAccount(account.user_id, account.id);
  }
  for (const [index, account] of accounts.entries()) {
    console.log(`Backfilling one metadata page for account ${index + 1}/${accounts.length}`);
    await backfillGmailAccount(account.user_id, account.id, 1);
  }

  const after = await storageSize();
  console.log(`Database after: ${after.database_bytes} bytes; messages: ${after.messages_bytes} bytes`);
} finally {
  await pool.end();
}
