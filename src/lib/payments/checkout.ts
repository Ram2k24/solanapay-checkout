import "server-only";
import { z } from "zod";
import type { Invoice, Payment } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { formatUnits } from "@/lib/money/format";
import { shortenAddress } from "@/lib/solana/address";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { effectiveStatus } from "./invoice-state";
import { publicEnv } from "@/lib/config/public-env";
import { paymentLinks, type PaymentLinks } from "./solana-pay";

// What a customer may see about an invoice on the public checkout page. This is an
// explicit allowlist: internal fields (customer reference, merchant email, merchant
// and user IDs, idempotency data) are never selected, so they can't leak.
export type PublicCheckout = {
  invoiceNumber: string;
  orderId: string | null;
  description: string | null;
  merchantName: string;
  amountDisplay: string;
  currency: string;
  network: string;
  recipientShort: string;
  expiresAt: string;
  status: ReturnType<typeof effectiveStatus>;
  // Only while the invoice can be paid (effective status PENDING); built from the
  // stored invoice row, never from request input.
  payment: PaymentLinks | null;
  confirmation: PublicConfirmation | null;
};

// The verified on-chain payment (CONFIRMING or PAID), as customers may see it on the
// checkout page and from the status API. Public chain data only: the transaction
// signature and its time, never the payer's wallet.
export type PublicConfirmation = {
  signature: string;
  amountDisplay: string;
  blockTime: string | null;
  finalized: boolean;
  explorerUrl: string;
};

export function toPublicConfirmation(
  payment: Pick<Payment, "signature" | "amount" | "blockTime" | "commitment"> | null,
  invoice: Pick<Invoice, "tokenDecimals" | "network">,
): PublicConfirmation | null {
  if (!payment) return null;
  return {
    signature: payment.signature,
    amountDisplay: formatUnits(payment.amount, invoice.tokenDecimals),
    blockTime: payment.blockTime?.toISOString() ?? null,
    finalized: payment.commitment === "FINALIZED",
    explorerUrl: explorerTxUrl(payment.signature, invoice.network),
  };
}

export async function getPublicCheckout(
  id: string,
  now = new Date(),
  appUrl = publicEnv.NEXT_PUBLIC_APP_URL,
): Promise<PublicCheckout | null> {
  if (!z.uuid().safeParse(id).success) return null;

  const invoice = await db.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      invoiceNumber: true,
      orderId: true,
      description: true,
      network: true,
      currency: true,
      amount: true,
      tokenMint: true,
      tokenDecimals: true,
      recipientWallet: true,
      reference: true,
      status: true,
      expiresAt: true,
      merchant: { select: { name: true } },
      payment: { select: { signature: true, amount: true, blockTime: true, commitment: true } },
    },
  });
  if (!invoice) return null;

  const status = effectiveStatus(invoice, now);
  return {
    invoiceNumber: invoice.invoiceNumber,
    orderId: invoice.orderId,
    description: invoice.description,
    merchantName: invoice.merchant.name,
    amountDisplay: formatUnits(invoice.amount, invoice.tokenDecimals),
    currency: invoice.currency,
    network: invoice.network,
    recipientShort: shortenAddress(invoice.recipientWallet),
    expiresAt: invoice.expiresAt.toISOString(),
    status,
    payment: status === "PENDING" ? paymentLinks(invoice, invoice.merchant.name, appUrl) : null,
    confirmation: toPublicConfirmation(invoice.payment, invoice),
  };
}
