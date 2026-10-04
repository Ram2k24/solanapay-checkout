// What the Transactions search box accepts (Phase 12, decision D2): an exact transaction
// signature or an exact invoice number. Anything else is "invalid", never a partial or
// fuzzy match, so the search never needs a scan or user input in SQL patterns.

export type PaymentSearch = { signature: string } | { invoiceNumber: string };

const INVOICE_NUMBER = /^INV-\d{4}-\d{5,}$/i;
// A Solana signature is 64 bytes: 87-88 base58 characters (rarely fewer).
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

// null: empty (no search). "invalid": not a signature or invoice number.
export function parsePaymentSearch(input: string | null | undefined): PaymentSearch | "invalid" | null {
  const value = (input ?? "").trim();
  if (!value) return null;
  if (INVOICE_NUMBER.test(value)) return { invoiceNumber: value.toUpperCase() };
  if (SIGNATURE.test(value)) return { signature: value };
  return "invalid";
}
