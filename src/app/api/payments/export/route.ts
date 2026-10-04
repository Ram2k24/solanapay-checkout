import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { route } from "@/lib/http/route";
import { requireMerchant } from "@/lib/merchant/require-merchant";
import { exportPayments, PAYMENT_FILTERS } from "@/lib/payments/list-payments";
import { parsePaymentSearch } from "@/lib/payments/payment-search";

// GET /api/payments/export?filter=&q= : the signed-in merchant's verified payments as a
// CSV download, matching the Transactions page view (decision D4). Read-only; no Origin
// check needed (a cross-site link can at most make the merchant download their own file,
// which the other site can't read).
const filterParam = z.enum(PAYMENT_FILTERS).optional();

export const GET = route("payments.export", async (request, { log }) => {
  const { merchant } = await requireMerchant(request);
  await enforceRateLimit(`payments:export:${merchant.id}`, 10, 60);

  const params = request.nextUrl.searchParams;
  const filter = filterParam.safeParse(params.get("filter") || undefined);
  if (!filter.success) throw new ApiError("InvalidRequest", { filter: "Use CONFIRMING, FINALIZED or LATE." });
  const search = parsePaymentSearch(params.get("q"));
  if (search === "invalid") throw new ApiError("InvalidRequest", { q: "Enter a full transaction signature or invoice number." });

  const { csv, rows, truncated } = await exportPayments(merchant.id, { filter: filter.data, search });
  log.info({ merchantId: merchant.id, rows, truncated }, "payments exported");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="transactions-${date}.csv"`,
      "x-export-rows": String(rows),
      "x-export-truncated": String(truncated),
    },
  });
});
