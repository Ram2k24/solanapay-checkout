import { blockhash, getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder, getU64Decoder } from "@solana/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, OPTIONS, POST } from "@/app/api/pay/[id]/transaction/route";
import { POST as createInvoice } from "@/app/api/invoices/route";
import { CIRCLE_USDC_MINT } from "@/lib/config/networks";
import { db } from "@/lib/db/client";
import { getLatestBlockhash } from "@/lib/solana/server-rpc";
import { resetDatabase } from "../support/db";
import { apiRequest, APP, json, newMerchant } from "../support/http";
import { createTestWallet } from "../support/wallet";
import { freezeClockMidMinute } from "../support/clock";

// The only network call (latest blockhash) is replaced, so these tests run offline.
vi.mock("@/lib/solana/server-rpc", () => ({ getLatestBlockhash: vi.fn() }));
const BLOCKHASH = { blockhash: blockhash("GoCkuX6Zpbz5FvXovJu5fZi3tMUjmt8W7T8pWgKBb4Py"), lastValidBlockHeight: 1000n };

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(getLatestBlockhash).mockReset().mockResolvedValue(BLOCKHASH);
});

const path = (id: string) => `/api/pay/${id}/transaction`;
const segment = (id: string) => ({ params: Promise.resolve({ id }) });

// As a wallet calls it: no cookie, and no Origin header (wallets aren't browsers).
function walletPost(id: string, body: unknown, ip?: string) {
  return POST(apiRequest(path(id), { body, origin: null, headers: ip ? { "x-forwarded-for": ip } : {} }), segment(id));
}
function walletGet(id: string) {
  return GET(apiRequest(path(id), { method: "GET", origin: null }), segment(id));
}

async function setup(invoice: Record<string, unknown> = { amount: "12.5", description: "Laptop stand" }) {
  const { cookie, wallet } = await newMerchant("Laptop Store");
  const created = await json(await createInvoice(apiRequest("/api/invoices", { cookie, body: invoice })));
  const row = await db.invoice.findUniqueOrThrow({ where: { id: created.id } });
  const customer = await createTestWallet();
  return { merchantWallet: wallet.address, row, customer: customer.address };
}

function decode(base64: string) {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(base64));
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (message.version === 1) throw new Error("unexpected v1 message");
  const keys: string[] = [...message.staticAccounts];
  const transfer = message.instructions[1]!;
  return {
    signers: Object.keys(tx.signatures),
    feePayer: keys[0],
    transferAccounts: (transfer.accountIndices ?? []).map((i) => keys[i]),
    amount: getU64Decoder().decode((transfer.data ?? new Uint8Array()).slice(1, 9)),
    mint: keys[transfer.accountIndices![1]!],
  };
}

function expectCors(response: Response) {
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("GET /api/pay/[id]/transaction", () => {
  it("returns the merchant name and an absolute icon URL", async () => {
    const { row } = await setup();
    const response = await walletGet(row.id);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ label: "Laptop Store", icon: `${APP}/solana-pay-icon.svg` });
    expectCors(response);
  });

  it("returns 404 with CORS headers for unknown or malformed IDs", async () => {
    for (const id of ["01a0f348-4244-76df-99c6-699a320850f3", "not-a-uuid"]) {
      const response = await walletGet(id);
      expect(response.status).toBe(404);
      expectCors(response);
    }
  });
});

describe("POST /api/pay/[id]/transaction", () => {
  it("builds the payment from the stored invoice", async () => {
    const { row, customer, merchantWallet } = await setup();
    const response = await walletPost(row.id, { account: customer });
    expect(response.status).toBe(200);
    expectCors(response);

    const body = await json(response);
    expect(body.message).toBe(`${row.invoiceNumber} · Laptop stand`);
    const tx = decode(body.transaction);
    expect(tx.signers).toEqual([customer]); // only the customer signs; the server never does
    expect(tx.feePayer).toBe(customer);
    expect(tx.amount).toBe(12_500_000n);
    expect(tx.mint).toBe(CIRCLE_USDC_MINT.devnet);
    expect(tx.transferAccounts.at(-1)).toBe(row.reference);
    expect(tx.transferAccounts).not.toContain(merchantWallet); // funds go to the merchant's token account
  });

  it("ignores payment terms injected into the request body", async () => {
    const { row, customer } = await setup();
    const attacker = (await createTestWallet()).address;
    const honest = await json(await walletPost(row.id, { account: customer }));
    const injected = await walletPost(row.id, {
      account: customer,
      amount: "0.01",
      recipient: attacker,
      recipientWallet: attacker,
      mint: CIRCLE_USDC_MINT.mainnet,
      splToken: CIRCLE_USDC_MINT.mainnet,
      reference: attacker,
      decimals: 0,
    });
    expect(injected.status).toBe(200);
    expect((await json(injected)).transaction).toBe(honest.transaction); // byte-for-byte identical
  });

  it("needs no session cookie and accepts any Origin (wallets aren't our pages)", async () => {
    const { row, customer } = await setup();
    const response = await POST(
      apiRequest(path(row.id), { body: { account: customer }, origin: "https://wallet.example" }),
      segment(row.id),
    );
    expect(response.status).toBe(200);
  });

  it.each([
    ["missing", {}],
    ["not a string", { account: 42 }],
    ["not an address", { account: "not-a-wallet" }],
  ])("rejects an account that is %s", async (_, body) => {
    const { row } = await setup();
    const response = await walletPost(row.id, body);
    expect(response.status).toBe(400);
    expectCors(response);
    expect(getLatestBlockhash).not.toHaveBeenCalled();
  });

  it("rejects an off-curve account (a token account can't sign)", async () => {
    const { row } = await setup();
    const response = await walletPost(row.id, { account: "4mCBk3FmruHdVz9Xy15C1KyEzSSimhrmX9dMF3d3XEhu" });
    expect((await json(response)).error.code).toBe("InvalidAccount");
  });

  it("rejects the merchant's own payout wallet", async () => {
    const { row, merchantWallet } = await setup();
    const response = await walletPost(row.id, { account: merchantWallet });
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("SelfPaymentNotAllowed");
  });

  it("returns 404 for unknown invoices", async () => {
    const response = await walletPost("01a0f348-4244-76df-99c6-699a320850f3", { account: (await createTestWallet()).address });
    expect(response.status).toBe(404);
    expectCors(response);
  });

  it.each([
    ["has expired", -1_000],
    ["expires in under 120 seconds", 119_000],
  ])("refuses an invoice that %s", async (_, msFromNow) => {
    const { row, customer } = await setup();
    await db.invoice.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + msFromNow) } });
    const response = await walletPost(row.id, { account: customer });
    expect(response.status).toBe(409);
    expect((await json(response)).error.code).toBe("InvoiceNotPayable");
  });

  it("serves an invoice with more than 120 seconds left", async () => {
    const { row, customer } = await setup();
    await db.invoice.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + 125_000) } });
    expect((await walletPost(row.id, { account: customer })).status).toBe(200);
  });

  it("refuses an invoice in a final state", async () => {
    const { row, customer } = await setup();
    await db.invoice.update({ where: { id: row.id }, data: { status: "FAILED", failureReason: "test" } });
    expect((await walletPost(row.id, { account: customer })).status).toBe(409);
  });

  it("returns 503 when the Solana RPC is unreachable", async () => {
    const { row, customer } = await setup();
    vi.mocked(getLatestBlockhash).mockRejectedValue(new Error("connect ECONNREFUSED"));
    const response = await walletPost(row.id, { account: customer });
    expect(response.status).toBe(503);
    expectCors(response);
  });

  it("treats a forged, oversized X-Forwarded-For as an unknown client", async () => {
    const { row, customer } = await setup();
    expect((await walletPost(row.id, { account: customer }, "x".repeat(500))).status).toBe(200);
  });
});

describe("rate limits (independent per IP and per invoice)", () => {
  it("allows 30 requests per minute per IP, across invoices", async () => {
    freezeClockMidMinute(); // all requests in one fixed rate-limit window
    const account = (await createTestWallet()).address;
    // Unknown invoices: each request uses a different invoice, so only the IP limit applies.
    for (let i = 0; i < 30; i++) {
      expect((await walletPost(crypto.randomUUID(), { account }, "203.0.113.7")).status).toBe(404);
    }
    const blocked = await walletPost(crypto.randomUUID(), { account }, "203.0.113.7");
    expect(blocked.status).toBe(429);
    expectCors(blocked);
    expect((await walletPost(crypto.randomUUID(), { account }, "203.0.113.8")).status).toBe(404); // other IPs unaffected
  });

  it("allows 20 requests per minute per invoice, across IPs", async () => {
    freezeClockMidMinute(); // all requests in one fixed rate-limit window
    const { row, customer } = await setup();
    const other = await setup();
    for (let i = 0; i < 20; i++) {
      expect((await walletPost(row.id, { account: customer })).status).toBe(200); // a fresh IP each time
    }
    expect((await walletPost(row.id, { account: customer })).status).toBe(429);
    expect((await walletPost(other.row.id, { account: other.customer })).status).toBe(200); // other invoices unaffected
  });

  it("doesn't count requests from a blocked IP against the invoice", async () => {
    freezeClockMidMinute(); // all requests in one fixed rate-limit window
    const { row, customer } = await setup();
    const ip = "203.0.113.9";
    for (let i = 0; i < 30; i++) await walletPost(crypto.randomUUID(), { account: customer }, ip);
    for (let i = 0; i < 10; i++) expect((await walletPost(row.id, { account: customer }, ip)).status).toBe(429);
    for (let i = 0; i < 20; i++) expect((await walletPost(row.id, { account: customer })).status).toBe(200);
  });
});

describe("OPTIONS /api/pay/[id]/transaction", () => {
  it("answers the CORS preflight", async () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
  });
});
