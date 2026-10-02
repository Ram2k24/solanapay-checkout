import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { assertSameOrigin } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { requireMerchant } from "@/lib/merchant/require-merchant";
import { lookupTransaction } from "@/lib/payments/lookup-payment";

const lookupSchema = z.strictObject({ signature: z.string().trim().max(100) });

// "Look up a transaction": verifies a transaction by signature against the merchant's
// payout wallet, and records it (invoice payment or unmatched) if it paid the merchant.
export const POST = route("payments.lookup", async (request, { log, requestId }) => {
  assertSameOrigin(request);
  const { session, merchant, payoutWallet } = await requireMerchant(request);
  await enforceRateLimit(`payments:lookup:${merchant.id}`, 20, 60);

  const { signature } = await parseJsonBody(request, lookupSchema);
  const result = await lookupTransaction(
    { id: merchant.id, payoutWallet },
    signature,
    { actor: { type: "USER", id: session.userId }, requestId, log },
  );
  return NextResponse.json(result);
});
