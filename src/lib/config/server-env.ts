import "server-only";
import { z } from "zod";
import { CIRCLE_USDC_MINT, type SolanaNetwork } from "./networks";
import { parseEnv } from "./parse-env";
import { publicEnv } from "./public-env";

const secret = z.string().regex(/^[0-9a-f]{64}$/i, "must be 64 hex characters (openssl rand -hex 32)");
// Format check only. Phase 5 replaces this with @solana/kit's address validation.
const base58Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 Solana address");

const schema = z
  .object({
    APP_ENV: z.enum(["development", "test", "production"]),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    SOLANA_RPC_URL: z.url({ protocol: /^https?$/ }),
    USDC_MINT_DEVNET: base58Address,
    USDC_MINT_MAINNET: base58Address,
    AUTH_SECRET: secret,
    CRON_SECRET: secret,
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Largest invoice amount accepted, in whole USDC (decimal string, max 6 decimals).
    // A devnet safety cap; raise deliberately for production.
    MAX_INVOICE_AMOUNT_USDC: z
      .string()
      .regex(/^\d{1,9}(\.\d{1,6})?$/, "must be a decimal amount like 10000 or 2500.50")
      .default("10000"),
  })
  .superRefine((env, ctx) => {
    // Defense against typos or tampering: configured mints must equal Circle's official ones.
    if (env.USDC_MINT_DEVNET !== CIRCLE_USDC_MINT.devnet) {
      ctx.addIssue({ code: "custom", path: ["USDC_MINT_DEVNET"], message: "does not match Circle's official devnet USDC mint" });
    }
    if (env.USDC_MINT_MAINNET !== CIRCLE_USDC_MINT.mainnet) {
      ctx.addIssue({ code: "custom", path: ["USDC_MINT_MAINNET"], message: "does not match Circle's official mainnet USDC mint" });
    }
  });

const env = parseEnv(schema, process.env, "server");

function usdcMintFor(network: SolanaNetwork): string {
  switch (network) {
    case "devnet":
      return env.USDC_MINT_DEVNET;
    case "mainnet":
      return env.USDC_MINT_MAINNET;
    case "testnet":
      throw new Error("No USDC mint is configured for testnet");
  }
}

// Server-only configuration. Importing this from browser code fails the build ("server-only").
export const serverEnv = {
  ...env,
  network: publicEnv.NEXT_PUBLIC_SOLANA_NETWORK,
  usdcMint: usdcMintFor(publicEnv.NEXT_PUBLIC_SOLANA_NETWORK),
} as const;
