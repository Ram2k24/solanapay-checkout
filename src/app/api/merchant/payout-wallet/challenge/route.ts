import { NextResponse } from "next/server";
import { z } from "zod";
import { issuePayoutChangeChallenge } from "@/lib/auth/challenge";
import { db } from "@/lib/db/client";
import { ApiError, parseJsonBody } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { assertSameOrigin } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { payoutWalletProblem } from "@/lib/merchant/payout-wallet";
import { sharedPayoutProblem } from "@/lib/merchant/shared-payout";
import { requireMerchant } from "@/lib/merchant/require-merchant";

// Step 1 of changing the payout wallet (Phase 11.4c, decision D5): validates the new
// address and returns the message the signed-in wallet must sign. Nothing changes yet.
const bodySchema = z.strictObject({ payoutWallet: z.string().trim() });

export const POST = route("merchant.payout_wallet.challenge", async (request) => {
  assertSameOrigin(request);
  const { session, merchant, payoutWallet: current } = await requireMerchant(request);
  await enforceRateLimit(`merchant:payout:challenge:${merchant.id}`, 10, 60);
  const { payoutWallet } = await parseJsonBody(request, bodySchema);

  const problem =
    payoutWalletProblem(payoutWallet) ??
    (payoutWallet === current ? "This is already your payout wallet." : null) ??
    (await sharedPayoutProblem(db, payoutWallet, session.userId)); // re-checked, under a lock, on confirmation
  if (problem) throw new ApiError("InvalidRequest", { payoutWallet: problem });

  return NextResponse.json(await issuePayoutChangeChallenge(session.walletAddress, payoutWallet));
});
