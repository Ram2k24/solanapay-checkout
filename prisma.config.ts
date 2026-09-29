import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 does not load .env automatically. Node's built-in loader does it
// (no dotenv dependency). Variables already set in the environment win, so
// hosting platforms that inject env vars (e.g. Vercel) are unaffected.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Plain process.env (not env()) so commands that don't need a database,
    // like `prisma generate`, work without DATABASE_URL.
    url: process.env.DATABASE_URL ?? "",
  },
});
