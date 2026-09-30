import "server-only";
import type { NextRequest } from "next/server";
import { getSession, type AuthSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";

export async function requireSession(request: NextRequest): Promise<AuthSession> {
  const session = await getSession(request);
  if (!session) throw new ApiError("Unauthenticated");
  return session;
}

// The signed-in user's merchant and its default payout wallet. Every merchant-only
// API goes through this, so data access is always scoped to this merchant's ID.
export async function requireMerchant(request: NextRequest) {
  const session = await requireSession(request);
  const merchant = await db.merchant.findUnique({
    where: { ownerUserId: session.userId },
    include: { wallets: { where: { isDefault: true }, take: 1 } },
  });
  const payoutWallet = merchant?.wallets[0]?.address;
  if (!merchant || !payoutWallet) throw new ApiError("MerchantProfileRequired");
  return { session, merchant, payoutWallet };
}
