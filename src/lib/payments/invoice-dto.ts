import type { Invoice } from "@/generated/prisma/client";
import { formatUnits } from "@/lib/money/format";
import { effectiveStatus } from "./invoice-state";

// API/UI representation of an invoice. JSON can't carry bigint, so amounts are sent
// as base-unit strings (exact) plus a formatted display string.
export type InvoiceDto = ReturnType<typeof toInvoiceDto>;

export function toInvoiceDto(invoice: Invoice, now = new Date()) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    orderId: invoice.orderId,
    description: invoice.description,
    customerReference: invoice.customerReference,
    network: invoice.network,
    currency: invoice.currency,
    amount: invoice.amount.toString(),
    amountDisplay: formatUnits(invoice.amount, invoice.tokenDecimals),
    tokenMint: invoice.tokenMint,
    tokenDecimals: invoice.tokenDecimals,
    recipientWallet: invoice.recipientWallet,
    reference: invoice.reference,
    status: invoice.status,
    effectiveStatus: effectiveStatus(invoice, now),
    expiresAt: invoice.expiresAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
  };
}
