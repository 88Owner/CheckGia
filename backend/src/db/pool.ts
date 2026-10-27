import pg from "pg";

const { Pool } = pg;

export type QueryFn = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) throw new Error("PostgreSQL chưa được kết nối");
  return pool;
}

export async function connectDatabase(databaseUrl: string): Promise<void> {
  pool = new Pool({ connectionString: databaseUrl, max: 10 });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Không kết nối được PostgreSQL");
}

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (queryInTx: QueryFn) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  const queryInTx = (async (sql: string, params: unknown[] = []) => {
    const result = await client.query(sql, params);
    return result.rows as Record<string, unknown>[];
  }) as QueryFn;
  try {
    await client.query("BEGIN");
    const value = await fn(queryInTx);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function isoNow(): string {
  return new Date().toISOString();
}
