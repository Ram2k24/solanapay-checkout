import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as verify } from "@/app/api/invoices/[id]/verify/route";
import { POST as lookup } from "@/app/api/payments/lookup/route";
import { POST as resolve } from "@/app/api/payments/unmatched/[id]/resolve/route";
import { GET as listUnmatched } from "@/app/api/payments/unmatched/route";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  assertExpectedCluster,
  getConfirmedTransaction,
  getSignaturesForReference,
  getSignatureStatus,
} from "@/lib/solana/server-rpc";
import noReference from "../fixtures/solana/no-reference.json";
import referencePayment from "../fixtures/solana/reference-payment.json";
import unknownReference from "../fixtures/solana/unknown-reference.json";
import { resetDatabase } from "../support/db";
import { apiRequest, json, newMerchant } from "../support/http";

// The chain is replaced by the real devnet fixtures; all three pay 1 USDC to MERCHANT_WALLET.
vi.mock("@/lib/solana/server-rpc", () => ({
  assertExpectedCluster: vi.fn(),
  getSignaturesForReference: vi.fn(),
  getConfirmedTransaction: vi.fn(),
  getSignatureStatus: vi.fn(),
  getLatestBlockhash: vi.fn(),
}));

const MERCHANT_WALLET = "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT";
const REFERENCE = "HRPD44J8nG2dM1WTrtKuayYpebkeLiB7h46nbkraFZB2";
const FIXTURES = [referencePayment, noReference, unknownReference];
const failed = new Set<string>();

beforeEach(async () => {
  await resetDatabase();
  failed.clear();
  vi.clearAllMocks();
  vi.mocked(assertExpectedCluster).mockResolvedValue();
  // Each fixture is found by its own reference (only the first one has an invoice).
  vi.mocked(getSignaturesForReference).mockImplementation(async (reference) =>
    (reference === REFERENCE
      ? [{ signature: referencePayment.signature, slot: 1n, err: null, confirmationStatus: "finalized" }]
      : []) as never,
  );
  vi.mocked(getConfirmedTransaction).mockImplementation(
    async (sig) => (FIXTURES.find((f) => f.signature === sig)?.result ?? null) as never,
  );
  vi.mocked(getSignatureStatus).mockImplementation(async (sig) =>
    (FIXTURES.some((f) => f.signature === sig)
      ? { confirmationStatus: "finalized", err: failed.has(sig) ? { InstructionError: [0, "Custom"] } : null }
      : null) as never,
  );
});

// The merchant that owns MERCHANT_WALLET, signed in through a real database session,
// with an invoice carrying INV-2026-00017's stored terms.
async function merchantWithInvoice() {
  const user = await db.user.create({ data: { walletAddress: MERCHANT_WALLET } });
  const merchant = await db.merchant.create({ data: { ownerUserId: user.id, name: "Laptop Store" } });
  await db.wallet.create({ data: { merchantId: merchant.id, address: MERCHANT_WALLET, isDefault: true } });
  const invoice = await db.invoice.create({
    data: {
      merchantId: merchant.id, invoiceNumber: "INV-2026-00017", network: "DEVNET", currency: "USDC", amount: 1_000_000n,
      tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", tokenDecimals: 6, recipientWallet: MERCHANT_WALLET,
      reference: REFERENCE, status: "PENDING", expiresAt: new Date("2026-10-01T18:21:33.511Z"),
    },
  });
  const { token } = await createSession(user.id, { ipAddress: "10.0.0.1", userAgent: null });
  return { user, merchant, invoice, cookie: `${SESSION_COOKIE}=${token}` };
}

const seg = (id: string) => ({ params: Promise.resolve({ id }) });
const verifyCall = (id: string, cookie?: string, origin?: string | null) =>
  verify(apiRequest(`/api/invoices/${id}/verify`, { cookie, origin }), seg(id));
const lookupCall = (body: unknown, cookie?: string) => lookup(apiRequest("/api/payments/lookup", { cookie, body }));
const resolveCall = (id: string, body: unknown, cookie?: string, origin?: string | null) =>
  resolve(apiRequest(`/api/payments/unmatched/${id}/resolve`, { cookie, body, origin }), seg(id));
const listCall = (cookie: string, status?: string) =>
  listUnmatched(apiRequest(`/api/payments/unmatched${status ? `?status=${status}` : ""}`, { method: "GET", cookie }));

describe("POST /api/invoices/[id]/verify", () => {
  it("finds, verifies and records the payment, attributed to the merchant user", async () => {
    const { user, invoice, cookie } = await merchantWithInvoice();
    const response = await verifyCall(invoice.id, cookie);
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      status: "PAID",
      recorded: [{ signature: referencePayment.signature, outcome: "payment-finalized" }],
      payment: {
        signature: referencePayment.signature,
        senderWallet: "BzvXu7r9JJxF8X9Bao4ZCSPNG9Ny91N6EjmPLQTmtD2g",
        amount: "1000000",
        amountDisplay: "1.00",
        commitment: "FINALIZED",
        late: false,
      },
    });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "payment.recorded" } });
    expect(audit).toMatchObject({ actorType: "USER", actorId: user.id });
    expect(audit.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("requires our Origin, a session, and the merchant's own invoice", async () => {
    const { invoice, cookie } = await merchantWithInvoice();
    const other = await newMerchant("Other Shop");
    expect((await verifyCall(invoice.id, cookie, "https://evil.example")).status).toBe(403);
    expect((await verifyCall(invoice.id)).status).toBe(401);
    expect((await verifyCall(invoice.id, other.cookie)).status).toBe(404);
    expect((await verifyCall("not-a-uuid", cookie)).status).toBe(404);
    expect(await db.payment.count()).toBe(0);
  });

  it("is rate-limited to 10 checks per minute per invoice", async () => {
    const { invoice, cookie } = await merchantWithInvoice();
    for (let i = 0; i < 10; i++) expect((await verifyCall(invoice.id, cookie)).status).toBe(200);
    expect((await verifyCall(invoice.id, cookie)).status).toBe(429);
  });

  it("returns 503 RpcUnavailable when the RPC is down", async () => {
    const { invoice, cookie } = await merchantWithInvoice();
    vi.mocked(getSignaturesForReference).mockRejectedValue(new Error("fetch failed"));
    const response = await verifyCall(invoice.id, cookie);
    expect(response.status).toBe(503);
    expect((await json(response)).error.code).toBe("RpcUnavailable");
  });
});

describe("POST /api/payments/lookup", () => {
  it("records Phantom's reference-less payment as unmatched, once", async () => {
    const { cookie } = await merchantWithInvoice();
    const first = await json(await lookupCall({ signature: noReference.signature }, cookie));
    expect(first).toMatchObject({
      outcome: "unmatched",
      created: true,
      entry: { reason: "NO_REFERENCE", status: "OPEN", amountDisplay: "1.00", reference: null, signature: noReference.signature },
    });
    const again = await json(await lookupCall({ signature: noReference.signature }, cookie));
    expect(again).toMatchObject({ outcome: "unmatched", created: false, entry: { id: first.entry.id } });
    expect(await db.unmatchedPayment.count()).toBe(1);
  });

  it("settles the invoice whose reference the transaction carries", async () => {
    const { cookie } = await merchantWithInvoice();
    expect(await json(await lookupCall({ signature: referencePayment.signature }, cookie))).toMatchObject({
      outcome: "invoice", invoiceNumber: "INV-2026-00017", status: "PAID",
    });
  });

  it("records a payment with an unknown reference as unmatched", async () => {
    const { cookie } = await merchantWithInvoice();
    expect(await json(await lookupCall({ signature: unknownReference.signature }, cookie))).toMatchObject({
      outcome: "unmatched", entry: { reason: "UNKNOWN_REFERENCE", reference: "3z1ckkRjDxwXmqpAywGHcFw6Jf1wGERdmM9tvpMVecVX" },
    });
  });

  it("rejects a transaction that doesn't pay this merchant, recording nothing", async () => {
    const other = await newMerchant("Other Shop"); // a different payout wallet
    const response = await lookupCall({ signature: noReference.signature }, other.cookie);
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("InvalidRecipient");
    expect(await db.unmatchedPayment.count()).toBe(0);
  });

  it.each([
    ["an invalid signature", { signature: "not-a-signature" }, 400, "InvalidRequest"],
    ["an unknown signature", { signature: "5".repeat(88) }, 404, "TransactionNotFound"],
    ["extra fields", { signature: noReference.signature, invoiceId: "x" }, 400, "InvalidRequest"],
  ])("rejects %s", async (_, body, status, code) => {
    const { cookie } = await merchantWithInvoice();
    const response = await lookupCall(body, cookie);
    expect(response.status).toBe(status);
    expect((await json(response)).error.code).toBe(code);
  });

  it("rejects a failed transaction", async () => {
    const { cookie } = await merchantWithInvoice();
    failed.add(noReference.signature);
    expect((await json(await lookupCall({ signature: noReference.signature }, cookie))).error.code).toBe("TransactionFailed");
  });

  it("requires a session", async () => {
    expect((await lookupCall({ signature: noReference.signature })).status).toBe(401);
  });
});

describe("unmatched payments: list and resolve", () => {
  async function withEntry() {
    const setup = await merchantWithInvoice();
    const { entry } = await json(await lookupCall({ signature: noReference.signature }, setup.cookie));
    return { ...setup, entryId: entry.id as string };
  }

  it("lists only the merchant's own entries, by status", async () => {
    const { cookie, entryId } = await withEntry();
    const other = await newMerchant("Other Shop");
    expect((await json(await listCall(cookie))).items.map((e: { id: string }) => e.id)).toEqual([entryId]);
    expect((await json(await listCall(cookie, "RESOLVED"))).items).toEqual([]);
    expect((await json(await listCall(other.cookie))).items).toEqual([]);
    expect((await listCall(cookie, "BOGUS")).status).toBe(400);
  });

  it("resolves an entry once, with a note, and audits it", async () => {
    const { user, cookie, entryId } = await withEntry();
    const response = await resolveCall(entryId, { note: "  Refunded 1 USDC to sender  " }, cookie);
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ id: entryId, status: "RESOLVED", resolutionNote: "Refunded 1 USDC to sender" });
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "unmatched.resolved" } })).toMatchObject({
      actorType: "USER", actorId: user.id, entityId: entryId,
    });

    const again = await resolveCall(entryId, { note: "Second try" }, cookie);
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe("PaymentAlreadyProcessed");
    expect((await json(await listCall(cookie, "RESOLVED"))).items).toHaveLength(1);
  });

  it("rejects a blank note, another merchant, and a foreign Origin", async () => {
    const { cookie, entryId } = await withEntry();
    const other = await newMerchant("Other Shop");
    expect((await resolveCall(entryId, { note: "   " }, cookie)).status).toBe(400);
    expect((await resolveCall(entryId, { note: "Mine now" }, other.cookie)).status).toBe(404);
    expect((await resolveCall(entryId, { note: "x" }, cookie, "https://evil.example")).status).toBe(403);
    expect(await db.unmatchedPayment.findUniqueOrThrow({ where: { id: entryId } })).toMatchObject({ status: "OPEN" });
  });
});
