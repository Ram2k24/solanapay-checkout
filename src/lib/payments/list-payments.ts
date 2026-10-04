import "server-only";
import { db } from "@/lib/db/client";

// A merchant's verified payments, newest first (the dashboard's "Recent transactions";
// Phase 12's Transactions page extends this with pagination and filters). Ordered by id:
// UUIDv7 ids sort by the time the payment was recorded. Scoped by the invoice's
// merchant, never by payout wallet: two merchants may share one (docs/security.md).
export async function listRecentPayments(merchantId: string, limit: number) {
  return db.payment.findMany({
    where: { invoice: { merchantId } },
    orderBy: { id: "desc" },
    take: limit,
    include: { invoice: { select: { id: true, invoiceNumber: true } } },
  });
}
