// Invoice rules shared by the server (authoritative) and the UI (for display).
// No secrets here: this module is safe to import from browser code.

export const INVOICE_EXPIRY_MINUTES = {
  default: 30,
  min: 5,
  max: 24 * 60,
  presets: [15, 30, 60, 24 * 60],
} as const;

// After expires_at the customer sees the invoice as expired, but the stored invoice
// stays PENDING for this grace period: a payment submitted just before expiry can take
// up to ~90 s to land (blockhash lifetime) plus ~15 s to finalize. Only after it does
// the reconciler check the chain and, if nothing paid, mark the invoice EXPIRED.
export const EXPIRY_GRACE_SECONDS = 180;

export const INVOICE_TEXT_LIMITS = {
  orderId: 64,
  description: 500,
  customerReference: 120,
} as const;
