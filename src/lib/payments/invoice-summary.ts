import "server-only";
import { db } from "@/lib/db/client";
import { statusFilter, LIST_STATUSES, type ListStatus } from "./list-invoices";

// Invoice counts by effective status (overdue PENDING counts as EXPIRED).
export async function getInvoiceSummary(merchantId: string): Promise<Record<ListStatus | "TOTAL", number>> {
  const now = new Date();
  const counts = await Promise.all(
    LIST_STATUSES.map((status) => db.invoice.count({ where: { merchantId, ...statusFilter(status, now) } })),
  );
  const byStatus = Object.fromEntries(LIST_STATUSES.map((status, i) => [status, counts[i] ?? 0])) as Record<ListStatus, number>;
  return { ...byStatus, TOTAL: counts.reduce((a, b) => a + b, 0) };
}

// Verified payments, in base units. `received`: FINALIZED payments only. `confirming`:
// CONFIRMED payments still waiting for finality (money landed, not yet counted as
// received). Unmatched payments are in neither: they're in review, shown separately.
export async function getPaymentTotals(merchantId: string): Promise<{ received: bigint; confirming: bigint }> {
  const groups = await db.payment.groupBy({
    by: ["commitment"],
    where: { invoice: { merchantId } },
    _sum: { amount: true },
  });
  const sum = (commitment: "FINALIZED" | "CONFIRMED") => groups.find((g) => g.commitment === commitment)?._sum.amount ?? 0n;
  return { received: sum("FINALIZED"), confirming: sum("CONFIRMED") };
}
