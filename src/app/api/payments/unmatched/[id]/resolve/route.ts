import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseJsonBody } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { assertSameOrigin } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { requireMerchant } from "@/lib/merchant/require-merchant";
import { resolveUnmatchedPayment } from "@/lib/payments/unmatched";

const resolveSchema = z.strictObject({
  note: z
    .string()
    .trim()
    .min(1, "Describe how this payment was handled.")
    .max(500, "At most 500 characters.")
    .regex(/^[^\p{Cc}]*$/u, "Contains invalid characters."),
});

// Marks an unmatched payment as handled (e.g. refunded), with a note. Final.
export const POST = route<{ id: string }>("payments.unmatched.resolve", async (request, { requestId, params }) => {
  assertSameOrigin(request);
  const { session, merchant } = await requireMerchant(request);
  if (!z.uuid().safeParse(params.id).success) throw new ApiError("NotFound");
  await enforceRateLimit(`payments:resolve:${merchant.id}`, 30, 60);

  const { note } = await parseJsonBody(request, resolveSchema);
  const entry = await resolveUnmatchedPayment(
    { id: params.id, merchantId: merchant.id },
    { note, userId: session.userId, requestId },
  );
  return NextResponse.json(entry);
});
