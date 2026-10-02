import "server-only";
import type { UnmatchedStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { toUnmatchedPaymentDto } from "./payment-dto";

// The merchant's unmatched payments (suspense list), newest first.
export async function listUnmatchedPayments(merchantId: string, status: UnmatchedStatus, limit = 100) {
  const entries = await db.unmatchedPayment.findMany({
    where: { merchantId, status },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { invoice: { select: { invoiceNumber: true } } },
  });
  return entries.map(toUnmatchedPaymentDto);
}

// Marks an OPEN entry as resolved, with the merchant's note (e.g. "Refunded to sender,
// tx …"). Resolving is final: the database rejects any later change.
export async function resolveUnmatchedPayment(
  target: { id: string; merchantId: string },
  resolution: { note: string; userId: string; requestId?: string },
) {
  return db.$transaction(async (tx) => {
    const now = new Date();
    // Conditional update: only an OPEN entry of this merchant; concurrent resolves can't both win.
    const { count } = await tx.unmatchedPayment.updateMany({
      where: { id: target.id, merchantId: target.merchantId, status: "OPEN" },
      data: { status: "RESOLVED", resolutionNote: resolution.note, resolvedAt: now, resolvedByUserId: resolution.userId },
    });
    if (count === 0) {
      const exists = await tx.unmatchedPayment.findFirst({ where: { id: target.id, merchantId: target.merchantId }, select: { id: true } });
      throw new ApiError(exists ? "PaymentAlreadyProcessed" : "NotFound");
    }
    await tx.auditLog.create({
      data: {
        actorType: "USER",
        actorId: resolution.userId,
        action: "unmatched.resolved",
        entityType: "unmatched_payment",
        entityId: target.id,
        data: { note: resolution.note },
        requestId: resolution.requestId,
      },
    });
    const entry = await tx.unmatchedPayment.findUniqueOrThrow({
      where: { id: target.id },
      include: { invoice: { select: { invoiceNumber: true } } },
    });
    return toUnmatchedPaymentDto(entry);
  });
}
