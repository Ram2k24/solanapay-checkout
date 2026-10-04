import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import type { PaymentSearch } from "./payment-search";

// The merchant's verified payments (Phase 12 transaction history; the dashboard shows the
// first 5). Newest first by id: UUIDv7 ids sort by the time the payment was recorded, so
// "id < cursor" continues exactly where the previous page ended. Scoped by the invoice's
// merchant, never by payout wallet: two merchants may share one (docs/security.md).

export const PAYMENT_FILTERS = ["CONFIRMING", "FINALIZED", "LATE"] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

function filterWhere(filter: PaymentFilter | undefined): Prisma.PaymentWhereInput {
  if (filter === "CONFIRMING") return { commitment: "CONFIRMED" };
  if (filter === "FINALIZED") return { commitment: "FINALIZED" };
  if (filter === "LATE") return { late: true };
  return {};
}

export async function listPayments(
  merchantId: string,
  opts: { filter?: PaymentFilter; search?: PaymentSearch | null; cursor?: string; limit: number },
) {
  const search = opts.search;
  const rows = await db.payment.findMany({
    where: {
      invoice: { merchantId, ...(search && "invoiceNumber" in search ? { invoiceNumber: search.invoiceNumber } : {}) },
      ...(search && "signature" in search ? { signature: search.signature } : {}),
      ...filterWhere(opts.filter),
      ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
    },
    orderBy: { id: "desc" },
    take: opts.limit + 1,
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
  });
  const hasMore = rows.length > opts.limit;
  const payments = hasMore ? rows.slice(0, opts.limit) : rows;
  return { payments, nextCursor: hasMore ? (payments.at(-1)?.id ?? null) : null };
}
