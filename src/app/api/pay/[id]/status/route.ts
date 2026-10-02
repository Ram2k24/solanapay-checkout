import { NextResponse } from "next/server";
import { ApiError } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { clientIp } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { getPublicStatus } from "@/lib/payments/public-status";

// Public invoice status for the checkout page's polling: { status, expiresAt, confirmation }.
// No sign-in and no cookies read; same-origin only (no CORS headers); never cached.
// 60 requests/min per IP, answered with 429 + Retry-After beyond that.
export const GET = route<{ id: string }>("pay.status", async (request, { log, requestId, params }) => {
  await enforceRateLimit(`pay:status:ip:${clientIp(request)}`, 60, 60);
  const status = await getPublicStatus(params.id, { log, requestId });
  if (!status) throw new ApiError("NotFound");
  return NextResponse.json(status);
});
