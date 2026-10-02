import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/pay/[id]/status/route";
import { db } from "@/lib/db/client";
import { getPublicStatus, RPC_BUDGET, takeRpcBudget } from "@/lib/payments/public-status";
import {
  assertExpectedCluster,
  getConfirmedTransaction,
  getSignaturesForReference,
  WrongClusterError,
} from "@/lib/solana/server-rpc";
import referencePayment from "../fixtures/solana/reference-payment.json";
import { resetDatabase } from "../support/db";
import { apiRequest, json } from "../support/http";

// The chain is replaced by the real devnet fixture (INV-2026-00017's 1 USDC payment).
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
const ctx = { log: { info: vi.fn(), warn: vi.fn() } };
// Pinned clock; the fixture payment landed at 2026-10-01T17:34:34Z.
const T0 = Date.parse("2026-10-01T17:40:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000);

let landed: "none" | "confirmed" | "finalized" = "none";

beforeEach(async () => {
  await resetDatabase();
  landed = "none";
  vi.clearAllMocks();
  vi.mocked(assertExpectedCluster).mockResolvedValue();
  vi.mocked(getSignaturesForReference).mockImplementation(async () =>
    (landed === "none" ? [] : [{ signature: SIG, slot: 1n, err: null, confirmationStatus: landed }]) as never,
  );
  vi.mocked(getConfirmedTransaction).mockImplementation(async () => referencePayment.result as never);
});

let invoiceCounter = 0;
async function invoice(overrides: { expiresAt?: Date; status?: "PENDING" | "EXPIRED"; reference?: string } = {}) {
  let merchant = await db.merchant.findFirst();
  if (!merchant) {
    const user = await db.user.create({ data: { walletAddress: MERCHANT_WALLET } });
    merchant = await db.merchant.create({ data: { ownerUserId: user.id, name: "Laptop Store", email: "owner@shop.example" } });
    await db.wallet.create({ data: { merchantId: merchant.id, address: MERCHANT_WALLET, isDefault: true } });
  }
  invoiceCounter += 1;
  return db.invoice.create({
    data: {
      merchantId: merchant.id, invoiceNumber: `INV-2026-${String(invoiceCounter).padStart(5, "0")}`, network: "DEVNET",
      currency: "USDC", amount: 1_000_000n, tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", tokenDecimals: 6,
      recipientWallet: MERCHANT_WALLET, reference: overrides.reference ?? REFERENCE, customerReference: "customer-secret-42",
      status: overrides.status ?? "PENDING", expiresAt: overrides.expiresAt ?? at(30 * 60),
    },
  });
}

const status = (id: string, seconds: number) => getPublicStatus(id, ctx, at(seconds));
const httpGet = (id: string, ip = "203.0.113.50") =>
  GET(apiRequest(`/api/pay/${id}/status`, { method: "GET", origin: null, headers: { "x-forwarded-for": ip } }), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/pay/[id]/status: privacy and HTTP behaviour", () => {
  it("returns only status, expiry and the public confirmation", async () => {
    const inv = await invoice({ expiresAt: new Date(Date.now() + 30 * 60_000) });
    landed = "finalized";
    const response = await httpGet(inv.id);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(Object.keys(body).sort()).toEqual(["confirmation", "expiresAt", "status"]);
    expect(Object.keys(body.confirmation).sort()).toEqual(["amountDisplay", "blockTime", "explorerUrl", "finalized", "signature"]);
    expect(body).toMatchObject({ status: "PAID", confirmation: { signature: SIG, amountDisplay: "1.00", finalized: true } });

    const raw = JSON.stringify(body);
    for (const secret of ["customer-secret-42", "owner@shop.example", REFERENCE, MERCHANT_WALLET, inv.merchantId, "BzvXu7r9"]) {
      expect(raw).not.toContain(secret); // no customer reference, merchant data, reference key or payer wallet
    }
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull(); // same-origin only
  });

  it("returns 404 for unknown and malformed IDs", async () => {
    expect((await httpGet("01a0f348-4244-76df-99c6-699a320850f3")).status).toBe(404);
    expect((await httpGet("not-a-uuid")).status).toBe(404);
  });

  it("allows 60 requests per minute per IP, then 429 with a calculated Retry-After", async () => {
    const inv = await invoice({ status: "EXPIRED" });
    for (let i = 0; i < 60; i++) expect((await httpGet(inv.id, "203.0.113.60")).status).toBe(200);
    const limited = await httpGet(inv.id, "203.0.113.60");
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect((await httpGet(inv.id, "203.0.113.61")).status).toBe(200); // other customers unaffected
  });
});

describe("detection through status polling", () => {
  it("follows PENDING → CONFIRMING → PAID as the payment lands and finalizes", async () => {
    const inv = await invoice();
    expect((await status(inv.id, 0))!.status).toBe("PENDING");
    landed = "confirmed";
    expect(await status(inv.id, 6)).toMatchObject({ status: "CONFIRMING", confirmation: { finalized: false } });
    landed = "finalized";
    expect(await status(inv.id, 12)).toMatchObject({ status: "PAID", confirmation: { finalized: true, signature: SIG } });
    expect(await db.auditLog.findFirst({ where: { action: "payment.recorded" } })).toMatchObject({ actorType: "SYSTEM", actorId: "status-api" });
  });

  it("checks the chain at most once per 5 seconds per invoice, however many viewers", async () => {
    const inv = await invoice();
    await Promise.all(Array.from({ length: 10 }, () => status(inv.id, 0)));
    expect(getSignaturesForReference).toHaveBeenCalledTimes(1);
    await status(inv.id, 3);
    expect(getSignaturesForReference).toHaveBeenCalledTimes(1);
    await status(inv.id, 5);
    expect(getSignaturesForReference).toHaveBeenCalledTimes(2);
  });

  it("records exactly one payment when many polls race", async () => {
    const inv = await invoice();
    landed = "finalized";
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => status(inv.id, i * 5))); // distinct windows
    expect(results.every((r) => r!.status === "PAID")).toBe(true);
    expect(await db.payment.count()).toBe(1);
    expect(await db.unmatchedPayment.count()).toBe(0);
  });

  it("limits the status API to 20 chain checks per 10 seconds across invoices", async () => {
    const invoices = [];
    for (let i = 0; i < 21; i++) invoices.push(await invoice({ reference: `Ref${String(i).padStart(2, "0")}`.padEnd(32, "x") }));
    for (const inv of invoices) await status(inv.id, 0);
    expect(getSignaturesForReference).toHaveBeenCalledTimes(20);
  });

  it("answers from the database when the shared RPC budget is used up (e.g. by the reconciler)", async () => {
    const inv = await invoice();
    for (let i = 0; i < RPC_BUDGET.limit; i++) expect((await takeRpcBudget(at(0))).allowed).toBe(true);
    landed = "finalized";
    expect((await status(inv.id, 1))!.status).toBe("PENDING");
    expect(getSignaturesForReference).not.toHaveBeenCalled();
  });
});

describe("expiry window and final states", () => {
  it("during the grace period: shows EXPIRED, and a payment that landed before expiry still settles (not late)", async () => {
    const inv = await invoice({ expiresAt: at(-60) }); // expired 1 minute ago; the payment landed 5.5 min before that
    expect((await status(inv.id, 0))!.status).toBe("EXPIRED");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PENDING"); // nothing written

    landed = "finalized"; // e.g. the RPC indexed it late
    expect((await status(inv.id, 10))!.status).toBe("PAID");
    expect(await db.payment.findFirstOrThrow()).toMatchObject({ late: false });
  });

  it("during the grace period: a payment that landed after expiry settles and is flagged late", async () => {
    const inv = await invoice({ expiresAt: new Date("2026-10-01T17:34:00.000Z") }); // payment landed at 17:34:34
    landed = "finalized";
    expect((await getPublicStatus(inv.id, ctx, new Date("2026-10-01T17:35:30.000Z")))!.status).toBe("PAID");
    expect(await db.payment.findFirstOrThrow()).toMatchObject({ late: true });
  });

  it("after expires_at + 180 s: no chain check (the reconciler owns it)", async () => {
    const inv = await invoice({ expiresAt: at(-181) });
    landed = "finalized";
    expect((await status(inv.id, 0))!.status).toBe("EXPIRED");
    expect(getSignaturesForReference).not.toHaveBeenCalled();
  });

  it("never checks the chain for final states", async () => {
    const expired = await invoice({ status: "EXPIRED" });
    await status(expired.id, 0);
    expect(getSignaturesForReference).not.toHaveBeenCalled();
  });
});

describe("fail-soft", () => {
  it.each([
    ["the RPC is down", () => vi.mocked(getSignaturesForReference).mockRejectedValue(new Error("fetch failed"))],
    ["the RPC serves another cluster", () => vi.mocked(assertExpectedCluster).mockRejectedValue(new WrongClusterError("EtWT…", "5eyk…"))],
  ])("answers 200 with the database state when %s", async (_, breakRpc) => {
    const inv = await invoice({ expiresAt: new Date(Date.now() + 30 * 60_000) });
    breakRpc();
    const response = await httpGet(inv.id, "203.0.113.70");
    expect(response.status).toBe(200);
    expect((await json(response)).status).toBe("PENDING");
    expect(ctx.log.warn).not.toHaveBeenCalled(); // the route logs through its own request logger
    expect(await db.payment.count()).toBe(0);
  });
});
