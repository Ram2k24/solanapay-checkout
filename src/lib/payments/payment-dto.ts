import type { Payment, UnmatchedPayment } from "@/generated/prisma/client";
import { USDC_DECIMALS } from "@/lib/config/networks";
import { formatUnits } from "@/lib/money/format";
import { explorerTxUrl } from "@/lib/solana/explorer";

// API/UI representations of recorded payments. bigint values are sent as strings.

export type PaymentDto = ReturnType<typeof toPaymentDto>;

export function toPaymentDto(payment: Payment) {
  return {
    id: payment.id,
    signature: payment.signature,
    senderWallet: payment.senderWallet,
    recipientWallet: payment.recipientWallet,
    amount: payment.amount.toString(),
    amountDisplay: formatUnits(payment.amount, USDC_DECIMALS),
    slot: payment.slot.toString(),
    blockTime: payment.blockTime?.toISOString() ?? null,
    commitment: payment.commitment,
    late: payment.late,
    verifiedAt: payment.verifiedAt.toISOString(),
    finalizedAt: payment.finalizedAt?.toISOString() ?? null,
  };
}

export type RecentPaymentDto = ReturnType<typeof toRecentPaymentDto>;

// A payment row for the dashboard (and Phase 12's Transactions page): the payment plus
// the invoice it settled and its Explorer link.
export function toRecentPaymentDto(payment: Payment & { invoice: { id: string; invoiceNumber: string } }) {
  return {
    ...toPaymentDto(payment),
    invoiceId: payment.invoice.id,
    invoiceNumber: payment.invoice.invoiceNumber,
    explorerUrl: explorerTxUrl(payment.signature, payment.network),
  };
}

export type UnmatchedPaymentDto = ReturnType<typeof toUnmatchedPaymentDto>;

export function toUnmatchedPaymentDto(entry: UnmatchedPayment & { invoice?: { invoiceNumber: string } | null }) {
  return {
    id: entry.id,
    reason: entry.reason,
    status: entry.status,
    signature: entry.signature,
    senderWallet: entry.senderWallet,
    amount: entry.amount.toString(),
    amountDisplay: formatUnits(entry.amount, USDC_DECIMALS),
    reference: entry.reference,
    invoiceId: entry.invoiceId,
    invoiceNumber: entry.invoice?.invoiceNumber ?? null,
    blockTime: entry.blockTime?.toISOString() ?? null,
    commitment: entry.commitment,
    resolutionNote: entry.resolutionNote,
    resolvedAt: entry.resolvedAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
  };
}
