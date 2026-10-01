import { formatUnits } from "@/lib/money/format";

// Solana Pay transfer request URLs, implemented from the official specification:
// https://github.com/solana-foundation/pay (typescript/packages/solana-pay/spec/SPEC.md)
//
//   solana:<recipient>?amount=<amount>&spl-token=<mint>&reference=<ref>&label=<label>&message=<message>
//
// Only what this app needs: SPL token (USDC) transfer requests with one reference.
// No memo (it would be stored publicly on-chain) and no redirect.

// The stored invoice fields a payment link is built from. Callers pass the
// database row; nothing here comes from a browser request.
export type TransferRequestInvoice = {
  recipientWallet: string;
  amount: bigint; // token base units
  tokenDecimals: number;
  tokenMint: string;
  reference: string;
  invoiceNumber: string;
  description: string | null;
};

// Spec: "user" units (not base units), a leading 0 before the decimal point,
// no scientific notation. 10_000_000n (6 decimals) -> "10", 1n -> "0.000001".
export function formatTransferAmount(amount: bigint, decimals: number): string {
  if (amount < 0n) throw new Error("amount must not be negative");
  return formatUnits(amount, decimals, 0).replaceAll(",", "");
}

// Spec: label and message are URL-encoded UTF-8 (encodeURIComponent, so a space is
// %20, not "+"). Fields are emitted in the spec template's order; absent ones are omitted.
export function buildTransferRequestUrl(fields: {
  recipient: string;
  amount?: string;
  splToken?: string;
  reference?: string;
  label?: string;
  message?: string;
}): string {
  const params: [string, string | undefined][] = [
    ["amount", fields.amount],
    ["spl-token", fields.splToken],
    ["reference", fields.reference],
    ["label", fields.label],
    ["message", fields.message],
  ];
  const query = params
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `solana:${fields.recipient}${query ? `?${query}` : ""}`;
}

// The message wallets show with a payment request: "INV-2026-00001 · Laptop accessory purchase".
export function paymentMessage(invoice: Pick<TransferRequestInvoice, "invoiceNumber" | "description">): string {
  return invoice.description ? `${invoice.invoiceNumber} · ${invoice.description}` : invoice.invoiceNumber;
}

// The payment link for a stored invoice: USDC transfer of the exact invoice amount
// to the merchant's wallet, tagged with the invoice's reference.
export function encodeTransferRequest(invoice: TransferRequestInvoice, merchantName: string): string {
  return buildTransferRequestUrl({
    recipient: invoice.recipientWallet,
    amount: formatTransferAmount(invoice.amount, invoice.tokenDecimals),
    splToken: invoice.tokenMint,
    reference: invoice.reference,
    label: merchantName,
    message: paymentMessage(invoice),
  });
}
