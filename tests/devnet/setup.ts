import { existsSync } from "node:fs";

// The live suite reads devnet through SOLANA_RPC_URL from .env, like the app does.
// It writes nothing anywhere (no database, no transactions, no keys).
if (existsSync(".env")) process.loadEnvFile(".env");
process.env.LOG_LEVEL = "silent";
