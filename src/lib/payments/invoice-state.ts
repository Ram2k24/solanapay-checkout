import type { InvoiceStatus } from "@/generated/prisma/enums";

// The invoice lifecycle. Every status change in the app must go through
// assertTransition(), so an invoice can only move along these arrows:
//
//   PENDING ──▶ CONFIRMING ──▶ PAID
//      │             │
//      ├──▶ EXPIRED  └──▶ FAILED
//      └──▶ FAILED
//
// DRAFT exists in the database enum but is not used (invoices are created PENDING).
const TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ["PENDING"],
  PENDING: ["CONFIRMING", "EXPIRED", "FAILED"],
  CONFIRMING: ["PAID", "FAILED"],
  PAID: [],
  EXPIRED: [],
  FAILED: [],
};

export class InvalidTransitionError extends Error {
  constructor(readonly from: InvoiceStatus, readonly to: InvoiceStatus) {
    super(`Invalid invoice status transition: ${from} -> ${to}`);
  }
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

// The status to show. A PENDING invoice past its expiry is displayed as EXPIRED even
// before the background job (Phase 10) updates the row. CONFIRMING is never shown as
// expired: a payment seen before expiry still completes.
export function effectiveStatus(invoice: { status: InvoiceStatus; expiresAt: Date }, now = new Date()): InvoiceStatus {
  return invoice.status === "PENDING" && invoice.expiresAt <= now ? "EXPIRED" : invoice.status;
}
