import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as reconcileRoute } from "@/app/api/internal/reconcile/route";
import { serverEnv } from "@/lib/config/server-env";
import { db } from "@/lib/db/client";
import { RPC_BUDGET, takeRpcBudget } from "@/lib/payments/public-status";
import { runReconciler } from "@/lib/payments/reconciler";
import {
  assertExpectedCluster,
  getConfirmedTransaction,
  getSignaturesForReference,
  WrongClusterError,
} from "@/lib/solana/server-rpc";
import referencePayment from "../fixtures/solana/reference-payment.json";
import { resetDatabase } from "../support/db";
import { apiRequest, json } from "../support/http";

// The chain is replaced by the real devnet fixture (1 USDC carrying REFERENCE, landed
// 2026-10-01T17:34:34Z). Other references find nothing.
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
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let chainState: "none" | "confirmed" | "finalized" = "none";

beforeEach(async () => {
  await resetDatabase();
  chainState = "none";
  vi.clearAllMocks();
  vi.mocked(assertExpectedCluster).mockResolvedValue();
  vi.mocked(getSignaturesForReference).mockImplementation(async (reference) =>
    (reference === REFERENCE && chainState !== "none"
      ? [{ signature: referencePayment.signature, slot: 1n, err: null, confirmationStatus: chainState }]
      : []) as never,
  );
  vi.mocked(getConfirmedTransaction).mockImplementation(async () => referencePayment.result as never);
});

let merchantId: string | null = null;
let counter = 0;
async function invoice(opts: { expiresAt?: Date; status?: "PENDING" | "CONFIRMING" | "PAID" | "EXPIRED"; reference?: string; createdAgoMs?: number } = {}) {
  if (!merchantId) {
    const user = await db.user.create({ data: { walletAddress: MERCHANT_WALLET } });
    const merchant = await db.merchant.create({ data: { ownerUserId: user.id, name: "Laptop Store" } });
    await db.wallet.create({ data: { merchantId: merchant.id, address: MERCHANT_WALLET, isDefault: true } });
    merchantId = merchant.id;
  }
  counter += 1;
  const inv = await db.invoice.create({
    data: {
      merchantId, invoiceNumber: `INV-2026-${String(counter).padStart(5, "0")}`, network: "DEVNET", currency: "USDC",
      amount: 1_000_000n, tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", tokenDecimals: 6,
      recipientWallet: MERCHANT_WALLET, reference: opts.reference ?? `Ref${String(counter).padStart(3, "0")}`.padEnd(32, "x"),
      status: opts.status ?? "PENDING", expiresAt: opts.expiresAt ?? new Date(Date.now() + 30 * 60_000),
      createdAt: new Date(Date.now() - (opts.createdAgoMs ?? 60_000)),
      ...(opts.status === "PAID" ? { paidAt: new Date() } : {}),
    },
  });
  await db.invoiceCheck.update({ where: { invoiceId: inv.id }, data: { nextCheckAt: new Date(Date.now() - 1_000) } }); // due now
  return inv;
}
beforeEach(() => {
  merchantId = null;
  counter = 0;
});

const check = (invoiceId: string) => db.invoiceCheck.findUniqueOrThrow({ where: { invoiceId } });
const statusOf = async (id: string) => (await db.invoice.findUniqueOrThrow({ where: { id } })).status;
const inMs = (date: Date | null) => (date ? date.getTime() - Date.now() : null);

describe("claiming", () => {
  it("claims only due, unleased rows, oldest first, up to the batch size", async () => {
    const due = [await invoice(), await invoice(), await invoice()];
    const future = await invoice();
    await db.invoiceCheck.update({ where: { invoiceId: future.id }, data: { nextCheckAt: new Date(Date.now() + 60_000) } });
    const leased = await invoice();
    await db.invoiceCheck.update({ where: { invoiceId: leased.id }, data: { leaseUntil: new Date(Date.now() + 30_000) } });
    const done = await invoice({ status: "PAID" });
    await db.invoiceCheck.update({ where: { invoiceId: done.id }, data: { nextCheckAt: null } });

    const summary = await runReconciler(log, { batch: 2 });
    expect(summary.claimed).toBe(2);
    expect(await runReconciler(log, { batch: 10 })).toMatchObject({ claimed: 1 }); // the third due one
    expect((await check(due[2]!.id)).lastCheckedAt).not.toBeNull();
    for (const id of [future.id, leased.id, done.id]) expect((await check(id)).lastCheckedAt).toBeNull();
  });

  it("reclaims a row whose lease expired (a crashed run)", async () => {
    const inv = await invoice();
    await db.invoiceCheck.update({ where: { invoiceId: inv.id }, data: { leaseUntil: new Date(Date.now() - 1_000) } });
    expect((await runReconciler(log)).claimed).toBe(1);
  });

  it("two concurrent runs never process the same invoice", async () => {
    for (let i = 0; i < 6; i++) await invoice();
    const [a, b] = await Promise.all([runReconciler(log), runReconciler(log)]);
    expect(a.claimed + b.claimed).toBe(6);
    expect(getSignaturesForReference).toHaveBeenCalledTimes(6);
  });
});

describe("what a run does per invoice", () => {
  it("PENDING, not yet due to expire: checks the chain, reschedules in 30 s", async () => {
    const inv = await invoice();
    expect(await runReconciler(log)).toMatchObject({ claimed: 1, checked: 1 });
    const row = await check(inv.id);
    expect(row).toMatchObject({ attempts: 0, lastError: null, leaseUntil: null });
    expect(inMs(row.nextCheckAt)).toBeGreaterThan(25_000);
    expect(inMs(row.nextCheckAt)).toBeLessThanOrEqual(30_000);
  });

  it("PENDING with a finalized payment: PAID, no further checks", async () => {
    const inv = await invoice({ reference: REFERENCE });
    chainState = "finalized";
    expect(await runReconciler(log)).toMatchObject({ paid: 1 });
    expect(await statusOf(inv.id)).toBe("PAID");
    expect((await check(inv.id)).nextCheckAt).toBeNull();
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "payment.recorded" } })).toMatchObject({ actorId: "reconciler" });
  });

  it("CONFIRMING: checked every 15 s, then PAID once finalized", async () => {
    const inv = await invoice({ reference: REFERENCE });
    chainState = "confirmed";
    expect(await runReconciler(log)).toMatchObject({ confirming: 1 });
    expect(inMs((await check(inv.id)).nextCheckAt)).toBeLessThanOrEqual(15_000);
    await db.invoiceCheck.update({ where: { invoiceId: inv.id }, data: { nextCheckAt: new Date(Date.now() - 1_000) } });
    chainState = "finalized";
    expect(await runReconciler(log)).toMatchObject({ paid: 1 });
    expect(await statusOf(inv.id)).toBe("PAID");
  });

  it("overdue PENDING with no payment: expired (chain first), then watched for late money", async () => {
    const inv = await invoice({ expiresAt: new Date(Date.now() - 200_000), createdAgoMs: 20 * 60_000 });
    expect(await runReconciler(log)).toMatchObject({ expired: 1, checked: 1 });
    expect(getSignaturesForReference).toHaveBeenCalledTimes(1);
    expect(await statusOf(inv.id)).toBe("EXPIRED");
    expect(inMs((await check(inv.id)).nextCheckAt)).toBeGreaterThan(9 * 60_000); // late-money watch: 10 min
  });

  it("EXPIRED within 24 h: money that shows up is recorded as unmatched", async () => {
    await invoice({ status: "EXPIRED", reference: REFERENCE, expiresAt: new Date(Date.now() - 60 * 60_000) });
    chainState = "finalized";
    expect(await runReconciler(log)).toMatchObject({ unmatched: 1 });
    expect(await db.unmatchedPayment.findFirstOrThrow()).toMatchObject({ reason: "INVOICE_NOT_PAYABLE" });
  });

  it("EXPIRED over 24 h ago, or PAID: no chain call, no further checks", async () => {
    const old = await invoice({ status: "EXPIRED", expiresAt: new Date(Date.now() - 25 * 60 * 60_000) });
    const paid = await invoice({ status: "PAID" });
    await runReconciler(log);
    expect(getSignaturesForReference).not.toHaveBeenCalled();
    expect((await check(old.id)).nextCheckAt).toBeNull();
    expect((await check(paid.id)).nextCheckAt).toBeNull();
  });

  it("warns (only) about a payment CONFIRMING for over 10 minutes", async () => {
    const inv = await invoice({ reference: REFERENCE });
    chainState = "confirmed";
    await runReconciler(log); // payment recorded as CONFIRMED now
    await db.invoiceCheck.update({ where: { invoiceId: inv.id }, data: { nextCheckAt: new Date(Date.now() - 1_000) } });
    expect(await runReconciler(log, { now: new Date(Date.now() + 5 * 60_000) })).toMatchObject({ stuckConfirming: 0 });
    await db.invoiceCheck.update({ where: { invoiceId: inv.id }, data: { nextCheckAt: new Date(Date.now() - 1_000) } });
    expect(await runReconciler(log, { now: new Date(Date.now() + 11 * 60_000) })).toMatchObject({ stuckConfirming: 1 });
    expect(await statusOf(inv.id)).toBe("CONFIRMING"); // never failed automatically
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: inv.id }), expect.stringContaining("over 10 minutes"));
  });
});

describe("failures", () => {
  it("RPC errors back off 30 s, then 1 min, and leave the invoice unchanged", async () => {
    const inv = await invoice({ expiresAt: new Date(Date.now() - 200_000) }); // due to expire
    vi.mocked(getSignaturesForReference).mockRejectedValue(new Error("fetch failed"));
    expect(await runReconciler(log)).toMatchObject({ rpcErrors: 1, expired: 0 });
    let row = await check(inv.id);
    expect(row).toMatchObject({ attempts: 1, leaseUntil: null });
    expect(row.lastError).toContain("RpcUnavailable");
    expect(inMs(row.nextCheckAt)).toBeGreaterThan(25_000);
    expect(inMs(row.nextCheckAt)).toBeLessThanOrEqual(30_000);
    expect(await statusOf(inv.id)).toBe("PENDING"); // never expired without a successful check

    await db.invoiceCheck.update({ where: { invoiceId: inv.id }, data: { nextCheckAt: new Date(Date.now() - 1_000) } });
    await runReconciler(log);
    row = await check(inv.id);
    expect(row.attempts).toBe(2);
    expect(inMs(row.nextCheckAt)).toBeGreaterThan(55_000);

    vi.mocked(getSignaturesForReference).mockResolvedValue([] as never);
    await db.invoiceCheck.update({ where: { invoiceId: inv.id }, data: { nextCheckAt: new Date(Date.now() - 1_000) } });
    expect(await runReconciler(log)).toMatchObject({ expired: 1 });
    expect(await check(inv.id)).toMatchObject({ attempts: 0, lastError: null }); // reset on success
  });

  it("wrong cluster: stops the run and releases the remaining claims", async () => {
    const invoices = [await invoice(), await invoice(), await invoice()];
    vi.mocked(assertExpectedCluster).mockRejectedValue(new WrongClusterError("EtWT…", "5eyk…"));
    expect(await runReconciler(log, { parallelism: 1 })).toMatchObject({ claimed: 3, aborted: true, rpcErrors: 1 });
    for (const inv of invoices) expect((await check(inv.id)).leaseUntil).toBeNull();
    expect(log.error).toHaveBeenCalled();
  });

  it("shared RPC budget used up: defers the batch without counting errors", async () => {
    const invoices = [await invoice(), await invoice()];
    for (let i = 0; i < RPC_BUDGET.limit; i++) await takeRpcBudget();
    expect(await runReconciler(log)).toMatchObject({ claimed: 2, budgetDeferred: 2, checked: 0, rpcErrors: 0 });
    expect(getSignaturesForReference).not.toHaveBeenCalled();
    for (const inv of invoices) expect(await check(inv.id)).toMatchObject({ attempts: 0, leaseUntil: null, lastCheckedAt: null });
  });
});

describe("POST /api/internal/reconcile", () => {
  const call = (authorization?: string) =>
    reconcileRoute(apiRequest("/api/internal/reconcile", { origin: null, headers: authorization ? { authorization } : {} }));

  it.each([
    ["no Authorization header", undefined],
    ["a wrong secret", `Bearer ${"0".repeat(64)}`],
    ["the secret without Bearer", serverEnv.CRON_SECRET],
    ["a prefix of the secret", `Bearer ${serverEnv.CRON_SECRET.slice(0, 32)}`],
  ])("rejects %s with 401 and runs nothing", async (_, authorization) => {
    await invoice();
    const oldWindow = await db.rateLimit.create({ data: { key: "test:old", windowStart: new Date(Date.now() - 2 * 60 * 60_000), count: 1 } });
    const response = await call(authorization);
    expect(response.status).toBe(401);
    expect((await json(response)).error.code).toBe("InvalidCredentials");
    expect(getSignaturesForReference).not.toHaveBeenCalled();
    expect(await db.rateLimit.count({ where: { key: oldWindow.key } })).toBe(1); // no cleanup either
  });

  it("runs the reconciler with the right secret", async () => {
    await invoice();
    const response = await call(`Bearer ${serverEnv.CRON_SECRET}`);
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ claimed: 1, checked: 1, aborted: false });
  });

  it("cleans up expired rows after the run (Phase 13)", async () => {
    await db.rateLimit.create({ data: { key: "test:old", windowStart: new Date(Date.now() - 2 * 60 * 60_000), count: 1 } });
    const response = await call(`Bearer ${serverEnv.CRON_SECRET}`);
    expect((await json(response)).cleanup).toEqual({ nonces: 0, sessions: 0, rateLimits: 1 });
    expect(await db.rateLimit.count({ where: { key: "test:old" } })).toBe(0);
  });
});
