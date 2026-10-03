// Browser-wide note of an in-browser payment attempt per invoice (Phase 8.5, option A,
// 2026-10-03), so a second tab or a reload doesn't offer a second payment while the
// first is being approved or is on its way. Live devnet testing paid one invoice twice
// from two tabs 3-4 s apart, faster than detection.
//
// A convenience for this browser only, kept in localStorage: never evidence of payment
// and never shared with the server. Whether the invoice is paid is decided only by the
// server's on-chain verification; a second payment from another device is recorded by
// Phase 9 as a duplicate. Every function tolerates missing, blocked or garbled storage.

export const ATTEMPT_HOLD_MS = 120_000; // about a blockhash lifetime, plus detection time
const KEEP_SENT_MS = 24 * 60 * 60_000; // after that, forget the note entirely

export type PaymentAttempt =
  | { state: "approving"; attemptId: string; at: number }
  | { state: "sent"; attemptId: string; at: number; signature: string };

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const attemptKey = (invoiceId: string) => `solanapay:payment-attempt:${invoiceId}`;

export function readAttempt(storage: StorageLike | null, invoiceId: string, now = Date.now()): PaymentAttempt | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(attemptKey(invoiceId));
    if (!raw) return null;
    const attempt = parse(raw);
    const lifetime = attempt?.state === "sent" ? KEEP_SENT_MS : ATTEMPT_HOLD_MS;
    if (!attempt || now - attempt.at >= lifetime || attempt.at > now + 60_000) {
      storage.removeItem(attemptKey(invoiceId)); // garbled, stale, or from the future
      return null;
    }
    return attempt;
  } catch {
    return null;
  }
}

export function writeAttempt(storage: StorageLike | null, invoiceId: string, attempt: PaymentAttempt): void {
  try {
    storage?.setItem(attemptKey(invoiceId), JSON.stringify(attempt));
  } catch {
    // storage full or blocked: the panel still works, just without the cross-tab note
  }
}

// Removes the note only if it is still this attempt's: another tab's newer attempt stays.
export function clearAttempt(storage: StorageLike | null, invoiceId: string, attemptId: string): void {
  try {
    const raw = storage?.getItem(attemptKey(invoiceId));
    if (raw && parse(raw)?.attemptId === attemptId) storage!.removeItem(attemptKey(invoiceId));
  } catch {
    // nothing to do
  }
}

// Whether `attempt` (from another tab or an earlier page view) should hold back a new
// payment from `ownAttemptId`. After the hold, a sent note is still shown, with an
// explicit "Pay again anyway".
export function holdsPayment(attempt: PaymentAttempt | null, ownAttemptId: string | null, now = Date.now()): boolean {
  return attempt !== null && attempt.attemptId !== ownAttemptId && now - attempt.at < ATTEMPT_HOLD_MS;
}

// The moment the hold ends, for re-rendering; null when nothing is held.
export function holdEndsAt(attempt: PaymentAttempt | null): number | null {
  return attempt ? attempt.at + ATTEMPT_HOLD_MS : null;
}

function parse(raw: string): PaymentAttempt | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.attemptId !== "string" || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    if (v.state === "approving") return { state: "approving", attemptId: v.attemptId, at: v.at };
    // A Solana signature is 64 bytes: 87 or 88 base58 characters (rarely fewer).
    if (v.state === "sent" && typeof v.signature === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v.signature)) {
      return { state: "sent", attemptId: v.attemptId, at: v.at, signature: v.signature };
    }
    return null;
  } catch {
    return null;
  }
}
