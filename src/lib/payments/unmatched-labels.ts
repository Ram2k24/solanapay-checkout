import type { UnmatchedReason } from "@/generated/prisma/enums";

// Plain-language explanations of why a payment couldn't settle an invoice automatically.
export const UNMATCHED_REASONS: Record<UnmatchedReason, { label: string; detail: string }> = {
  NO_REFERENCE: { label: "No reference", detail: "Paid without an invoice reference (the wallet didn't include it)." },
  UNKNOWN_REFERENCE: { label: "Unknown reference", detail: "Carries a reference that matches none of your invoices." },
  AMOUNT_MISMATCH: { label: "Wrong amount", detail: "Matches an invoice, but the amount isn't exactly the invoice amount." },
  DUPLICATE_PAYMENT: { label: "Paid twice", detail: "A second payment for an invoice that was already paid." },
  INVOICE_NOT_PAYABLE: { label: "Invoice closed", detail: "Matches an invoice that had already expired or failed." },
};
