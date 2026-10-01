import "server-only";
import { createSolanaRpc, type BlockhashLifetimeConstraint } from "@solana/kit";
import { serverEnv } from "@/lib/config/server-env";

// Server-side Solana RPC (SOLANA_RPC_URL, never exposed to the browser).
const rpc = createSolanaRpc(serverEnv.SOLANA_RPC_URL);

const RPC_TIMEOUT_MS = 5000;

// A recent blockhash for a transaction we hand to a wallet. Wallets replace it with
// their own (Solana Pay spec), so freshness matters only for wallets that don't.
export async function getLatestBlockhash(): Promise<BlockhashLifetimeConstraint> {
  const { value } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
  return value;
}
