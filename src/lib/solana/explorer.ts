import { publicEnv } from "@/lib/config/public-env";

// Solana Explorer link for a transaction. Explorer shows mainnet by default; other
// clusters are selected with ?cluster=<name>.
export function explorerTxUrl(signature: string, network: string, base = publicEnv.NEXT_PUBLIC_SOLANA_EXPLORER_URL): string {
  const url = new URL(`/tx/${encodeURIComponent(signature)}`, base);
  const cluster = network.toLowerCase();
  if (cluster !== "mainnet") url.searchParams.set("cluster", cluster);
  return url.href;
}
