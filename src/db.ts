import { Pool, type QueryResultRow } from "pg";
import { appConfig } from "./config";

const pool = new Pool({
  connectionString: appConfig.databaseUrl
});

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function healthcheckDb(): Promise<boolean> {
  await pool.query("SELECT 1");
  return true;
}
