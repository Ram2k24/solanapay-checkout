import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { getInvoiceSummary, getPaymentTotals } from "@/lib/payments/invoice-summary";
import { listPayments } from "@/lib/payments/list-payments";
import { toRecentPaymentDto } from "@/lib/payments/payment-dto";
import { resetDatabase } from "../support/db";
import { invoice, merchant, PAYER, payment, tick, uniqueSignature, USDC, HOUR, PAYOUT, MINT } from "../support/payments";

// Phase 11: the dashboard's figures, straight from the database. Two merchants share one
// payout wallet (seen on devnet in Phase 8.5), so every figure must be scoped by the
// invoice's merchant, never by wallet.
beforeEach(resetDatabase);

describe("getInvoiceSummary", () => {
  it("counts by effective status: an overdue PENDING invoice is EXPIRED, CONFIRMING is its own count", async () => {
    const m = await merchant(PAYER);
    await invoice(m.id, "PENDING");
    await invoice(m.id, "PENDING", { expiresInMs: -60_000 }); // overdue, not yet expired by the reconciler
    await invoice(m.id, "EXPIRED", { expiresInMs: -HOUR });
    await invoice(m.id, "CONFIRMING");
    await invoice(m.id, "PAID");
    await invoice(m.id, "PAID");

    expect(await getInvoiceSummary(m.id)).toEqual({ PENDING: 1, EXPIRED: 2, CONFIRMING: 1, PAID: 2, FAILED: 0, TOTAL: 6 });
  });

  it("counts only this merchant's invoices, although both use the same payout wallet", async () => {
    const mine = await merchant(PAYER);
    const other = await merchant("JBLD6pPzGX6EWiUVcUZsLe2pqZuddQbwJQWRRfvErMDk");
    await invoice(mine.id, "PAID");
    await invoice(other.id, "PAID");
    await invoice(other.id, "PENDING");

    expect(await getInvoiceSummary(mine.id)).toMatchObject({ PAID: 1, PENDING: 0, TOTAL: 1 });
  });

  it("is all zeros for a new merchant", async () => {
    const m = await merchant(PAYER);
    expect(await getInvoiceSummary(m.id)).toEqual({ PENDING: 0, EXPIRED: 0, CONFIRMING: 0, PAID: 0, FAILED: 0, TOTAL: 0 });
  });
});

describe("getPaymentTotals", () => {
  it("received = FINALIZED payments (late ones included); confirming = CONFIRMED ones; unmatched money in neither", async () => {
    const m = await merchant(PAYER);
    await payment(await invoice(m.id, "PAID"), USDC(2), "FINALIZED");
    await payment(await invoice(m.id, "PAID"), USDC(3.5), "FINALIZED", true); // paid late: still received
    await payment(await invoice(m.id, "CONFIRMING"), USDC(1.25), "CONFIRMED");
    const paid = await invoice(m.id, "PAID");
    await payment(paid, USDC(1), "FINALIZED");
    await db.unmatchedPayment.create({
      data: {
        merchantId: m.id, invoiceId: paid.id, reason: "DUPLICATE_PAYMENT", signature: uniqueSignature("Dup"), network: "DEVNET",
        reference: paid.reference, senderWallet: PAYER, recipientWallet: PAYOUT,
        recipientTokenAccount: "4mCBk3FmruHdVz9Xy15C1KyEzSSimhrmX9dMF3d3XEhu", tokenMint: MINT, amount: USDC(100), slot: 2n,
        commitment: "FINALIZED",
      },
    });

    expect(await getPaymentTotals(m.id)).toEqual({ received: USDC(6.5), confirming: USDC(1.25) });
  });

  it("counts only this merchant's payments, although both use the same payout wallet", async () => {
    const mine = await merchant(PAYER);
    const other = await merchant("JBLD6pPzGX6EWiUVcUZsLe2pqZuddQbwJQWRRfvErMDk");
    await payment(await invoice(mine.id, "PAID"), USDC(1), "FINALIZED");
    await payment(await invoice(other.id, "PAID"), USDC(50), "FINALIZED");
    await payment(await invoice(other.id, "CONFIRMING"), USDC(7), "CONFIRMED");

    expect(await getPaymentTotals(mine.id)).toEqual({ received: USDC(1), confirming: 0n });
  });

  it("is zero without payments", async () => {
    const m = await merchant(PAYER);
    expect(await getPaymentTotals(m.id)).toEqual({ received: 0n, confirming: 0n });
  });
});

describe("listPayments: the dashboard's recent payments", () => {
  it("returns this merchant's payments, newest first, with the invoice number, up to the limit", async () => {
    const mine = await merchant(PAYER);
    const other = await merchant("JBLD6pPzGX6EWiUVcUZsLe2pqZuddQbwJQWRRfvErMDk");
    const invoices = [];
    for (let i = 0; i < 4; i++) invoices.push(await invoice(mine.id, "PAID"));
    const recorded = [];
    for (const inv of invoices) {
      recorded.push(await payment(inv, USDC(1), "FINALIZED"));
      await tick();
    }
    const othersInvoice = await invoice(other.id, "PAID");
    await payment(othersInvoice, USDC(9), "FINALIZED"); // newest overall, but not ours

    const { payments: recent } = await listPayments(mine.id, { limit: 3 });

    expect(recent.map((p) => p.signature)).toEqual(recorded.slice(1).reverse().map((p) => p.signature));
    expect(recent[0]!.invoice).toEqual({ id: invoices[3]!.id, invoiceNumber: invoices[3]!.invoiceNumber, orderId: null });
  });

  it("is empty without payments", async () => {
    const m = await merchant(PAYER);
    await invoice(m.id, "PENDING");
    expect((await listPayments(m.id, { limit: 5 })).payments).toEqual([]);
  });
});

describe("toRecentPaymentDto", () => {
  it("shows the payment, its invoice and a devnet Explorer link, never the invoice's reference key", async () => {
    const m = await merchant(PAYER);
    const inv = await invoice(m.id, "PAID", { amount: USDC(2) });
    const recorded = await payment(inv, USDC(2), "FINALIZED", true);
    const [row] = (await listPayments(m.id, { limit: 5 })).payments;

    const dto = toRecentPaymentDto(row!);

    expect(dto).toMatchObject({
      signature: recorded.signature, invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, amountDisplay: "2.00",
      senderWallet: PAYER, commitment: "FINALIZED", late: true,
    });
    const explorer = new URL(dto.explorerUrl); // base URL comes from the environment
    expect(explorer.pathname).toBe(`/tx/${recorded.signature}`);
    expect(explorer.searchParams.get("cluster")).toBe("devnet");
    expect(JSON.stringify(dto)).not.toContain(inv.reference);
  });
});
