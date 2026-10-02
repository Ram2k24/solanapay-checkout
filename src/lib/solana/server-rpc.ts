import "server-only";
import {
  address,
  createSolanaRpc,
  signature as toSignature,
  type BlockhashLifetimeConstraint,
} from "@solana/kit";
import { GENESIS_HASH } from "@/lib/config/networks";
import { serverEnv } from "@/lib/config/server-env";

// Server-side Solana RPC (SOLANA_RPC_URL, never exposed to the browser).
const rpc = createSolanaRpc(serverEnv.SOLANA_RPC_URL);

const RPC_TIMEOUT_MS = 5000;
const timeout = () => ({ abortSignal: AbortSignal.timeout(RPC_TIMEOUT_MS) });

// A recent blockhash for a transaction we hand to a wallet. Wallets replace it with
// their own (Solana Pay spec), so freshness matters only for wallets that don't.
export async function getLatestBlockhash(): Promise<BlockhashLifetimeConstraint> {
  const { value } = await rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send(timeout());
  return value;
}

export class WrongClusterError extends Error {
  constructor(expected: string, actual: string) {
    super(`SOLANA_RPC_URL serves genesis ${actual}, expected ${expected} (${serverEnv.network})`);
    this.name = "WrongClusterError";
  }
}

// Verifies once per process that SOLANA_RPC_URL serves the configured network. Only a
// successful check is cached; an RPC error is retried on the next call.
let clusterVerified = false;
export async function assertExpectedCluster(): Promise<void> {
  if (clusterVerified) return;
  const expected = GENESIS_HASH[serverEnv.network];
  if (!expected) throw new Error(`No genesis hash known for ${serverEnv.network}`);
  const actual = await rpc.getGenesisHash().send(timeout());
  if (actual !== expected) throw new WrongClusterError(expected, actual);
  clusterVerified = true;
}

// Transactions that include `reference` as an account key (Solana Pay discovery),
// newest first, at "confirmed" or "finalized" commitment.
export function getSignaturesForReference(reference: string) {
  return rpc
    .getSignaturesForAddress(address(reference), { commitment: "confirmed", limit: 100 })
    .send(timeout());
}

// A landed transaction in raw "json" encoding (see chain-transaction.ts), or null if
// the RPC doesn't have it at "confirmed" yet.
export function getConfirmedTransaction(signature: string) {
  return rpc
    .getTransaction(toSignature(signature), { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    .send(timeout());
}

// Status of one signature, searching the full history (not just recent slots).
// null: the cluster doesn't know the signature.
export async function getSignatureStatus(signature: string) {
  const { value } = await rpc
    .getSignatureStatuses([toSignature(signature)], { searchTransactionHistory: true })
    .send(timeout());
  return value[0] ?? null;
}
