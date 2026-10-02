import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { checkInvoicePayment } from "@/lib/payments/check-payment";
import { expireIfUnpaid } from "@/lib/payments/expire-invoice";
import { lookupTransaction } from "@/lib/payments/lookup-payment";
import { getPublicStatus, RPC_BUDGET } from "@/lib/payments/public-status";
import { runReconciler } from "@/lib/payments/reconciler";
import {
  assertExpectedCluster,
  getConfirmedTransaction,
  getSignaturesForReference,
  getSignatureStatus,
} from "@/lib/solana/server-rpc";
import referencePayment from "../fixtures/solana/reference-payment.json";
import { resetDatabase } from "../support/db";

// Cross-component behaviour (Phase 10.6): the status API, the reconciler, the merchant's
// "Check for payment", expiry and lookup acting on the same invoice or budget at once.
// The chain is the real devnet fixture (1 USDC carrying REFERENCE).
vi.mock("@/lib/solana/server-rpc", async (importOriginal) => ({
  WrongClusterError: (await importOriginal<typeof import("@/lib/solana/server-rpc")>()).WrongClusterError,
  assertExpectedCluster: vi.fn(),
  getSignaturesForReference: vi.fn(),
  getConfirmedTransaction: vi.fn(),
  getSignatureStatus: vi.fn(),
  getLatestBlockhash: vi.fn(),
}));

const MERCHANT_WALLET = "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT";
const REFERENCE = "HRPD44J8nG2dM1WTrtKuayYpebkeLiB7h46nbkraFZB2";
const SIG = referencePayment.signature;
const PAYMENT_ON_CHAIN = [{ signature: SIG, slot: 1n, err: null, confirmationStatus: "finalized" }];
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const user = { type: "USER" as const, id: "merchant-user" };

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.mocked(assertExpectedCluster).mockResolvedValue();
  vi.mocked(getSignaturesForReference).mockResolvedValue([] as never);
  vi.mocked(getConfirmedTransaction).mockImplementation(async () => referencePayment.result as never);
  vi.mocked(getSignatureStatus).mockResolvedValue({ confirmationStatus: "finalized", err: null } as never);
});

// A barrier: holds every caller until `n` have arrived, so they really overlap.
function barrier(n: number) {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return async () => {
    if (++arrived === n) open();
    await opened;
  };
}

async function merchant() {
  const u = await db.user.create({ data: { walletAddress: MERCHANT_WALLET } });
  const m = await db.merchant.create({ data: { ownerUserId: u.id, name: "Laptop Store" } });
  await db.wallet.create({ data: { merchantId: m.id, address: MERCHANT_WALLET, isDefault: true } });
  return m;
}

let n = 0;
async function invoice(merchantId: string, opts: { reference?: string; expiresAt?: Date; status?: "PENDING" | "EXPIRED" } = {}) {
  n += 1;
  const inv = await db.invoice.create({
    data: {
      merchantId, invoiceNumber: `INV-2026-${String(n).padStart(5, "0")}`, network: "DEVNET", currency: "USDC", amount: 1_000_000n,
      tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", tokenDecimals: 6, recipientWallet: MERCHANT_WALLET,
      reference: opts.reference ?? `Ref${String(n).padStart(4, "0")}`.padEnd(32, "x"), status: opts.status ?? "PENDING",
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 30 * 60_000),
    },
  });
  await db.invoiceCheck.update({ where: { invoiceId: inv.id }, data: { nextCheckAt: new Date(Date.now() - 1_000) } });
  return inv;
}

describe("several components on one invoice at once", () => {
  it("status poll + reconciler + merchant check + expirer: exactly one payment, PAID, nothing else", async () => {
    const m = await merchant();
    const inv = await invoice(m.id, { reference: REFERENCE });
    const allAtTheChain = barrier(3); // the three that look at the chain (the expirer: not due, no chain call)
    vi.mocked(getSignaturesForReference).mockImplementation(async () => {
      await allAtTheChain();
      return PAYMENT_ON_CHAIN as never;
    });

    const results = await Promise.allSettled([
      getPublicStatus(inv.id, { log }),
      runReconciler(log),
      checkInvoicePayment({ invoiceId: inv.id, merchantId: m.id }, { actor: user, log }),
      expireIfUnpaid(inv.id, { actor: { type: "SYSTEM", id: "reconciler" }, log }),
    ]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
    expect(getSignaturesForReference).toHaveBeenCalledTimes(3);
    expect(await db.payment.count()).toBe(1);
    expect(await db.unmatchedPayment.count()).toBe(0);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    expect(await db.auditLog.count({ where: { action: "payment.recorded" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "invoice.expired" } })).toBe(0);
  });

  it("a payment recorded while an expiry is in progress wins: PAID, never EXPIRED", async () => {
    const m = await merchant();
    const inv = await invoice(m.id, { reference: REFERENCE, expiresAt: new Date(Date.now() - 200_000) }); // due to expire
    // Force the dangerous order: the expirer's chain check sees nothing, then (before it
    // takes the row lock) a status poll finds and records the payment.
    let settled!: () => void;
    const paymentRecorded = new Promise<void>((resolve) => (settled = resolve));
    let call = 0;
    vi.mocked(getSignaturesForReference).mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        await paymentRecorded; // the expirer's view: no payment yet...
        return [] as never;
      }
      return PAYMENT_ON_CHAIN as never; // ...the payment becomes visible to the next look
    });

    const expiry = expireIfUnpaid(inv.id, { actor: { type: "SYSTEM", id: "reconciler" }, log });
    await vi.waitFor(() => expect(call).toBe(1)); // the expirer is waiting on the chain
    const settle = await checkInvoicePayment({ invoiceId: inv.id, merchantId: m.id }, { actor: user, log });
    expect(settle.status).toBe("PAID");
    settled();

    // The expirer must notice: here its own chain check ends by re-reading the invoice
    // (already PAID), so it returns "settled" before reaching the row lock. (The re-check
    // under the lock is covered by the racing-expirers test in expire-invoice.test.ts.)
    const outcome = await expiry;
    expect(outcome.outcome).not.toBe("expired");
    expect(outcome.status).toBe("PAID");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    expect(await db.auditLog.count({ where: { action: "invoice.expired" } })).toBe(0);
  });
});

describe("RPC outage during a burst", () => {
  it("polls answer from the database, the reconciler backs off, nothing changes; recovery settles", async () => {
    const m = await merchant();
    const inv = await invoice(m.id, { reference: REFERENCE });
    vi.mocked(getSignaturesForReference).mockRejectedValue(new Error("fetch failed"));

    const polls = Array.from({ length: 10 }, (_, i) => getPublicStatus(inv.id, { log }, new Date(Date.now() + i * 5_000)));
    const [statuses, run] = await Promise.all([Promise.all(polls), runReconciler(log)]);

    expect(statuses.every((s) => s?.status === "PENDING")).toBe(true);
    expect(run).toMatchObject({ rpcErrors: 1, checked: 0 });
    const check = await db.invoiceCheck.findUniqueOrThrow({ where: { invoiceId: inv.id } });
    expect(check.attempts).toBe(1); // only the reconciler records failures, once
    expect(await db.auditLog.count()).toBe(0);
    expect(await db.payment.count()).toBe(0);

    vi.mocked(getSignaturesForReference).mockResolvedValue(PAYMENT_ON_CHAIN as never); // the RPC recovers
    await db.invoiceCheck.update({ where: { invoiceId: inv.id }, data: { nextCheckAt: new Date(Date.now() - 1_000) } });
    expect(await runReconciler(log)).toMatchObject({ paid: 1 });
    expect(await db.invoiceCheck.findUniqueOrThrow({ where: { invoiceId: inv.id } })).toMatchObject({ attempts: 0, nextCheckAt: null });
  });
});

describe("one shared RPC budget", () => {
  it("status polls and a reconciler batch together never exceed 35 chain lookups", async () => {
    const m = await merchant();
    const polled = [];
    for (let i = 0; i < 30; i++) polled.push(await invoice(m.id));
    for (const inv of polled) {
      await db.invoiceCheck.update({ where: { invoiceId: inv.id }, data: { nextCheckAt: null } }); // not reconciler work
    }
    const due = [];
    for (let i = 0; i < 25; i++) due.push(await invoice(m.id));

    const [, run] = await Promise.all([Promise.all(polled.map((inv) => getPublicStatus(inv.id, { log }))), runReconciler(log)]);

    const lookups = vi.mocked(getSignaturesForReference).mock.calls.length;
    expect(lookups).toBeLessThanOrEqual(RPC_BUDGET.limit);
    expect(run.claimed).toBe(25);
    expect(run.checked + run.budgetDeferred).toBe(25); // every claim either checked or deferred, none lost
    expect(run.rpcErrors).toBe(0);
    const deferred = await db.invoiceCheck.count({ where: { invoiceId: { in: due.map((d) => d.id) }, lastCheckedAt: null } });
    expect(deferred).toBe(run.budgetDeferred);
    expect(await db.invoiceCheck.count({ where: { leaseUntil: { not: null } } })).toBe(0); // no claim left behind
  });
});

describe("late-money watch and a merchant lookup on the same transaction", () => {
  it("records exactly one unmatched entry", async () => {
    const m = await merchant();
    await invoice(m.id, { reference: REFERENCE, status: "EXPIRED", expiresAt: new Date(Date.now() - 60 * 60_000) });
    const together = barrier(2);
    vi.mocked(getSignaturesForReference).mockImplementation(async () => {
      await together();
      return PAYMENT_ON_CHAIN as never;
    });

    const [run, lookup] = await Promise.all([
      runReconciler(log),
      lookupTransaction({ id: m.id, payoutWallet: MERCHANT_WALLET }, SIG, { actor: user, log }),
    ]);

    expect(await db.unmatchedPayment.count()).toBe(1);
    expect(await db.unmatchedPayment.findFirstOrThrow()).toMatchObject({ reason: "INVOICE_NOT_PAYABLE", signature: SIG });
    expect(await db.payment.count()).toBe(0);
    expect(run.unmatched + (lookup.outcome === "invoice" ? lookup.recorded.length : 0)).toBe(1); // recorded by exactly one of them
  });
});
