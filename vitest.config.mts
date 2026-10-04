import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path("./src"),
      // "server-only" throws outside Next.js's server bundler; tests run on the server anyway.
      "server-only": path("./tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/support/setup.ts"],
    // Playwright's browser tests (npm run test:e2e) and the live devnet suite
    // (npm run test:devnet) run separately.
    exclude: [...configDefaults.exclude, "tests/e2e/**", "tests/devnet/**"],
    // Integration tests share one test database, so run files one at a time.
    fileParallelism: false,
  },
});
