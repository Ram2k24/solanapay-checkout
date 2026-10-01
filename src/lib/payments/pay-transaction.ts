import "server-only";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { getLatestBlockhash } from "@/lib/solana/server-rpc";
import { effectiveStatus } from "./invoice-state";
import { paymentMessage } from "./solana-pay";
import { buildPaymentTransaction, parseCustomerAccount, TransactionRequestError } from "./transaction-request";

// Server side of a Solana Pay Transaction Request for one invoice.
// Inputs: the invoice ID (URL path) and the customer's account (POST body). Every
// payment term is read from the stored invoice row. Handing out a transaction changes
// nothing: it is not evidence of payment, and the invoice stays PENDING until the
// payment is verified on-chain (Phase 9).

// No new transaction for an invoice about to expire: the customer would be signing a
// payment that may land after expiry. Phase 9 still checks expiry when verifying.
export const MIN_REMAINING_MS = 120_000;

export async function getTransactionRequestLabel(id: string): Promise<{ label: string } | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const invoice = await db.invoice.findUnique({ where: { id }, select: { merchant: { select: { name: true } } } });
  return invoice ? { label: invoice.merchant.name } : null;
}

export async function createPaymentTransaction(
  id: string,
  customerAccount: string,
  now = new Date(),
): Promise<{ transaction: string; message: string }> {
  if (!z.uuid().safeParse(id).success) throw new ApiError("NotFound");

  const invoice = await db.invoice.findUnique({
    where: { id },
    select: {
      invoiceNumber: true,
      description: true,
      network: true,
      amount: true,
      tokenMint: true,
      tokenDecimals: true,
      recipientWallet: true,
      reference: true,
      status: true,
      expiresAt: true,
    },
  });
  if (!invoice) throw new ApiError("NotFound");

  if (effectiveStatus(invoice, now) !== "PENDING") throw new ApiError("InvoiceNotPayable");
  if (invoice.expiresAt.getTime() - now.getTime() < MIN_REMAINING_MS) throw new ApiError("InvoiceNotPayable");

  try {
    parseCustomerAccount(customerAccount, invoice); // reject early, before the RPC call
    let blockhash;
    try {
      blockhash = await getLatestBlockhash();
    } catch (error) {
      throw new ApiError("RpcUnavailable", undefined, { cause: error });
    }
    const transaction = await buildPaymentTransaction(invoice, customerAccount, blockhash);
    return { transaction, message: paymentMessage(invoice) };
  } catch (error) {
    if (error instanceof TransactionRequestError) {
      if (error.code === "InvalidCustomerAccount") throw new ApiError("InvalidAccount");
      if (error.code === "CustomerIsRecipient") throw new ApiError("SelfPaymentNotAllowed");
    }
    throw error; // UnsupportedInvoiceTerms is a server-side problem: logged as an internal error
  }
}
