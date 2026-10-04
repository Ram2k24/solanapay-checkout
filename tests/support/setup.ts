import { existsSync } from "node:fs";

// Runs before each test file: load .env, then point the app at the TEST database.
if (existsSync(".env")) process.loadEnvFile(".env");

// The app code under test connects as the least-privilege role (TEST_DATABASE_URL);
// only resetDatabase() uses the owner (TEST_MIGRATE_DATABASE_URL), to TRUNCATE.
const testUrl = process.env.TEST_DATABASE_URL;
const ownerUrl = process.env.TEST_MIGRATE_DATABASE_URL;
if (!testUrl || !ownerUrl) throw new Error("TEST_DATABASE_URL and TEST_MIGRATE_DATABASE_URL must be set. See .env.example.");
for (const url of [testUrl, ownerUrl]) {
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL and TEST_MIGRATE_DATABASE_URL must point to a database whose name ends in _test.");
  }
}

process.env.DATABASE_URL = testUrl;
process.env.APP_ENV = "test";
process.env.LOG_LEVEL = "silent";
