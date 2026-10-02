import "server-only";
import { isSignature } from "@solana/kit";
import type { InvoiceStatus } from "@/generated/prisma/client";
import { USDC_DECIMALS } from "@/lib/config/networks";
import { serverEnv } from "@/lib/config/server-env";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { toChainTransaction, type RpcTransactionJson } from "@/lib/solana/chain-transaction";
import { assertExpectedCluster, getConfirmedTransaction, getSignatureStatus } from "@/lib/solana/server-rpc";
import { checkInvoicePayment, recordUnmatchedPayment, rpcCall, type Actor, type CheckResult } from "./check-payment";
import { toUnmatchedPaymentDto, type UnmatchedPaymentDto } from "./payment-dto";
import { readIncomingTransfer } from "./verify-payment";

// A merchant asks about one transaction by its signature (e.g. a customer says "I paid,
// here's the signature"). The signature is only a lookup key: the server fetches the
// transaction from its own RPC and verifies everything itself. Outcomes:
//   - doesn't credit the merchant's payout wallet in USDC: rejected, nothing recorded
//   - carries the reference of one of the merchant's invoices: that invoice is checked
//   - otherwise: recorded as an unmatched payment for review

export type LookupResult =
  | { outcome: "invoice"; invoiceId: string; invoiceNumber: string; status: InvoiceStatus; recorded: CheckResult["recorded"] }
  | { outcome: "unmatched"; entry: UnmatchedPaymentDto; created: boolean };

const NETWORK_TO_DB = { devnet: "DEVNET", testnet: "TESTNET", mainnet: "MAINNET" } as const;

type Ctx = { actor: Actor; requestId?: string; log: Parameters<typeof checkInvoicePayment>[1]["log"] };

export async function lookupTransaction(
  merchant: { id: string; payoutWallet: string },
  signature: string,
  ctx: Ctx,
): Promise<LookupResult> {
  if (!isSignature(signature)) {
    throw new ApiError("InvalidRequest", { signature: "Enter a valid Solana transaction signature." });
  }

  // Already recorded for this merchant: report it (an invoice check may still upgrade finality).
  const recordedPayment = await db.payment.findFirst({
    where: { signature, invoice: { merchantId: merchant.id } },
    select: { invoiceId: true },
  });
  if (recordedPayment) return checkInvoice(recordedPayment.invoiceId, merchant.id, ctx);
  const recordedEntry = await findUnmatched(signature, merchant.id);
  if (recordedEntry) return { outcome: "unmatched", entry: recordedEntry, created: false };

  const status = await rpcCall(async () => {
    await assertExpectedCluster();
    return getSignatureStatus(signature);
  });
  if (!status || (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized")) {
    throw new ApiError("TransactionNotFound");
  }
  if (status.err !== null) throw new ApiError("TransactionFailed");

  const rpcTx = await rpcCall(() => getConfirmedTransaction(signature));
  if (!rpcTx) throw new ApiError("TransactionNotFound");
  const incoming = await readIncomingTransfer(toChainTransaction(rpcTx as RpcTransactionJson), {
    recipientWallet: merchant.payoutWallet,
    tokenMint: serverEnv.usdcMint,
    tokenDecimals: USDC_DECIMALS,
  });
  if (!incoming) throw new ApiError("InvalidRecipient");

  if (incoming.references.length > 0) {
    const invoice = await db.invoice.findFirst({
      where: { merchantId: merchant.id, reference: { in: incoming.references } },
      select: { id: true },
    });
    if (invoice) return checkInvoice(invoice.id, merchant.id, ctx);
  }

  const outcome = await recordUnmatchedPayment(
    {
      merchantId: merchant.id,
      network: NETWORK_TO_DB[serverEnv.network],
      recipientWallet: merchant.payoutWallet,
      tokenMint: serverEnv.usdcMint,
    },
    incoming,
    status.confirmationStatus === "finalized" ? "FINALIZED" : "CONFIRMED",
    ctx,
  );
  const entry = await findUnmatched(signature, merchant.id);
  if (!entry) throw new Error(`transaction ${signature} credited merchant ${merchant.id} but isn't recorded for it`);
  return { outcome: "unmatched", entry, created: outcome !== null };
}

async function checkInvoice(invoiceId: string, merchantId: string, ctx: Ctx): Promise<LookupResult> {
  const result = await checkInvoicePayment({ invoiceId, merchantId }, ctx);
  const { invoiceNumber } = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { invoiceNumber: true } });
  return { outcome: "invoice", invoiceId, invoiceNumber, status: result.status, recorded: result.recorded };
}

async function findUnmatched(signature: string, merchantId: string) {
  const entry = await db.unmatchedPayment.findFirst({
    where: { signature, merchantId },
    include: { invoice: { select: { invoiceNumber: true } } },
  });
  return entry ? toUnmatchedPaymentDto(entry) : null;
}
