// Solana networks the application knows about, and which ones this build accepts.
// Safe to import from both browser and server code (no secrets).

export const SOLANA_NETWORKS = ["devnet", "testnet", "mainnet"] as const;
export type SolanaNetwork = (typeof SOLANA_NETWORKS)[number];

// Only devnet is enabled. Enabling mainnet requires completing the
// production readiness checklist first (Phase 17).
export const ENABLED_NETWORKS: readonly SolanaNetwork[] = ["devnet"];

// Official Circle USDC mints.
// Source: https://developers.circle.com/stablecoins/usdc-contract-addresses
export const CIRCLE_USDC_MINT = {
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
} as const;

export const USDC_DECIMALS = 6;
