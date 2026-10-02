import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { checkInvoicePayment } from "@/lib/payments/check-payment";
import { expireIfUnpaid } from "@/lib/payments/expire-invoice";
import {
  assertExpectedCluster,
  getConfirmedTransaction,
  getSignaturesForReference,
  WrongClusterError,
} from "@/lib/solana/server-rpc";
import referencePayment from "../fixtures/solana/reference-payment.json";
import { resetDatabase } from "../support/db";

// The chain is replaced by the real devnet fixture: 1 USDC to MERCHANT_WALLET, carrying
// REFERENCE, landed at 2026-10-01T17:34:34Z.
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
const log = { info: vi.fn(), warn: vi.fn() };
const ctx = { actor: { type: "SYSTEM" as const, id: "reconciler" }, log };
let paid = false; // whether the payment is visible on the (mocked) chain

beforeEach(async () => {
  await resetDatabase();
  paid = false;
  vi.clearAllMocks();
  vi.mocked(assertExpectedCluster).mockResolvedValue();
  vi.mocked(getSignaturesForReference).mockImplementation(async () =>
    (paid ? [{ signature: referencePayment.signature, slot: 1n, err: null, confirmationStatus: "finalized" }] : []) as never,
  );
  vi.mocked(getConfirmedTransaction).mockImplementation(async () => referencePayment.result as never);
});

async function invoice(expiresAt: Date, overrides: { status?: "PENDING" | "CONFIRMING" | "EXPIRED" | "FAILED"; amount?: bigint } = {}) {
  const user = await db.user.create({ data: { walletAddress: MERCHANT_WALLET } });
  const merchant = await db.merchant.create({ data: { ownerUserId: user.id, name: "Laptop Store" } });
  await db.wallet.create({ data: { merchantId: merchant.id, address: MERCHANT_WALLET, isDefault: true } });
  return db.invoice.create({
    data: {
      merchantId: merchant.id, invoiceNumber: "INV-2026-00017", network: "DEVNET", currency: "USDC",
      amount: overrides.amount ?? 1_000_000n, tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", tokenDecimals: 6,
      recipientWallet: MERCHANT_WALLET, reference: REFERENCE, status: overrides.status ?? "PENDING", expiresAt,
      ...(overrides.status === "FAILED" ? { failureReason: "test" } : {}),
    },
  });
}

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);
const statusOf = async (id: string) => (await db.invoice.findUniqueOrThrow({ where: { id } })).status;
const expiredAudits = () => db.auditLog.count({ where: { action: "invoice.expired" } });

describe("scheduling rows", () => {
  it("are created by the database for every new invoice", async () => {
    const inv = await invoice(secondsAgo(-1800));
    const check = await db.invoiceCheck.findUniqueOrThrow({ where: { invoiceId: inv.id } });
    expect(check).toMatchObject({ attempts: 0, lastCheckedAt: null, leaseUntil: null });
    const dueIn = check.nextCheckAt!.getTime() - Date.now();
    expect(dueIn).toBeGreaterThan(25_000);
    expect(dueIn).toBeLessThanOrEqual(31_000);
  });
});

describe("chain-first expiry", () => {
  it("doesn't touch an invoice still inside the 180 s grace period (no chain check)", async () => {
    const inv = await invoice(secondsAgo(60));
    expect(await expireIfUnpaid(inv.id, ctx)).toEqual({ outcome: "not-due", status: "PENDING" });
    expect(getSignaturesForReference).not.toHaveBeenCalled();
  });

  it("checks the chain first, then expires an unpaid invoice (audited)", async () => {
    const inv = await invoice(secondsAgo(200));
    expect(await expireIfUnpaid(inv.id, ctx)).toEqual({ outcome: "expired", status: "EXPIRED" });
    expect(getSignaturesForReference).toHaveBeenCalledTimes(1);
    expect(await statusOf(inv.id)).toBe("EXPIRED");
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "invoice.expired" } })).toMatchObject({
      actorType: "SYSTEM", actorId: "reconciler", entityId: inv.id, data: { from: "PENDING", to: "EXPIRED" },
    });
  });

  it("settles instead of expiring when the payment landed before expiry (not late)", async () => {
    const inv = await invoice(new Date("2026-10-01T18:00:00.000Z")); // payment landed 17:34:34
    paid = true;
    expect(await expireIfUnpaid(inv.id, ctx)).toEqual({ outcome: "settled", status: "PAID" });
    expect(await db.payment.findFirstOrThrow()).toMatchObject({ late: false });
    expect(await expiredAudits()).toBe(0);
  });

  it("settles a payment that landed after expiry, flagged late", async () => {
    const inv = await invoice(new Date("2026-10-01T17:30:00.000Z"));
    paid = true;
    expect(await expireIfUnpaid(inv.id, ctx)).toEqual({ outcome: "settled", status: "PAID" });
    expect(await db.payment.findFirstOrThrow()).toMatchObject({ late: true });
  });

  it("expires when the only money found doesn't pay the invoice (recorded as unmatched)", async () => {
    const inv = await invoice(secondsAgo(200), { amount: 2_000_000n }); // 1 USDC arrived for a 2 USDC invoice
    paid = true;
    expect(await expireIfUnpaid(inv.id, ctx)).toEqual({ outcome: "expired", status: "EXPIRED" });
    expect(await db.unmatchedPayment.findFirstOrThrow()).toMatchObject({ reason: "AMOUNT_MISMATCH", invoiceId: inv.id });
  });
});

describe("never expire without a successful chain check", () => {
  it("leaves the invoice PENDING when the RPC is down", async () => {
    const inv = await invoice(secondsAgo(200));
    vi.mocked(getSignaturesForReference).mockRejectedValue(new Error("fetch failed"));
    await expect(expireIfUnpaid(inv.id, ctx)).rejects.toEqual(new ApiError("RpcUnavailable"));
    expect(await statusOf(inv.id)).toBe("PENDING");
    expect(await expiredAudits()).toBe(0);
  });

  it("leaves the invoice PENDING when the RPC serves another cluster", async () => {
    const inv = await invoice(secondsAgo(200));
    vi.mocked(assertExpectedCluster).mockRejectedValue(new WrongClusterError("EtWT…", "5eyk…"));
    await expect(expireIfUnpaid(inv.id, ctx)).rejects.toBeInstanceOf(WrongClusterError);
    expect(await statusOf(inv.id)).toBe("PENDING");
  });
});

describe("other states and concurrency", () => {
  it.each(["CONFIRMING", "EXPIRED", "FAILED"] as const)("doesn't touch a %s invoice (no chain check)", async (status) => {
    const inv = await invoice(secondsAgo(3600), { status });
    expect(await expireIfUnpaid(inv.id, ctx)).toEqual({ outcome: "not-pending", status });
    expect(getSignaturesForReference).not.toHaveBeenCalled();
  });

  it("expires exactly once when several workers race", async () => {
    const inv = await invoice(secondsAgo(200));
    // A barrier: the chain answers nobody until all 5 workers have asked, so all 5 have
    // passed their first PENDING read and reach the row lock together.
    let arrived = 0;
    let release!: () => void;
    const allArrived = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(getSignaturesForReference).mockImplementation(async () => {
      if (++arrived === 5) release();
      await allArrived;
      return [] as never;
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => expireIfUnpaid(inv.id, ctx)));
    expect(arrived).toBe(5);
    expect(results.filter((r) => r.outcome === "expired")).toHaveLength(1);
    expect(results.every((r) => r.status === "EXPIRED")).toBe(true);
    expect(await expiredAudits()).toBe(1);
  });

  it("a payment that shows up after EXPIRED is recorded as unmatched, never paid (late-money watch)", async () => {
    const inv = await invoice(secondsAgo(200));
    await expireIfUnpaid(inv.id, ctx);
    paid = true; // the money arrives (or becomes visible) only now
    const result = await checkInvoicePayment({ invoiceId: inv.id, merchantId: inv.merchantId }, ctx);
    expect(result).toMatchObject({ status: "EXPIRED", recorded: [{ outcome: "unmatched-invoice_not_payable" }] });
    expect(await db.payment.count()).toBe(0);
  });
});
