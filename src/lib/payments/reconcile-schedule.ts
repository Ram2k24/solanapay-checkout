import type { InvoiceStatus } from "@/generated/prisma/enums";
import { EXPIRY_GRACE_SECONDS } from "./policy";

// When the reconciler should look at an invoice next (Phase 10, locked cadence).
// Pure functions: the reconciler stores the result in invoice_checks.next_check_at.

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export const CADENCE = {
  pendingFresh: 30 * SECOND, // PENDING, first 10 minutes after creation
  pendingFreshFor: 10 * MINUTE,
  pendingOlder: 2 * MINUTE, // PENDING, older
  confirming: 15 * SECOND, // CONFIRMING, until finalized
  expiredWatch: 10 * MINUTE, // EXPIRED: late-money watch...
  expiredWatchFor: 24 * 60 * MINUTE, // ...for 24 hours after expires_at
  stuckConfirmingAfter: 10 * MINUTE, // warn (only) if CONFIRMING longer than this
} as const;

// RPC-error backoff after the n-th consecutive failure: 30 s, 1, 2, 4, 8, then 10 min.
export const BACKOFF_MS = [30 * SECOND, MINUTE, 2 * MINUTE, 4 * MINUTE, 8 * MINUTE, 10 * MINUTE] as const;

export function backoffAfter(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]!;
}

// null: no further checks (PAID, FAILED, or EXPIRED past the 24-hour watch).
export function nextCheckAt(invoice: { status: InvoiceStatus; createdAt: Date; expiresAt: Date }, now: Date): Date | null {
  const t = now.getTime();
  const expires = invoice.expiresAt.getTime();
  const at = (ms: number) => new Date(ms);

  switch (invoice.status) {
    case "PENDING": {
      // The expiry decision is due at expires_at + grace; never schedule past it.
      const expiryDecision = expires + EXPIRY_GRACE_SECONDS * SECOND;
      const age = t - invoice.createdAt.getTime();
      const step = age < CADENCE.pendingFreshFor ? CADENCE.pendingFresh : CADENCE.pendingOlder;
      return at(Math.max(t, Math.min(t + step, expiryDecision)));
    }
    case "CONFIRMING":
      return at(t + CADENCE.confirming);
    case "EXPIRED": {
      const watchEnds = expires + CADENCE.expiredWatchFor;
      return t >= watchEnds ? null : at(Math.min(t + CADENCE.expiredWatch, watchEnds));
    }
    case "PAID":
    case "FAILED":
    case "DRAFT":
      return null;
  }
}
