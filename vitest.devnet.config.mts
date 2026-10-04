import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The live devnet suite (Phase 14, decision F4): read-only checks of real devnet
// payments through the app's own RPC and verification code. Needs the network, so it
// is not part of `npm test`. Run: npm run test:devnet
export default defineConfig({
  resolve: {
    alias: {
      "@": path("./src"),
      "server-only": path("./tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/devnet/**/*.test.ts"],
    setupFiles: ["./tests/devnet/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
