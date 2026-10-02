import "server-only";
import { z } from "zod";
import type { InvoiceStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { consumeRateLimit } from "@/lib/http/rate-limit";
import type { logger } from "@/lib/log/logger";
import { checkInvoicePayment } from "./check-payment";
import { toPublicConfirmation, type PublicConfirmation } from "./checkout";
import { effectiveStatus } from "./invoice-state";
import { EXPIRY_GRACE_SECONDS } from "./policy";

// Public invoice status, polled by the open checkout page (Phase 10). Answers from the
// database; while the invoice can still change, it may also ask the chain first through
// the one verification path (checkInvoicePayment). A request can only make the server
// look sooner; what it finds is decided by the chain and the stored invoice alone.

export type PublicStatus = {
  status: InvoiceStatus; // effective: an overdue PENDING invoice shows as EXPIRED
  expiresAt: string;
  confirmation: PublicConfirmation | null;
};

// Chain-check limits, all database-backed (shared by every app instance).
export const CHAIN_CHECK = {
  perInvoiceSeconds: 5, // at most one check per invoice per 5 s, however many viewers
  statusApiPer10s: 20, // the status API's share of the RPC budget
};
// The public RPC allows 40 getSignaturesForAddress calls per 10 s per IP (solana.com
// cluster docs). Every checkInvoicePayment starts with one, so all callers (status API,
// reconciler) draw from this one sliding budget, leaving 5 calls of headroom.
export const RPC_BUDGET = { key: "rpc:getSignaturesForAddress", limit: 35, windowSeconds: 10 } as const;

export function takeRpcBudget(now?: Date) {
  return consumeRateLimit(RPC_BUDGET.key, RPC_BUDGET.limit, RPC_BUDGET.windowSeconds, { sliding: true, now });
}

type Ctx = { log: Pick<typeof logger, "info" | "warn">; requestId?: string };

const SELECT = {
  id: true,
  merchantId: true,
  status: true,
  expiresAt: true,
  network: true,
  tokenDecimals: true,
  payment: { select: { signature: true, amount: true, blockTime: true, commitment: true } },
} as const;

// `pinnedNow` is for tests (deterministic windows); production uses the real clocks.
export async function getPublicStatus(id: string, ctx: Ctx, pinnedNow?: Date): Promise<PublicStatus | null> {
  const now = pinnedNow ?? new Date();
  if (!z.uuid().safeParse(id).success) return null;
  let invoice = await db.invoice.findUnique({ where: { id }, select: SELECT });
  if (!invoice) return null;

  if (mayChange(invoice, now) && (await mayCheckChain(invoice.id, pinnedNow))) {
    try {
      await checkInvoicePayment(
        { invoiceId: invoice.id, merchantId: invoice.merchantId },
        { actor: { type: "SYSTEM", id: "status-api" }, requestId: ctx.requestId, log: ctx.log },
      );
      invoice = await db.invoice.findUniqueOrThrow({ where: { id }, select: SELECT });
    } catch (error) {
      // Fail soft: an RPC outage (or any check failure) never fails the customer's poll,
      // and never produces a status. The answer is whatever the database says.
      ctx.log.warn({ err: error, invoiceId: invoice.id }, "status chain check failed; answering from the database");
    }
  }

  return {
    status: effectiveStatus(invoice, now),
    expiresAt: invoice.expiresAt.toISOString(),
    confirmation: toPublicConfirmation(invoice.payment, invoice),
  };
}

// Stored PENDING/CONFIRMING, within the expiry grace period. After that the reconciler
// alone decides (chain-first expiry); final states never change here.
function mayChange(invoice: { status: InvoiceStatus; expiresAt: Date }, now: Date): boolean {
  if (invoice.status !== "PENDING" && invoice.status !== "CONFIRMING") return false;
  return now.getTime() < invoice.expiresAt.getTime() + EXPIRY_GRACE_SECONDS * 1000;
}

// Cheapest limit first. The per-invoice throttle is fixed-window (a rare second check is
// harmless); the status share and the RPC budget are sliding and only count granted calls.
async function mayCheckChain(invoiceId: string, now?: Date): Promise<boolean> {
  if (!(await consumeRateLimit(`chaincheck:invoice:${invoiceId}`, 1, CHAIN_CHECK.perInvoiceSeconds, { now })).allowed) return false;
  if (!(await consumeRateLimit("chaincheck:status-api", CHAIN_CHECK.statusApiPer10s, 10, { sliding: true, now })).allowed) return false;
  return (await takeRpcBudget(now)).allowed;
}
