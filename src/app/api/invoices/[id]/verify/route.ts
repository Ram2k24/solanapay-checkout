import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { assertSameOrigin } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { requireMerchant } from "@/lib/merchant/require-merchant";
import { checkInvoicePayment } from "@/lib/payments/check-payment";
import { toPaymentDto } from "@/lib/payments/payment-dto";

// "Check for payment": looks for this invoice's payment on-chain now and records it.
// The browser sends nothing but the invoice ID; the server verifies everything itself.
export const POST = route<{ id: string }>("invoices.verify", async (request, { log, requestId, params }) => {
  assertSameOrigin(request);
  const { session, merchant } = await requireMerchant(request);
  if (!z.uuid().safeParse(params.id).success) throw new ApiError("NotFound");
  await enforceRateLimit(`invoices:verify:${merchant.id}:${params.id}`, 10, 60);

  const result = await checkInvoicePayment(
    { invoiceId: params.id, merchantId: merchant.id },
    { actor: { type: "USER", id: session.userId }, requestId, log },
  );
  const payment = await db.payment.findUnique({ where: { invoiceId: params.id } });
  return NextResponse.json({ status: result.status, payment: payment ? toPaymentDto(payment) : null, recorded: result.recorded });
});
