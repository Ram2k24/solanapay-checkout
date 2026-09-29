import { existsSync } from "node:fs";

// Runs before each test file: load .env, then point the app at the TEST database.
if (existsSync(".env")) process.loadEnvFile(".env");

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL is not set. See .env.example.");
if (!new URL(testUrl).pathname.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test.");
}

process.env.DATABASE_URL = testUrl;
process.env.APP_ENV = "test";
process.env.LOG_LEVEL = "silent";
