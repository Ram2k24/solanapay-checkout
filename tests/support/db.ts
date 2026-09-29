import { db } from "@/lib/db/client";

// Empties all tables between tests. Refuses to run against a non-test database.
export async function resetDatabase(): Promise<void> {
  if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_test")) {
    throw new Error("resetDatabase() only runs against a *_test database");
  }
  await db.$executeRaw`TRUNCATE users, merchants, wallets, invoices, payments, audit_logs,
    auth_nonces, sessions, rate_limits RESTART IDENTITY CASCADE`;
}
