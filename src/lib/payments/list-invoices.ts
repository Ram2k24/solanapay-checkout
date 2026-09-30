import "server-only";
import type { InvoiceStatus, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";

export const LIST_STATUSES = ["PENDING", "CONFIRMING", "PAID", "EXPIRED", "FAILED"] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];

// Status filter on the *effective* status: "EXPIRED" includes PENDING invoices past
// their expiry, and "PENDING" excludes them (see effectiveStatus()).
export function statusFilter(status: ListStatus, now = new Date()): Prisma.InvoiceWhereInput {
  if (status === "PENDING") return { status: "PENDING", expiresAt: { gt: now } };
  if (status === "EXPIRED") return { OR: [{ status: "EXPIRED" }, { status: "PENDING", expiresAt: { lte: now } }] };
  return { status: status as InvoiceStatus };
}

// Newest first, keyset-paginated by id. UUIDv7 ids sort by creation time, so
// "id < cursor" continues exactly where the previous page ended, at any table size.
export async function listInvoices(merchantId: string, opts: { status?: ListStatus; cursor?: string; limit: number }) {
  const rows = await db.invoice.findMany({
    where: {
      merchantId,
      ...(opts.status ? statusFilter(opts.status) : {}),
      ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
    },
    orderBy: { id: "desc" },
    take: opts.limit + 1,
  });
  const hasMore = rows.length > opts.limit;
  const invoices = hasMore ? rows.slice(0, opts.limit) : rows;
  return { invoices, nextCursor: hasMore ? (invoices.at(-1)?.id ?? null) : null };
}
