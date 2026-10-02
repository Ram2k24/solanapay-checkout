import "server-only";
import type { InvoiceStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { checkInvoicePayment, type Actor } from "./check-payment";
import { assertTransition } from "./invoice-state";
import { EXPIRY_GRACE_SECONDS } from "./policy";

// Chain-first expiry (Phase 10). A PENDING invoice becomes EXPIRED only when:
//   1. it is overdue by more than the grace period (database clock), and
//   2. a chain check just succeeded (checkInvoicePayment) and found nothing that pays
//      it, and
//   3. under the row lock it is still PENDING with no payment.
// If the chain check fails (RPC down, wrong cluster), the error propagates and the
// invoice stays PENDING: it is never expired without a successful check.
//
// A payment that lands after this (too late even for the grace period) is still found
// by the late-money watch and recorded as unmatched INVOICE_NOT_PAYABLE (Phase 9).

export type ExpiryOutcome =
  | "not-due" // PENDING but not yet past expires_at + grace
  | "settled" // the chain check found a payment: CONFIRMING or PAID (possibly late)
  | "expired" // PENDING -> EXPIRED
  | "not-pending"; // already CONFIRMING / PAID / EXPIRED / FAILED: nothing to expire

type Ctx = { actor: Actor; requestId?: string; log: Parameters<typeof checkInvoicePayment>[1]["log"] };

export async function expireIfUnpaid(invoiceId: string, ctx: Ctx): Promise<{ outcome: ExpiryOutcome; status: InvoiceStatus }> {
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId }, select: { merchantId: true, status: true } });
  if (!invoice) throw new ApiError("NotFound");
  if (invoice.status !== "PENDING") return { outcome: "not-pending", status: invoice.status };
  if (!(await isDue(invoiceId))) return { outcome: "not-due", status: invoice.status };

  // Chain first. Throws on RPC failure: the invoice stays PENDING.
  const check = await checkInvoicePayment({ invoiceId, merchantId: invoice.merchantId }, ctx);
  if (check.status !== "PENDING") return { outcome: "settled", status: check.status };

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
    const current = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { status: true, expiresAt: true, payment: { select: { id: true } } },
    });
    // A concurrent check or expiry may have changed it while we looked at the chain.
    if (current.status !== "PENDING" || current.payment) return { outcome: "not-pending" as const, status: current.status };

    assertTransition("PENDING", "EXPIRED");
    await tx.invoice.update({ where: { id: invoiceId, status: "PENDING" }, data: { status: "EXPIRED" } });
    await tx.auditLog.create({
      data: {
        actorType: ctx.actor.type,
        actorId: ctx.actor.id,
        action: "invoice.expired",
        entityType: "invoice",
        entityId: invoiceId,
        data: { from: "PENDING", to: "EXPIRED", expiresAt: current.expiresAt.toISOString(), chainCheckedAt: new Date().toISOString() },
        requestId: ctx.requestId,
      },
    });
    ctx.log.info({ invoiceId }, "invoice expired after a chain check found no payment");
    return { outcome: "expired" as const, status: "EXPIRED" as const };
  });
}

// Overdue beyond the grace period, judged by the database's clock (one clock for all
// instances).
async function isDue(invoiceId: string): Promise<boolean> {
  const [row] = await db.$queryRaw<{ due: boolean }[]>`
    SELECT expires_at <= clock_timestamp() - make_interval(secs => ${EXPIRY_GRACE_SECONDS}) AS due
    FROM invoices WHERE id = ${invoiceId}::uuid`;
  return row?.due === true;
}
