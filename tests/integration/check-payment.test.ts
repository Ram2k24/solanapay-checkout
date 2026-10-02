import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { checkInvoicePayment } from "@/lib/payments/check-payment";
import {
  assertExpectedCluster,
  getConfirmedTransaction,
  getSignaturesForReference,
  WrongClusterError,
} from "@/lib/solana/server-rpc";
import noReference from "../fixtures/solana/no-reference.json";
import referencePayment from "../fixtures/solana/reference-payment.json";
import unknownReference from "../fixtures/solana/unknown-reference.json";
import { resetDatabase } from "../support/db";

// The chain is replaced by the real devnet fixtures (see tests/unit/verify-payment.test.ts).
vi.mock("@/lib/solana/server-rpc", async (importOriginal) => ({
  WrongClusterError: (await importOriginal<typeof import("@/lib/solana/server-rpc")>()).WrongClusterError,
  assertExpectedCluster: vi.fn(),
  getSignaturesForReference: vi.fn(),
  getConfirmedTransaction: vi.fn(),
  getLatestBlockhash: vi.fn(),
}));

const MERCHANT_WALLET = "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT";
const CUSTOMER = "BzvXu7r9JJxF8X9Bao4ZCSPNG9Ny91N6EjmPLQTmtD2g";
const REFERENCE = "HRPD44J8nG2dM1WTrtKuayYpebkeLiB7h46nbkraFZB2"; // INV-2026-00017's stored reference
const SIG = referencePayment.signature;
const log = { info: vi.fn(), warn: vi.fn() };
const ctx = { actor: { type: "SYSTEM" as const }, log };

type Fixture = { signature: string; result: { slot: number; transaction: { signatures: string[] } } };
const chain = new Map<string, unknown>();
let signatures: { signature: string; slot: number; err: unknown; confirmationStatus: "confirmed" | "finalized" }[] = [];

// Makes `fixture` visible on the mocked chain, found by the invoice's reference.
function land(fixture: Fixture, confirmationStatus: "confirmed" | "finalized" = "finalized", signature = fixture.signature) {
  const result = structuredClone(fixture.result);
  result.transaction.signatures[0] = signature;
  chain.set(signature, result);
  signatures = [{ signature, slot: fixture.result.slot, err: null, confirmationStatus }, ...signatures.filter((s) => s.signature !== signature)];
}

beforeEach(async () => {
  await resetDatabase();
  chain.clear();
  signatures = [];
  vi.clearAllMocks();
  vi.mocked(assertExpectedCluster).mockResolvedValue();
  vi.mocked(getSignaturesForReference).mockImplementation(async () => signatures as never);
  vi.mocked(getConfirmedTransaction).mockImplementation(async (sig) => (chain.get(sig) ?? null) as never);
});

// A merchant and invoice with INV-2026-00017's stored terms (wallet, reference, 1 USDC).
async function setup(overrides: { amount?: bigint; expiresAt?: Date; status?: "PENDING" | "EXPIRED" } = {}) {
  const user = await db.user.create({ data: { walletAddress: MERCHANT_WALLET } });
  const merchant = await db.merchant.create({ data: { ownerUserId: user.id, name: "Laptop Store" } });
  await db.wallet.create({ data: { merchantId: merchant.id, address: MERCHANT_WALLET, isDefault: true } });
  const invoice = await db.invoice.create({
    data: {
      merchantId: merchant.id,
      invoiceNumber: "INV-2026-00017",
      network: "DEVNET",
      currency: "USDC",
      amount: overrides.amount ?? 1_000_000n,
      tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      tokenDecimals: 6,
      recipientWallet: MERCHANT_WALLET,
      reference: REFERENCE,
      status: overrides.status ?? "PENDING",
      expiresAt: overrides.expiresAt ?? new Date("2026-10-01T18:21:33.511Z"),
    },
  });
  return { merchant, invoice, target: { invoiceId: invoice.id, merchantId: merchant.id } };
}

const check = (target: { invoiceId: string; merchantId: string }) => checkInvoicePayment(target, ctx);
const auditActions = async () => (await db.auditLog.findMany({ orderBy: { id: "asc" } })).map((a) => a.action);

describe("settling an invoice", () => {
  it("records a confirmed payment (CONFIRMING), then PAID once finalized", async () => {
    const { target } = await setup();
    land(referencePayment, "confirmed");

    expect(await check(target)).toEqual({ status: "CONFIRMING", recorded: [{ signature: SIG, outcome: "payment-confirmed" }] });
    const payment = await db.payment.findUniqueOrThrow({ where: { signature: SIG } });
    expect(payment).toMatchObject({
      invoiceId: target.invoiceId,
      reference: REFERENCE,
      senderWallet: CUSTOMER,
      recipientWallet: MERCHANT_WALLET,
      recipientTokenAccount: "4mCBk3FmruHdVz9Xy15C1KyEzSSimhrmX9dMF3d3XEhu",
      amount: 1_000_000n,
      slot: 506350774n,
      blockTime: new Date("2026-10-01T17:34:34.000Z"),
      commitment: "CONFIRMED",
      finalizedAt: null,
      late: false,
    });

    land(referencePayment, "finalized");
    expect(await check(target)).toEqual({ status: "PAID", recorded: [{ signature: SIG, outcome: "payment-upgraded" }] });
    expect(await db.payment.findUniqueOrThrow({ where: { signature: SIG } })).toMatchObject({ commitment: "FINALIZED" });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: target.invoiceId } })).paidAt).toBeInstanceOf(Date);
    expect(await auditActions()).toEqual([
      "payment.recorded", "invoice.status_changed", "payment.finalized", "invoice.status_changed",
    ]);
  });

  it("goes straight to PAID when first seen finalized", async () => {
    const { target } = await setup();
    land(referencePayment, "finalized");
    expect(await check(target)).toEqual({ status: "PAID", recorded: [{ signature: SIG, outcome: "payment-finalized" }] });
    const changes = await db.auditLog.findMany({ where: { action: "invoice.status_changed" }, orderBy: { id: "asc" } });
    expect(changes.map((c) => c.data)).toEqual([{ from: "PENDING", to: "CONFIRMING" }, { from: "CONFIRMING", to: "PAID" }]);
  });

  it("is idempotent: checking again changes nothing", async () => {
    const { target } = await setup();
    land(referencePayment, "finalized");
    await check(target);
    const auditCount = await db.auditLog.count();

    expect(await check(target)).toEqual({ status: "PAID", recorded: [] });
    expect(await db.payment.count()).toBe(1);
    expect(await db.unmatchedPayment.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(auditCount);
  });

  it("records exactly one payment when 10 checks run at once", async () => {
    const { target } = await setup();
    land(referencePayment, "finalized");
    const results = await Promise.all(Array.from({ length: 10 }, () => check(target)));

    expect(results.every((r) => r.status === "PAID")).toBe(true);
    expect(results.flatMap((r) => r.recorded)).toEqual([{ signature: SIG, outcome: "payment-finalized" }]);
    expect(await db.payment.count()).toBe(1);
    expect(await db.unmatchedPayment.count()).toBe(0);
  });

  it("settles a late payment (landed after expiry) and flags it", async () => {
    const { target } = await setup({ expiresAt: new Date("2026-10-01T17:30:00.000Z") });
    land(referencePayment, "finalized");
    expect((await check(target)).status).toBe("PAID");
    expect(await db.payment.findUniqueOrThrow({ where: { signature: SIG } })).toMatchObject({ late: true });
  });
});

describe("payments that can't settle the invoice go to the unmatched list", () => {
  it("amount differs from the invoice: AMOUNT_MISMATCH, invoice stays PENDING", async () => {
    const { target } = await setup({ amount: 2_000_000n });
    land(referencePayment, "finalized");
    expect(await check(target)).toEqual({ status: "PENDING", recorded: [{ signature: SIG, outcome: "unmatched-amount_mismatch" }] });
    expect(await db.unmatchedPayment.findUniqueOrThrow({ where: { signature: SIG } })).toMatchObject({
      reason: "AMOUNT_MISMATCH", invoiceId: target.invoiceId, reference: REFERENCE, amount: 1_000_000n, status: "OPEN",
    });
    expect(await db.payment.count()).toBe(0);
  });

  it("a second valid payment for a paid invoice: DUPLICATE_PAYMENT, never paid twice", async () => {
    const { target } = await setup();
    land(referencePayment, "finalized");
    await check(target);
    land(referencePayment, "finalized", "SecondPaymentSignature1111111111111111111111111111111111111111111111");

    const result = await check(target);
    expect(result.recorded).toEqual([
      { signature: "SecondPaymentSignature1111111111111111111111111111111111111111111111", outcome: "unmatched-duplicate_payment" },
    ]);
    expect(await db.payment.count()).toBe(1);
    expect(await db.unmatchedPayment.findFirstOrThrow()).toMatchObject({ reason: "DUPLICATE_PAYMENT", invoiceId: target.invoiceId });
  });

  it("the invoice is EXPIRED in the database: INVOICE_NOT_PAYABLE", async () => {
    const { target } = await setup({ status: "EXPIRED" });
    land(referencePayment, "finalized");
    expect(await check(target)).toEqual({ status: "EXPIRED", recorded: [{ signature: SIG, outcome: "unmatched-invoice_not_payable" }] });
  });

  it("money found by the reference without it on the transfer: NO_REFERENCE", async () => {
    const { target } = await setup();
    land(noReference, "finalized");
    expect((await check(target)).recorded).toEqual([{ signature: noReference.signature, outcome: "unmatched-no_reference" }]);
    expect(await db.unmatchedPayment.findFirstOrThrow()).toMatchObject({ reason: "NO_REFERENCE", reference: null, invoiceId: null });
  });

  it("another (unknown) reference on the transfer: UNKNOWN_REFERENCE", async () => {
    const { target } = await setup();
    land(unknownReference, "finalized");
    await check(target);
    expect(await db.unmatchedPayment.findFirstOrThrow()).toMatchObject({
      reason: "UNKNOWN_REFERENCE", reference: "3z1ckkRjDxwXmqpAywGHcFw6Jf1wGERdmM9tvpMVecVX", invoiceId: null,
    });
  });

  it("leaves a payment carrying another of the merchant's references to that invoice", async () => {
    const { merchant, target } = await setup();
    await db.invoice.create({
      data: {
        merchantId: merchant.id, invoiceNumber: "INV-2026-00099", network: "DEVNET", currency: "USDC", amount: 1_000_000n,
        tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", tokenDecimals: 6, recipientWallet: MERCHANT_WALLET,
        reference: "3z1ckkRjDxwXmqpAywGHcFw6Jf1wGERdmM9tvpMVecVX", status: "PENDING", expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    land(unknownReference, "finalized");
    expect(await check(target)).toEqual({ status: "PENDING", recorded: [] });
    expect(await db.unmatchedPayment.count()).toBe(0);
  });
});

describe("ignored and refused", () => {
  it("skips failed transactions and transactions that don't credit the merchant", async () => {
    const { target } = await setup();
    land(referencePayment, "finalized");
    signatures[0]!.err = { InstructionError: [1, "Custom"] };
    expect(await check(target)).toEqual({ status: "PENDING", recorded: [] });
    expect(getConfirmedTransaction).not.toHaveBeenCalled();

    const other = structuredClone(unknownReference);
    for (const b of other.result.meta.postTokenBalances) b.uiTokenAmount.amount = "0"; // credits nobody
    land(other, "finalized");
    expect(await check(target)).toEqual({ status: "PENDING", recorded: [] });
    expect(await db.unmatchedPayment.count()).toBe(0);
  });

  it("a transaction not yet visible at 'confirmed' is left for a later check", async () => {
    const { target } = await setup();
    signatures = [{ signature: SIG, slot: 1, err: null, confirmationStatus: "confirmed" }];
    expect(await check(target)).toEqual({ status: "PENDING", recorded: [] });
  });

  it("refuses to verify against an RPC serving another cluster, writing nothing", async () => {
    const { target } = await setup();
    land(referencePayment, "finalized");
    vi.mocked(assertExpectedCluster).mockRejectedValue(new WrongClusterError("EtWT…", "5eyk…"));
    await expect(check(target)).rejects.toBeInstanceOf(WrongClusterError);
    expect(getSignaturesForReference).not.toHaveBeenCalled();
    expect(await db.payment.count()).toBe(0);
  });

  it("reports RpcUnavailable when the RPC fails, writing nothing", async () => {
    const { target } = await setup();
    vi.mocked(getSignaturesForReference).mockRejectedValue(new Error("fetch failed"));
    await expect(check(target)).rejects.toEqual(new ApiError("RpcUnavailable"));
    expect(await db.auditLog.count()).toBe(0);
  });

  it("only checks the merchant's own invoices", async () => {
    const { target } = await setup();
    await expect(check({ ...target, merchantId: "01a0f348-4244-76df-99c6-699a320850f3" })).rejects.toEqual(new ApiError("NotFound"));
  });
});
