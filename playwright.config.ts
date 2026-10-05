import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { E2E_APP_URL as APP_URL, E2E_DEMO_MERCHANT_ID, E2E_RPC_URL as RPC_URL } from "./tests/e2e/support/env";

// Browser (E2E) tests, Phase 14 (decisions F1-F3). Run: npm run test:e2e
//
// Starts two servers: the mock Solana RPC (tests/e2e/support/mock-rpc.ts) and a
// production build of the app in its own folder (.next-e2e) on port 3200, connected
// as the app role to the *_test database. Shares that database with `npm test`:
// don't run both at the same time.

if (existsSync(".env")) process.loadEnvFile(".env");

const testDb = process.env.TEST_DATABASE_URL ?? "";
if (!testDb || !new URL(testDb).pathname.endsWith("_test")) {
  throw new Error("TEST_DATABASE_URL must point to a *_test database (see .env.example).");
}

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1, // one shared test database
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx tsx tests/e2e/support/mock-rpc.ts",
      url: `${RPC_URL}/health`,
      reuseExistingServer: false,
    },
    {
      // Always a fresh build: NEXT_PUBLIC_* values are inlined at build time.
      command: `npx next build && npx next start -p ${new URL(APP_URL).port}`,
      url: `${APP_URL}/api/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        NEXT_DIST_DIR: ".next-e2e",
        APP_ENV: "test",
        LOG_LEVEL: "warn",
        DATABASE_URL: testDb,
        NEXT_PUBLIC_APP_URL: APP_URL,
        NEXT_PUBLIC_SOLANA_RPC_URL: RPC_URL,
        SOLANA_RPC_URL: RPC_URL,
        DEMO_MERCHANT_ID: E2E_DEMO_MERCHANT_ID, // the demo merchant demo.spec.ts creates
      },
    },
  ],
});
