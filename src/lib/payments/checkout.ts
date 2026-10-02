import "server-only";
import { z } from "zod";
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
  // The verified on-chain payment (CONFIRMING or PAID). Public chain data only: the
  // transaction signature and its time, not the payer's wallet.
  confirmation: { signature: string; amountDisplay: string; blockTime: string | null; finalized: boolean; explorerUrl: string } | null;
};

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
    confirmation: invoice.payment
      ? {
          signature: invoice.payment.signature,
          amountDisplay: formatUnits(invoice.payment.amount, invoice.tokenDecimals),
          blockTime: invoice.payment.blockTime?.toISOString() ?? null,
          finalized: invoice.payment.commitment === "FINALIZED",
          explorerUrl: explorerTxUrl(invoice.payment.signature, invoice.network),
        }
      : null,
  };
}
