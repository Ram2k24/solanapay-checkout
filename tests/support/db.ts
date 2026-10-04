import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { RESET_SQL } from "./reset-sql";

// The owner's connection, used only to empty the tables between tests: the app role
// (which the code under test uses) may not TRUNCATE (Phase 13.5).
let owner: PrismaClient | undefined;
function ownerDb(): PrismaClient {
  const url = process.env.TEST_MIGRATE_DATABASE_URL ?? "";
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("resetDatabase() only runs against a *_test database");
  }
  owner ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return owner;
}

// Empties all tables between tests. Refuses to run against a non-test database.
export async function resetDatabase(): Promise<void> {
  await ownerDb().$executeRawUnsafe(RESET_SQL);
}
