import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/server-env";
import { ApiError } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { createDemoInvoice, DEMO } from "@/lib/payments/demo-invoice";

// Public "Try a demo payment" (Phase 16): creates a 0.01 USDC invoice of the demo
// merchant and returns only its id; the page then opens the normal checkout. No session.
// Origin check (only our page creates them), 5 per hour per IP, 200 per day overall.
export const POST = route("demo.invoice.create", async (request, { log }) => {
  assertSameOrigin(request);
  const merchantId = serverEnv.DEMO_MERCHANT_ID;
  if (!merchantId) throw new ApiError("NotFound");
  await enforceRateLimit(`demo:ip:${clientIp(request)}`, DEMO.perIpPerHour, 60 * 60);

  const invoice = await createDemoInvoice(merchantId);
  log.info({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber }, "demo invoice created");
  return NextResponse.json({ id: invoice.id }, { status: 201 });
});
