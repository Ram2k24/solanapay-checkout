import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";

// Phase 13.5 (decision E1): the app's own connection can read and write rows, but can't
// switch off the safety triggers, wipe or drop tables, or change the schema. These run
// through the same client the app uses, so they fail if TEST_DATABASE_URL ever points
// at the owner again.
const INSUFFICIENT_PRIVILEGE = "42501";

// The PostgreSQL error code of a statement run through the app's client, or undefined
// if it succeeded. Always rolled back, so nothing sticks even if a statement that
// should fail doesn't (PostgreSQL DDL and TRUNCATE are transactional too).
class Rollback extends Error {}
async function sqlState(statement: string): Promise<string | undefined> {
  let state: string | undefined;
  try {
    await db.$transaction(async (tx) => {
      try {
        await tx.$executeRawUnsafe(statement);
      } catch (error) {
        state = postgresCode(error);
      }
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return state;
}

// Prisma 7 reports raw-query errors as P2010, with PostgreSQL's code from the driver.
function postgresCode(error: unknown): string {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
  const cause = (error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined)?.cause;
  return cause?.originalCode ?? error.code;
}

describe("the app's database role (Phase 13.5)", () => {
  it("is not a superuser and doesn't own the tables", async () => {
    const [role] = await db.$queryRaw<{ rolsuper: boolean; owns: boolean }[]>`
      SELECT rolsuper, EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS owns
      FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, owns: false });
  });

  it.each([
    ["switch off the payment triggers", "ALTER TABLE payments DISABLE TRIGGER ALL"],
    ["empty the audit log", "TRUNCATE audit_logs"],
    ["change the audit log, even past its trigger", "UPDATE audit_logs SET action = action"],
    ["delete from the audit log", "DELETE FROM audit_logs"],
    ["delete payments", "DELETE FROM payments"],
    ["delete invoices", "DELETE FROM invoices"],
    ["drop a table", "DROP TABLE invoices"],
    ["create a table", "CREATE TABLE intruder (id int)"],
    ["read the migration history", "SELECT count(*) FROM _prisma_migrations"],
  ])("can't %s", async (_label, statement) => {
    expect(await sqlState(statement)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("can delete the short-lived rows the cleanup job removes", async () => {
    for (const table of ["auth_nonces", "sessions", "rate_limits"]) {
      expect(await sqlState(`DELETE FROM ${table} WHERE false`)).toBeUndefined();
    }
  });
});
