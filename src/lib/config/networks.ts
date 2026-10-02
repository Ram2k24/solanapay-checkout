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

// Each cluster's genesis block hash: a fixed fingerprint of the network. Payment
// verification refuses to run unless the configured RPC reports the expected one, so
// a misconfigured RPC URL (e.g. mainnet for a devnet build) can't verify anything.
// Source: getGenesisHash on the public RPC endpoints; the first 32 characters are the
// CAIP-2 chain IDs (github.com/ChainAgnostic/namespaces, solana/caip2.md).
export const GENESIS_HASH: Partial<Record<SolanaNetwork, string>> = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};
