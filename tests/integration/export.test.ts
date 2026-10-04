import { beforeEach, describe, expect, it } from "vitest";
import { GET as exportCsv } from "@/app/api/payments/export/route";
import { exportPayments } from "@/lib/payments/list-payments";
import { resetDatabase } from "../support/db";
import { freezeClockMidMinute } from "../support/clock";
import { apiRequest, newMerchant, signInNewWallet } from "../support/http";
import { invoice, merchant, payment, PAYER, tick, USDC } from "../support/payments";

// Phase 12.4: GET /api/payments/export, the Transactions view as CSV.
beforeEach(resetDatabase);

const download = (cookie: string | undefined, query = "") =>
  exportCsv(apiRequest(`/api/payments/export${query}`, { method: "GET", cookie }));
const rowsOf = async (response: Response) => (await response.text()).slice(1).split("\r\n").filter(Boolean).slice(1);

describe("access", () => {
  it("needs a signed-in merchant", async () => {
    expect((await download(undefined)).status).toBe(401);
    const { cookie } = await signInNewWallet(); // no profile yet
    expect((await download(cookie)).status).toBe(403);
  });
});

describe("the download", () => {
  it("is a CSV attachment of the merchant's own payments, newest first, never cached", async () => {
    const mine = await newMerchant();
    const first = await payment(await invoice(mine.merchant.id, "PAID"), USDC(1), "FINALIZED");
    await tick();
    const second = await payment(await invoice(mine.merchant.id, "PAID"), USDC(2), "FINALIZED");
    const other = await merchant(PAYER); // shares the payout wallet in the fixtures
    const theirs = await payment(await invoice(other.id, "PAID"), USDC(50), "FINALIZED");

    const response = await download(mine.cookie);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-export-rows")).toBe("2");
    expect(response.headers.get("x-export-truncated")).toBe("false");
    const body = await response.text();
    expect(body.indexOf(second.signature)).toBeLessThan(body.indexOf(first.signature));
    expect(body).not.toContain(theirs.signature);
  });

  it("follows the page's filter and search", async () => {
    const { merchant: m, cookie } = await newMerchant();
    const late = await payment(await invoice(m.id, "PAID"), USDC(1), "FINALIZED", true);
    await payment(await invoice(m.id, "CONFIRMING"), USDC(1), "CONFIRMED");
    const target = await invoice(m.id, "PAID");
    const found = await payment(target, USDC(3), "FINALIZED");

    const lateRows = await rowsOf(await download(cookie, "?filter=LATE"));
    expect(lateRows).toHaveLength(1);
    expect(lateRows[0]).toContain(late.signature);

    const searched = await rowsOf(await download(cookie, `?q=${target.invoiceNumber.toLowerCase()}`));
    expect(searched).toHaveLength(1);
    expect(searched[0]).toContain(found.signature);
  });

  it("neutralises a formula in a merchant-supplied order ID", async () => {
    const { merchant: m, cookie } = await newMerchant();
    await payment(await invoice(m.id, "PAID", { orderId: '=HYPERLINK("http://evil.example","x")' }), USDC(1), "FINALIZED");

    const [row] = await rowsOf(await download(cookie));
    expect(row).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    expect(row).not.toMatch(/(^|,)"=/); // no cell starts with a bare =
  });

  it("rejects an invalid filter or search instead of guessing", async () => {
    const { cookie } = await newMerchant();
    expect((await download(cookie, "?filter=EVERYTHING")).status).toBe(400);
    expect((await download(cookie, "?q=INV-2026")).status).toBe(400);
  });

  it("is limited to 10 exports per minute per merchant", async () => {
    freezeClockMidMinute(); // all requests in one fixed rate-limit window
    const { cookie } = await newMerchant();
    for (let i = 0; i < 10; i++) expect((await download(cookie)).status).toBe(200);
    expect((await download(cookie)).status).toBe(429);
  });
});

describe("the row cap", () => {
  it("stops at the cap, keeps the newest rows, and says it was truncated", async () => {
    const m = await merchant(PAYER);
    const recorded = [];
    for (let i = 0; i < 3; i++) {
      recorded.push(await payment(await invoice(m.id, "PAID"), USDC(1), "FINALIZED"));
      await tick();
    }

    const capped = await exportPayments(m.id, {}, 2);
    expect(capped).toMatchObject({ rows: 2, truncated: true });
    expect(capped.csv).toContain(recorded[2]!.signature);
    expect(capped.csv).not.toContain(recorded[0]!.signature);
    expect(await exportPayments(m.id, {}, 3)).toMatchObject({ rows: 3, truncated: false });
  });
});
