import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/http/api";
import { route } from "@/lib/http/route";
import { requireMerchant } from "@/lib/merchant/require-merchant";
import { listUnmatchedPayments } from "@/lib/payments/unmatched";

const statusParam = z.enum(["OPEN", "RESOLVED"]).default("OPEN");

// The signed-in merchant's unmatched payments: ?status=OPEN (default) or RESOLVED.
export const GET = route("payments.unmatched.list", async (request) => {
  const { merchant } = await requireMerchant(request);
  const status = statusParam.safeParse(request.nextUrl.searchParams.get("status") ?? undefined);
  if (!status.success) throw new ApiError("InvalidRequest", { status: "Use OPEN or RESOLVED." });
  return NextResponse.json({ items: await listUnmatchedPayments(merchant.id, status.data) });
});
