import { beforeEach, describe, expect, it } from "vitest";
import { getPayment, listPayments } from "@/lib/payments/list-payments";
import { toPaymentDetailDto } from "@/lib/payments/payment-dto";
import { resetDatabase } from "../support/db";
import { invoice, merchant, MINT, PAYER, PAYOUT, payment, tick, USDC } from "../support/payments";

// Phase 12: the transaction history query. Newest first, keyset pages, filters, exact
// search, and only the signed-in merchant's payments.
beforeEach(resetDatabase);

const OTHER_OWNER = "JBLD6pPzGX6EWiUVcUZsLe2pqZuddQbwJQWRRfvErMDk";
const signatures = (rows: { signature: string }[]) => rows.map((r) => r.signature);

async function history(count: number) {
  const m = await merchant(PAYER);
  const recorded = [];
  for (let i = 0; i < count; i++) {
    recorded.push(await payment(await invoice(m.id, "PAID"), USDC(1), "FINALIZED"));
    await tick();
  }
  return { m, newestFirst: signatures(recorded).reverse() };
}

describe("pagination", () => {
  it("pages newest first with no gaps or duplicates, and says when there's no more", async () => {
    const { m, newestFirst } = await history(7);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listPayments(m.id, { cursor, limit: 3 });
      seen.push(...signatures(page.payments));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10); // a broken cursor would page forever: fail fast instead

    expect(pages).toBeLessThan(10);

    expect(seen).toEqual(newestFirst);
    expect(pages).toBe(3); // 3 + 3 + 1
  });

  it("has no next page when the last page is exactly full", async () => {
    const { m } = await history(3);
    expect((await listPayments(m.id, { limit: 3 })).nextCursor).toBeNull();
  });
});

describe("filters", () => {
  it("Confirming, Finalized and Late each select only their payments", async () => {
    const m = await merchant(PAYER);
    const confirming = await payment(await invoice(m.id, "CONFIRMING"), USDC(1), "CONFIRMED");
    const finalized = await payment(await invoice(m.id, "PAID"), USDC(1), "FINALIZED");
    const late = await payment(await invoice(m.id, "PAID"), USDC(1), "FINALIZED", true);

    const only = async (filter: "CONFIRMING" | "FINALIZED" | "LATE") =>
      signatures((await listPayments(m.id, { filter, limit: 10 })).payments).sort();
    expect(await only("CONFIRMING")).toEqual([confirming.signature]);
    expect(await only("FINALIZED")).toEqual([finalized.signature, late.signature].sort());
    expect(await only("LATE")).toEqual([late.signature]);
    expect((await listPayments(m.id, { limit: 10 })).payments).toHaveLength(3);
  });
});

describe("exact search", () => {
  it("finds a payment by its full signature or its invoice number", async () => {
    const m = await merchant(PAYER);
    const inv = await invoice(m.id, "PAID");
    const target = await payment(inv, USDC(2), "FINALIZED");
    await payment(await invoice(m.id, "PAID"), USDC(1), "FINALIZED");

    expect(signatures((await listPayments(m.id, { search: { signature: target.signature }, limit: 10 })).payments)).toEqual([target.signature]);
    expect(signatures((await listPayments(m.id, { search: { invoiceNumber: inv.invoiceNumber }, limit: 10 })).payments)).toEqual([target.signature]);
  });

  it("combines search with a filter", async () => {
    const m = await merchant(PAYER);
    const inv = await invoice(m.id, "PAID");
    const target = await payment(inv, USDC(2), "FINALIZED");
    expect((await listPayments(m.id, { search: { signature: target.signature }, filter: "CONFIRMING", limit: 10 })).payments).toEqual([]);
  });
});

describe("merchant isolation", () => {
  it("never lists, finds or pages into another merchant's payments, although they share a payout wallet", async () => {
    const mine = await merchant(PAYER);
    const other = await merchant(OTHER_OWNER);
    const myPayment = await payment(await invoice(mine.id, "PAID"), USDC(1), "FINALIZED");
    await tick();
    const theirInvoice = await invoice(other.id, "PAID");
    const theirs = await payment(theirInvoice, USDC(50), "FINALIZED");

    expect(signatures((await listPayments(mine.id, { limit: 10 })).payments)).toEqual([myPayment.signature]);
    expect((await listPayments(mine.id, { search: { signature: theirs.signature }, limit: 10 })).payments).toEqual([]);
    expect((await listPayments(mine.id, { search: { invoiceNumber: theirInvoice.invoiceNumber }, limit: 10 })).payments).toEqual([]);
    // A cursor taken from their (newer) payment still only pages through mine.
    expect(signatures((await listPayments(mine.id, { cursor: theirs.id, limit: 10 })).payments)).toEqual([myPayment.signature]);
  });
});

describe("transaction detail (Phase 12.3)", () => {
  it("returns the merchant's own payment with every §7I field", async () => {
    const m = await merchant(PAYER);
    const inv = await invoice(m.id, "PAID", { amount: USDC(2.5), orderId: "ORDER-10001" });
    const recorded = await payment(inv, USDC(2.5), "FINALIZED", true);

    const row = await getPayment(m.id, recorded.id);
    expect(row).not.toBeNull();
    const dto = toPaymentDetailDto(row!);

    expect(dto).toMatchObject({
      id: recorded.id, invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, orderId: "ORDER-10001",
      signature: recorded.signature, reference: inv.reference, senderWallet: PAYER, recipientWallet: PAYOUT,
      recipientTokenAccount: recorded.recipientTokenAccount, tokenMint: MINT, amount: "2500000", amountDisplay: "2.50",
      slot: "1", commitment: "FINALIZED", late: true, network: "DEVNET",
    });
    for (const time of [dto.blockTime, dto.verifiedAt, dto.finalizedAt, dto.createdAt]) expect(time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is not found for another merchant's payment, although they share a payout wallet", async () => {
    const mine = await merchant(PAYER);
    const other = await merchant(OTHER_OWNER);
    const theirs = await payment(await invoice(other.id, "PAID"), USDC(50), "FINALIZED");

    expect(await getPayment(mine.id, theirs.id)).toBeNull();
    expect(await getPayment(other.id, theirs.id)).not.toBeNull();
  });

  it("is not found for an id that doesn't exist", async () => {
    const m = await merchant(PAYER);
    expect(await getPayment(m.id, "01a10000-0000-7000-8000-000000000000")).toBeNull();
  });
});
