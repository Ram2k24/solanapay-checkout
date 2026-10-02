import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Commitment, Invoice, InvoiceStatus, UnmatchedReason } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/config/server-env";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import type { logger } from "@/lib/log/logger";
import { toChainTransaction, type RpcTransactionJson } from "@/lib/solana/chain-transaction";
import {
  assertExpectedCluster,
  getConfirmedTransaction,
  getSignaturesForReference,
} from "@/lib/solana/server-rpc";
import { assertTransition } from "./invoice-state";
import { matchInvoice, readIncomingTransfer, type IncomingTransfer, type InvoiceMatch } from "./verify-payment";

// Checks the chain for payments to one invoice and records what it finds.
//
// Discovery: the Solana Pay reference stored on the invoice (getSignaturesForAddress).
// Verification: verify-payment.ts, against the stored invoice only.
// Recording: one database transaction per signature, with the invoice row locked, so
// concurrent checks (a button press, the Phase 10 poller) serialize. Every write is
// guarded by "already recorded?" checks and the database's own uniqueness rules, so
// running this any number of times records each transaction exactly once.

export type Actor = { type: "USER" | "SYSTEM"; id?: string };
type Log = Pick<typeof logger, "info" | "warn">;

export type CheckResult = {
  status: InvoiceStatus; // invoice status after the check
  recorded: { signature: string; outcome: Outcome }[]; // what this run changed
};

export type Outcome =
  | "payment-confirmed" // new payment, CONFIRMED: invoice CONFIRMING
  | "payment-finalized" // new payment, FINALIZED: invoice PAID
  | "payment-upgraded" // existing payment CONFIRMED -> FINALIZED: invoice PAID
  | `unmatched-${Lowercase<UnmatchedReason>}`;

const NETWORK_FROM_DB = { DEVNET: "devnet", TESTNET: "testnet", MAINNET: "mainnet" } as const;

const INVOICE_TERMS = {
  id: true,
  merchantId: true,
  network: true,
  amount: true,
  tokenMint: true,
  tokenDecimals: true,
  recipientWallet: true,
  reference: true,
  status: true,
  expiresAt: true,
} as const;
type StoredInvoice = Pick<Invoice, keyof typeof INVOICE_TERMS>;

export async function checkInvoicePayment(
  target: { invoiceId: string; merchantId: string },
  ctx: { actor: Actor; requestId?: string; log: Log },
): Promise<CheckResult> {
  const invoice = await db.invoice.findFirst({
    where: { id: target.invoiceId, merchantId: target.merchantId },
    select: INVOICE_TERMS,
  });
  if (!invoice) throw new ApiError("NotFound");
  if (NETWORK_FROM_DB[invoice.network] !== serverEnv.network) {
    throw new Error(`invoice ${invoice.id} is on ${invoice.network}; this server verifies ${serverEnv.network}`);
  }

  const signatures = await rpcCall(async () => {
    await assertExpectedCluster();
    return getSignaturesForReference(invoice.reference);
  });

  const recorded: CheckResult["recorded"] = [];
  // Oldest first, so the first settling payment is the one that settles the invoice.
  for (const entry of [...signatures].reverse()) {
    if (entry.err !== null) continue; // failed transactions move no money
    const commitment: Commitment = entry.confirmationStatus === "finalized" ? "FINALIZED" : "CONFIRMED";
    const outcome = await checkSignature(invoice, entry.signature, commitment, ctx);
    if (outcome) recorded.push({ signature: entry.signature, outcome });
  }

  const { status } = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
  return { status, recorded };
}

async function checkSignature(
  invoice: StoredInvoice,
  signature: string,
  commitment: Commitment,
  ctx: { actor: Actor; requestId?: string; log: Log },
): Promise<Outcome | null> {
  const log = ctx.log;

  // Already recorded? Then the only possible change is the finality upgrade.
  const existingPayment = await db.payment.findUnique({ where: { signature }, select: { id: true } });
  if (existingPayment) {
    return commitment === "FINALIZED" ? upgradeToFinalized(invoice.id, signature, ctx) : null;
  }
  if (await db.unmatchedPayment.findUnique({ where: { signature }, select: { id: true } })) return null;

  const rpcTx = await rpcCall(() => getConfirmedTransaction(signature));
  if (!rpcTx) return null; // not visible at "confirmed" yet: a later check will see it
  const incoming = await readIncomingTransfer(toChainTransaction(rpcTx as RpcTransactionJson), invoice);
  if (!incoming) {
    log.info({ invoiceId: invoice.id, signature }, "transaction doesn't credit the merchant; ignored");
    return null;
  }
  const match = matchInvoice(incoming, invoice);
  log.info({ invoiceId: invoice.id, signature, match: match.kind, commitment }, "payment verification");

  if (match.kind === "not-this-invoice") {
    // Found via this invoice's reference, but the reference isn't on a valid transfer.
    // If it carries another of this merchant's references, that invoice's check handles it.
    if (incoming.references.length > 0) {
      const other = await db.invoice.findFirst({
        where: { merchantId: invoice.merchantId, reference: { in: incoming.references } },
        select: { id: true },
      });
      if (other) return null;
    }
    return recordUnmatchedPayment(invoice, incoming, commitment, ctx);
  }

  return settleOrRecord(invoice, incoming, match, commitment, ctx);
}

// Under the invoice row lock: settle the invoice, or record why this payment can't.
async function settleOrRecord(
  invoice: StoredInvoice,
  incoming: IncomingTransfer,
  match: Exclude<InvoiceMatch, { kind: "not-this-invoice" }>,
  commitment: Commitment,
  ctx: { actor: Actor; requestId?: string; log: Log },
): Promise<Outcome | null> {
  return writeOnce(async (tx) => {
    const current = await lockInvoice(tx, invoice.id);
    if (await isRecorded(tx, incoming.signature)) return null; // a concurrent check won

    if (match.kind === "amount-mismatch") {
      return insertUnmatched(tx, invoice, incoming, commitment, "AMOUNT_MISMATCH", invoice, ctx);
    }
    if (current.payment) {
      return insertUnmatched(tx, invoice, incoming, commitment, "DUPLICATE_PAYMENT", invoice, ctx);
    }
    if (current.status !== "PENDING") {
      return insertUnmatched(tx, invoice, incoming, commitment, "INVOICE_NOT_PAYABLE", invoice, ctx);
    }

    const now = new Date();
    const payment = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        signature: incoming.signature,
        network: invoice.network,
        reference: invoice.reference,
        senderWallet: match.senderWallet,
        recipientWallet: invoice.recipientWallet,
        recipientTokenAccount: incoming.recipientTokenAccount,
        tokenMint: invoice.tokenMint,
        amount: incoming.amount,
        slot: incoming.slot,
        blockTime: incoming.blockTime,
        commitment,
        late: match.late,
        verifiedAt: now,
        finalizedAt: commitment === "FINALIZED" ? now : null,
      },
    });
    await audit(tx, ctx, "payment.recorded", "payment", payment.id, {
      invoiceId: invoice.id,
      signature: incoming.signature,
      amount: incoming.amount.toString(),
      commitment,
      late: match.late,
    });

    let status = await transition(tx, invoice.id, "PENDING", "CONFIRMING", ctx);
    if (commitment === "FINALIZED") status = await transition(tx, invoice.id, status, "PAID", ctx, now);
    ctx.log.info({ invoiceId: invoice.id, paymentId: payment.id, signature: incoming.signature, status, late: match.late }, "payment recorded");
    return commitment === "FINALIZED" ? "payment-finalized" : "payment-confirmed";
  });
}

async function upgradeToFinalized(
  invoiceId: string,
  signature: string,
  ctx: { actor: Actor; requestId?: string; log: Log },
): Promise<Outcome | null> {
  return writeOnce(async (tx) => {
    const current = await lockInvoice(tx, invoiceId);
    const payment = await tx.payment.findUnique({ where: { signature } });
    if (!payment || payment.invoiceId !== invoiceId || payment.commitment === "FINALIZED") return null;

    const now = new Date();
    await tx.payment.update({ where: { id: payment.id }, data: { commitment: "FINALIZED", finalizedAt: now } });
    await audit(tx, ctx, "payment.finalized", "payment", payment.id, { invoiceId, signature });
    if (current.status === "CONFIRMING") await transition(tx, invoiceId, "CONFIRMING", "PAID", ctx, now);
    ctx.log.info({ invoiceId, paymentId: payment.id, signature }, "payment finalized");
    return "payment-upgraded";
  });
}

// Where an incoming payment landed: the merchant, network, wallet and mint it credited.
export type Ledger = Pick<Invoice, "merchantId" | "network" | "recipientWallet" | "tokenMint">;

// Records money that isn't tied to any invoice of the merchant: NO_REFERENCE if the
// transfer carries no reference, UNKNOWN_REFERENCE otherwise. Returns null if the
// transaction is already recorded (here or as a payment).
export function recordUnmatchedPayment(
  ledger: Ledger,
  incoming: IncomingTransfer,
  commitment: Commitment,
  ctx: { actor: Actor; requestId?: string; log: Log },
): Promise<Outcome | null> {
  const reason = incoming.references.length > 0 ? "UNKNOWN_REFERENCE" : "NO_REFERENCE";
  return writeOnce(async (tx) => {
    if (await isRecorded(tx, incoming.signature)) return null;
    return insertUnmatched(tx, ledger, incoming, commitment, reason, null, ctx);
  });
}

async function insertUnmatched(
  tx: Prisma.TransactionClient,
  ledger: Ledger,
  incoming: IncomingTransfer,
  commitment: Commitment,
  reason: UnmatchedReason,
  invoice: Pick<Invoice, "id" | "reference"> | null, // the invoice the payment was meant for, if known
  ctx: { actor: Actor; requestId?: string; log: Log },
): Promise<Outcome> {
  const invoiceId = invoice?.id ?? null;
  const entry = await tx.unmatchedPayment.create({
    data: {
      merchantId: ledger.merchantId,
      invoiceId,
      reason,
      signature: incoming.signature,
      network: ledger.network,
      reference: reason === "NO_REFERENCE" ? null : (invoice?.reference ?? incoming.references[0] ?? null),
      senderWallet: incoming.senderWallet,
      recipientWallet: ledger.recipientWallet,
      recipientTokenAccount: incoming.recipientTokenAccount,
      tokenMint: ledger.tokenMint,
      amount: incoming.amount,
      slot: incoming.slot,
      blockTime: incoming.blockTime,
      commitment,
    },
  });
  await audit(tx, ctx, "payment.unmatched", "unmatched_payment", entry.id, {
    reason,
    invoiceId,
    signature: incoming.signature,
    amount: incoming.amount.toString(),
  });
  ctx.log.warn({ invoiceId, unmatchedId: entry.id, signature: incoming.signature, reason }, "unmatched payment recorded");
  return `unmatched-${reason.toLowerCase() as Lowercase<UnmatchedReason>}`;
}

// --- helpers ------------------------------------------------------------------

// SELECT ... FOR UPDATE: concurrent checks of the same invoice wait here in turn.
async function lockInvoice(tx: Prisma.TransactionClient, invoiceId: string) {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
  return tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, payment: { select: { id: true } } } });
}

async function isRecorded(tx: Prisma.TransactionClient, signature: string): Promise<boolean> {
  const [payment, unmatched] = await Promise.all([
    tx.payment.findUnique({ where: { signature }, select: { id: true } }),
    tx.unmatchedPayment.findUnique({ where: { signature }, select: { id: true } }),
  ]);
  return Boolean(payment || unmatched);
}

async function transition(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  from: InvoiceStatus,
  to: InvoiceStatus,
  ctx: { actor: Actor; requestId?: string },
  paidAt?: Date,
): Promise<InvoiceStatus> {
  assertTransition(from, to);
  await tx.invoice.update({ where: { id: invoiceId, status: from }, data: { status: to, ...(to === "PAID" ? { paidAt } : {}) } });
  await audit(tx, ctx, "invoice.status_changed", "invoice", invoiceId, { from, to });
  return to;
}

function audit(
  tx: Prisma.TransactionClient,
  ctx: { actor: Actor; requestId?: string },
  action: string,
  entityType: string,
  entityId: string,
  data: Prisma.InputJsonObject,
) {
  return tx.auditLog.create({
    data: { actorType: ctx.actor.type, actorId: ctx.actor.id, action, entityType, entityId, data, requestId: ctx.requestId },
  });
}

// Runs a recording transaction. If a concurrent writer recorded the same signature
// first (unique index, or the cross-table trigger's P0001), that's success: the
// transaction is recorded exactly once, by whoever got there first.
async function writeOnce<T>(fn: (tx: Prisma.TransactionClient) => Promise<T | null>): Promise<T | null> {
  try {
    return await db.$transaction(fn);
  } catch (error) {
    if (isAlreadyRecorded(error)) return null;
    throw error;
  }
}

function isAlreadyRecorded(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return true;
  return error instanceof Error && /is already recorded/.test(error.message);
}

export async function rpcCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.name === "WrongClusterError") throw error; // misconfiguration: a 500, not a retry
    throw new ApiError("RpcUnavailable", undefined, { cause: error });
  }
}
