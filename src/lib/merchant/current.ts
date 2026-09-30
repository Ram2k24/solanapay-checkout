import "server-only";
import { cache } from "react";
import { getCurrentSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";

// For server components: the signed-in user's merchant (with default payout wallet),
// or null. cache() dedupes the lookup when layout and page both call it.
export const getCurrentMerchant = cache(async () => {
  const session = await getCurrentSession();
  if (!session) return null;
  const merchant = await db.merchant.findUnique({
    where: { ownerUserId: session.userId },
    include: { wallets: { where: { isDefault: true }, take: 1 } },
  });
  const payoutWallet = merchant?.wallets[0]?.address;
  return merchant && payoutWallet ? { ...merchant, payoutWallet, session } : null;
});
