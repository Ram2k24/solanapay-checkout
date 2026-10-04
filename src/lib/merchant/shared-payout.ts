import "server-only";
import type { Prisma } from "@/generated/prisma/client";

// A payout wallet belongs to one merchant (Phase 13, decision D5). If two merchants
// shared one, a payment sent to it without our reference (an unmatched payment) could
// belong to either, and each could see the other's incoming transfers on-chain.
// Only current defaults count: a wallet another merchant used before may be reused.
export const SHARED_PAYOUT_PROBLEM = "This wallet is already another merchant's payout wallet. Use a wallet only your business controls.";

// Serializes payout-wallet writes per address (transaction-scoped advisory lock), so two
// merchants claiming the same wallet at the same moment can't both pass the check.
const PAYOUT_ADDRESS_LOCK = 1301; // lock class, keeps these locks apart from any others

export async function lockPayoutAddress(tx: Pick<Prisma.TransactionClient, "$executeRaw">, address: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYOUT_ADDRESS_LOCK}::int, hashtext(${address}))`;
}

// `userId`: the signed-in user claiming the wallet; their own merchant (if any) doesn't count.
export async function sharedPayoutProblem(
  tx: Pick<Prisma.TransactionClient, "wallet">,
  address: string,
  userId: string,
): Promise<string | null> {
  const other = await tx.wallet.findFirst({
    where: { address, isDefault: true, merchant: { ownerUserId: { not: userId } } },
    select: { id: true },
  });
  return other ? SHARED_PAYOUT_PROBLEM : null;
}
