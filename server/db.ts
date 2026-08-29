import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import pg, { type PoolClient, type QueryResultRow } from "pg";
import { config } from "./config";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 6,
  ssl: {
    ca: readFileSync(config.SUPABASE_DB_CA_CERT_PATH, "utf8"),
    rejectUnauthorized: true,
  },
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});

export async function migrateDatabase(): Promise<void> {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(schema);
}

export async function query<Row extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const result = await pool.query<Row>(text, values);
  return result.rows;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
