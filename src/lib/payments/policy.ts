// Invoice rules shared by the server (authoritative) and the UI (for display).
// No secrets here: this module is safe to import from browser code.

export const INVOICE_EXPIRY_MINUTES = {
  default: 30,
  min: 5,
  max: 24 * 60,
  presets: [15, 30, 60, 24 * 60],
} as const;

export const INVOICE_TEXT_LIMITS = {
  orderId: 64,
  description: 500,
  customerReference: 120,
} as const;
