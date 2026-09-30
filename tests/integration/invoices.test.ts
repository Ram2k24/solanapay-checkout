import { isAddress } from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getInvoice } from "@/app/api/invoices/[id]/route";
import { GET as listInvoices, POST as createInvoice } from "@/app/api/invoices/route";
import { CIRCLE_USDC_MINT } from "@/lib/config/networks";
import { db } from "@/lib/db/client";
import { resetDatabase } from "../support/db";
import { apiRequest, json, newMerchant, signInNewWallet } from "../support/http";

beforeEach(resetDatabase);

const YEAR = new Date().getUTCFullYear();

function create(cookie: string, body: unknown, headers?: Record<string, string>) {
  return createInvoice(apiRequest("/api/invoices", { cookie, body, headers }));
}
function get(cookie: string, id: string) {
  return getInvoice(apiRequest(`/api/invoices/${id}`, { method: "GET", cookie }), { params: Promise.resolve({ id }) });
}
function list(cookie: string, query = "") {
  return listInvoices(apiRequest(`/api/invoices${query}`, { method: "GET", cookie }));
}

describe("create invoice", () => {
  it("creates a PENDING invoice whose payment terms all come from the server", async () => {
    const { cookie, wallet } = await newMerchant();
    const before = Date.now();
    const response = await create(cookie, { amount: "10.00", orderId: "ORDER-10001", description: "Laptop accessory purchase" });
    expect(response.status).toBe(201);

    const invoice = await json(response);
    expect(invoice).toMatchObject({
      invoiceNumber: `INV-${YEAR}-00001`,
      orderId: "ORDER-10001",
      description: "Laptop accessory purchase",
      amount: "10000000",
      amountDisplay: "10.00",
      currency: "USDC",
      network: "DEVNET",
      tokenMint: CIRCLE_USDC_MINT.devnet,
      tokenDecimals: 6,
      recipientWallet: wallet.address,
      status: "PENDING",
      effectiveStatus: "PENDING",
      paidAt: null,
    });
    expect(isAddress(invoice.reference)).toBe(true);
    const ttl = new Date(invoice.expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(29 * 60_000); // default 30 minutes
    expect(ttl).toBeLessThanOrEqual(30 * 60_000 + 5_000);

    const row = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row.amount).toBe(10_000_000n);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "invoice.created" } })).entityId).toBe(invoice.id);
  });

  it.each([["tokenMint", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"], ["recipientWallet", "11111111111111111111111111111111"], ["network", "MAINNET"], ["status", "PAID"], ["reference", "x"], ["invoiceNumber", "INV-1"]])(
    "rejects a client-supplied %s (400) and creates nothing",
    async (field, value) => {
      const { cookie } = await newMerchant();
      const response = await create(cookie, { amount: "10", [field]: value });
      expect(response.status).toBe(400);
      expect((await json(response)).error.fields[field]).toBe("This field is not accepted.");
      expect(await db.invoice.count()).toBe(0);
    },
  );

  it.each([
    ["0", "greater than zero"],
    ["-5", "like 10"],
    ["1.0000001", "at most 6 decimal"],
    ["10000.000001", "maximum invoice amount is 10000"],
    ["1e3", "like 10"],
  ])("rejects amount %j", async (amount, message) => {
    const { cookie } = await newMerchant();
    const body = await json(await create(cookie, { amount }));
    expect(body.error.fields.amount).toContain(message);
  });

  it("rejects an amount sent as a number (floats are not accepted for money)", async () => {
    const { cookie } = await newMerchant();
    expect((await create(cookie, { amount: 10.5 })).status).toBe(400);
  });

  it("accepts exactly the 10,000 USDC cap", async () => {
    const { cookie } = await newMerchant();
    expect((await json(await create(cookie, { amount: "10000" }))).amount).toBe("10000000000");
  });

  it("enforces expiry limits and accepts a custom expiry", async () => {
    const { cookie } = await newMerchant();
    expect((await create(cookie, { amount: "1", expiresInMinutes: 4 })).status).toBe(400);
    expect((await create(cookie, { amount: "1", expiresInMinutes: 1441 })).status).toBe(400);
    expect((await create(cookie, { amount: "1", expiresInMinutes: 7.5 })).status).toBe(400);
    const custom = await json(await create(cookie, { amount: "1", expiresInMinutes: 45 }));
    const ttl = new Date(custom.expiresAt).getTime() - new Date(custom.createdAt).getTime();
    expect(ttl).toBe(45 * 60_000); // exact: both timestamps come from one clock reading
  });

  it("numbers invoices per merchant", async () => {
    const a = await newMerchant("A");
    const b = await newMerchant("B");
    const numbersA = [];
    for (let i = 0; i < 3; i++) numbersA.push((await json(await create(a.cookie, { amount: "1" }))).invoiceNumber);
    const firstB = (await json(await create(b.cookie, { amount: "1" }))).invoiceNumber;
    expect(numbersA).toEqual([`INV-${YEAR}-00001`, `INV-${YEAR}-00002`, `INV-${YEAR}-00003`]);
    expect(firstB).toBe(`INV-${YEAR}-00001`);
  });

  it("gives 10 parallel creates the numbers 1..10 with no gaps or duplicates", async () => {
    const { cookie } = await newMerchant();
    const responses = await Promise.all(Array.from({ length: 10 }, () => create(cookie, { amount: "1" })));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    const numbers = (await Promise.all(responses.map(json))).map((i) => i.invoiceNumber).sort();
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => `INV-${YEAR}-${String(i + 1).padStart(5, "0")}`));
  });

  it("rejects requests from other origins, unauthenticated users and users without a profile", async () => {
    const { cookie } = await newMerchant();
    expect((await createInvoice(apiRequest("/api/invoices", { cookie, body: { amount: "1" }, origin: "https://evil.example" }))).status).toBe(403);
    expect((await createInvoice(apiRequest("/api/invoices", { body: { amount: "1" } }))).status).toBe(401);
    const notOnboarded = await signInNewWallet();
    const response = await create(notOnboarded.cookie, { amount: "1" });
    expect(response.status).toBe(403);
    expect((await json(response)).error.code).toBe("MerchantProfileRequired");
  });

  it("rate-limits creation to 30 per minute per merchant", async () => {
    const { cookie } = await newMerchant();
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await create(cookie, { amount: "1" })).status);
    expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe("order IDs", () => {
  it("keeps an order ID typed by the merchant", async () => {
    const { cookie } = await newMerchant();
    expect((await json(await create(cookie, { amount: "1", orderId: "10045" }))).orderId).toBe("10045");
  });

  it("generates ORD-YYYY-NNNNN when left blank, with its own counter", async () => {
    const { cookie } = await newMerchant();
    const first = await json(await create(cookie, { amount: "1" }));
    const typed = await json(await create(cookie, { amount: "1", orderId: "SHOP-77" }));
    const second = await json(await create(cookie, { amount: "1", orderId: "   " })); // blank after trimming
    expect([first.invoiceNumber, typed.invoiceNumber, second.invoiceNumber]).toEqual([`INV-${YEAR}-00001`, `INV-${YEAR}-00002`, `INV-${YEAR}-00003`]);
    expect([first.orderId, typed.orderId, second.orderId]).toEqual([`ORD-${YEAR}-00001`, "SHOP-77", `ORD-${YEAR}-00002`]);
  });

  it("numbers auto order IDs per merchant", async () => {
    const a = await newMerchant("A");
    const b = await newMerchant("B");
    await create(a.cookie, { amount: "1" });
    expect((await json(await create(b.cookie, { amount: "1" }))).orderId).toBe(`ORD-${YEAR}-00001`);
  });

  it("gives 10 parallel blank-order creates unique order IDs 1..10", async () => {
    const { cookie } = await newMerchant();
    const invoices = await Promise.all(Array.from({ length: 10 }, () => create(cookie, { amount: "1" }).then(json)));
    expect(invoices.map((i) => i.orderId).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `ORD-${YEAR}-${String(i + 1).padStart(5, "0")}`));
  });

  it("rejects typed IDs in the reserved auto format", async () => {
    const { cookie } = await newMerchant();
    const body = await json(await create(cookie, { amount: "1", orderId: `ORD-${YEAR}-00009` }));
    expect(body.error.fields.orderId).toContain("reserved");
    expect(await db.invoice.count()).toBe(0);
  });

  it("returns the same generated order ID when a blank request is retried", async () => {
    const { cookie } = await newMerchant();
    const headers = { "idempotency-key": "blank-order-retry" };
    const first = await json(await create(cookie, { amount: "1" }, headers));
    const retry = await json(await create(cookie, { amount: "1" }, headers));
    expect(retry.orderId).toBe(first.orderId);
    expect((await json(await create(cookie, { amount: "1" }))).orderId).toBe(`ORD-${YEAR}-00002`); // no number burned by the retry
  });
});

describe("idempotency", () => {
  const key = { "idempotency-key": "order-10001-attempt-1" };

  it("returns the original invoice for a retried request", async () => {
    const { cookie } = await newMerchant();
    const first = await create(cookie, { amount: "10", orderId: "ORDER-1" }, key);
    const retry = await create(cookie, { amount: "10.00", orderId: "ORDER-1" }, key); // same amount, written differently
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    expect((await json(retry)).id).toBe((await json(first)).id);
    expect(await db.invoice.count()).toBe(1);
  });

  it("rejects the same key with a different request (409)", async () => {
    const { cookie } = await newMerchant();
    await create(cookie, { amount: "10" }, key);
    const different = await create(cookie, { amount: "11" }, key);
    expect(different.status).toBe(409);
    expect((await json(different)).error.code).toBe("IdempotencyConflict");
    expect(await db.invoice.count()).toBe(1);
  });

  it("creates exactly one invoice for 5 concurrent requests with the same key", async () => {
    const { cookie } = await newMerchant();
    const responses = await Promise.all(Array.from({ length: 5 }, () => create(cookie, { amount: "10" }, key)));
    const ids = new Set((await Promise.all(responses.map(json))).map((i) => i.id));
    expect(ids.size).toBe(1);
    expect(await db.invoice.count()).toBe(1);
    // The losers' counter increments were rolled back: the next invoice is number 2.
    expect((await json(await create(cookie, { amount: "1" }))).invoiceNumber).toBe(`INV-${YEAR}-00002`);
  });

  it("scopes keys per merchant and creates a new invoice without a key", async () => {
    const a = await newMerchant("A");
    const b = await newMerchant("B");
    await create(a.cookie, { amount: "10" }, key);
    expect((await create(b.cookie, { amount: "10" }, key)).status).toBe(201);
    expect((await create(a.cookie, { amount: "10" })).status).toBe(201);
    expect(await db.invoice.count()).toBe(3);
  });

  it("rejects malformed keys", async () => {
    const { cookie } = await newMerchant();
    expect((await create(cookie, { amount: "1" }, { "idempotency-key": "has spaces" })).status).toBe(400);
  });
});

describe("read invoices", () => {
  it("returns a merchant's own invoice and hides others' (404)", async () => {
    const a = await newMerchant("A");
    const b = await newMerchant("B");
    const invoice = await json(await create(a.cookie, { amount: "5" }));

    expect((await get(a.cookie, invoice.id)).status).toBe(200);
    const foreign = await get(b.cookie, invoice.id);
    expect(foreign.status).toBe(404);
    expect((await json(foreign)).error.code).toBe("NotFound");
    expect((await get(a.cookie, "not-a-uuid")).status).toBe(404);
  });

  it("lists only the merchant's invoices, newest first, with cursor pagination", async () => {
    const a = await newMerchant("A");
    const b = await newMerchant("B");
    for (let i = 0; i < 3; i++) await create(a.cookie, { amount: "1" });
    await create(b.cookie, { amount: "1" });

    const page1 = await json(await list(a.cookie, "?limit=2"));
    expect(page1.invoices.map((i: any) => i.invoiceNumber)).toEqual([`INV-${YEAR}-00003`, `INV-${YEAR}-00002`]);
    const page2 = await json(await list(a.cookie, `?limit=2&cursor=${page1.nextCursor}`));
    expect(page2.invoices.map((i: any) => i.invoiceNumber)).toEqual([`INV-${YEAR}-00001`]);
    expect(page2.nextCursor).toBeNull();
  });

  it("filters by effective status: an overdue PENDING invoice counts as EXPIRED", async () => {
    const { cookie } = await newMerchant();
    const fresh = await json(await create(cookie, { amount: "1" }));
    const overdue = await json(await create(cookie, { amount: "2" }));
    await db.invoice.update({ where: { id: overdue.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const pending = await json(await list(cookie, "?status=PENDING"));
    const expired = await json(await list(cookie, "?status=EXPIRED"));
    expect(pending.invoices.map((i: any) => i.id)).toEqual([fresh.id]);
    expect(expired.invoices.map((i: any) => i.id)).toEqual([overdue.id]);
    expect(expired.invoices[0]).toMatchObject({ status: "PENDING", effectiveStatus: "EXPIRED" });
  });

  it("rejects unknown query parameters and statuses", async () => {
    const { cookie } = await newMerchant();
    expect((await list(cookie, "?status=REFUNDED")).status).toBe(400);
    expect((await list(cookie, "?merchantId=someone-else")).status).toBe(400);
  });
});
