import pg from "pg";
import { RESET_SQL } from "../../support/reset-sql";

// The browser tests' view of the *_test database, as the owner (Phase 13.5): empties
// it between tests and reads what the app stored. Plain SQL through pg, because
// Playwright loads test files as CommonJS and the generated Prisma client is ESM-only.
let pool: pg.Pool | undefined;
function db(): pg.Pool {
  const url = process.env.TEST_MIGRATE_DATABASE_URL ?? "";
  if (!url || !new URL(url).pathname.endsWith("_test")) {
    throw new Error("TEST_MIGRATE_DATABASE_URL must point to a *_test database");
  }
  pool ??= new pg.Pool({ connectionString: url, max: 2 });
  return pool;
}

export async function resetDatabase(): Promise<void> {
  await db().query(RESET_SQL);
}

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query<T>(sql, params)).rows;
}
