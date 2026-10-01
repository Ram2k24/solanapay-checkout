import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { publicEnv } from "@/lib/config/public-env";
import { ApiError, parseJsonBody } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { clientIp } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { createPaymentTransaction, getTransactionRequestLabel } from "@/lib/payments/pay-transaction";

// Solana Pay Transaction Request endpoint for one invoice (spec: solana-foundation/pay SPEC.md).
//   GET  -> { label, icon }                 shown by the wallet before it asks to pay
//   POST { account } -> { transaction, message }  unsigned transaction for the wallet to sign
//
// Called by wallets, not by our pages: public, no cookies or session are read, and
// nothing changes state, so there is no Origin (CSRF) check. Any origin may call it
// (CORS *, without credentials). Wallets send GET and POST concurrently, so POST
// never depends on GET.

type Params = { id: string };

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

// Per minute. Counted independently: one IP can't use up another invoice's allowance,
// and one invoice can't be hammered from many IPs without hitting its own limit.
const LIMITS = { perIp: 30, perInvoice: 20, windowSeconds: 60 } as const;

// Only `account` is read; any other field (amount, recipient, mint, reference, ...) is
// dropped by the schema and never reaches the transaction builder.
const PostBody = z.object({ account: z.string().max(64) });

// CORS headers on every response, including errors produced inside route().
function withCors<P>(handler: (request: NextRequest, segment: { params: Promise<P> }) => Promise<Response>) {
  return async (request: NextRequest, segment: { params: Promise<P> }) => {
    const response = await handler(request, segment);
    for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
    return response;
  };
}

export const GET = withCors(
  route<Params>("pay.transaction.label", async (request, { params }) => {
    await enforceRateLimit(`pay:tx:get:ip:${clientIp(request)}`, LIMITS.perIp, LIMITS.windowSeconds);
    const found = await getTransactionRequestLabel(params.id);
    if (!found) throw new ApiError("NotFound");
    return NextResponse.json({ label: found.label, icon: new URL("/solana-pay-icon.svg", publicEnv.NEXT_PUBLIC_APP_URL).href });
  }),
);

export const POST = withCors(
  route<Params>("pay.transaction.create", async (request, { log, params }) => {
    // IP first, so requests from a blocked IP don't consume the invoice's allowance.
    await enforceRateLimit(`pay:tx:post:ip:${clientIp(request)}`, LIMITS.perIp, LIMITS.windowSeconds);
    if (!z.uuid().safeParse(params.id).success) throw new ApiError("NotFound"); // keeps junk out of limiter keys
    await enforceRateLimit(`pay:tx:post:invoice:${params.id}`, LIMITS.perInvoice, LIMITS.windowSeconds);

    const { account } = await parseJsonBody(request, PostBody);
    const result = await createPaymentTransaction(params.id, account);
    log.info({ invoiceId: params.id, account }, "transaction request served");
    return NextResponse.json(result);
  }),
);

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
