import { beforeEach, describe, expect, it } from "vitest";
import { POST as createInvoice } from "@/app/api/invoices/route";
import { CIRCLE_USDC_MINT } from "@/lib/config/networks";
import { db } from "@/lib/db/client";
import { getPublicCheckout } from "@/lib/payments/checkout";
import { encodeTransferRequest, paymentLinks } from "@/lib/payments/solana-pay";
import { resetDatabase } from "../support/db";
import { apiRequest, json, newMerchant } from "../support/http";

beforeEach(resetDatabase);

const HTTPS_APP = "https://pay.example.com";

async function invoiceFor(cookie: string, body: Record<string, unknown>) {
  return json(await createInvoice(apiRequest("/api/invoices", { cookie, body })));
}

describe("public checkout", () => {
  it("builds the payment link only from the stored invoice", async () => {
    const { cookie, wallet } = await newMerchant("Laptop Store");
    const created = await invoiceFor(cookie, {
      amount: "10.00",
      orderId: "ORDER-10001",
      description: "Laptop accessory purchase",
      customerReference: "alice@example.com",
    });

    const checkout = await getPublicCheckout(created.id);
    const row = await db.invoice.findUniqueOrThrow({ where: { id: created.id } });
    // The test app URL is http://localhost:3000, so the transfer request is the primary link.
    expect(checkout?.payment).toEqual({
      kind: "transfer-request",
      primary: encodeTransferRequest(row, "Laptop Store"),
      transfer: encodeTransferRequest(row, "Laptop Store"),
    });

    const url = new URL(checkout!.payment!.primary);
    expect(url.protocol).toBe("solana:");
    expect(url.pathname).toBe(wallet.address); // recipient = stored payout wallet
    expect(url.searchParams.get("amount")).toBe("10");
    expect(url.searchParams.get("spl-token")).toBe(CIRCLE_USDC_MINT.devnet);
    expect(url.searchParams.get("reference")).toBe(row.reference);
    expect(url.searchParams.get("label")).toBe("Laptop Store");
    expect(url.searchParams.get("message")).toBe("INV-" + new Date().getUTCFullYear() + "-00001 · Laptop accessory purchase");
  });

  it("exposes only the allowlisted public fields", async () => {
    const { cookie } = await newMerchant();
    const created = await invoiceFor(cookie, { amount: "5", customerReference: "internal-customer-42" });
    const checkout = await getPublicCheckout(created.id);

    expect(Object.keys(checkout!).sort()).toEqual(
      ["amountDisplay", "currency", "description", "expiresAt", "invoiceNumber", "merchantName", "network", "orderId", "payment", "recipientShort", "status"].sort(),
    );
    const serialized = JSON.stringify(checkout);
    expect(serialized).not.toContain("internal-customer-42"); // customer reference stays internal
    expect(serialized).not.toContain(created.id); // no internal IDs
  });

  it("shows no payment link once the invoice has expired", async () => {
    const { cookie } = await newMerchant();
    const created = await invoiceFor(cookie, { amount: "5" });
    await db.invoice.update({ where: { id: created.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const checkout = await getPublicCheckout(created.id);
    expect(checkout).toMatchObject({ status: "EXPIRED", payment: null });
  });

  it("shows no payment link for final states", async () => {
    const { cookie } = await newMerchant();
    const created = await invoiceFor(cookie, { amount: "5" });
    await db.invoice.update({ where: { id: created.id }, data: { status: "FAILED", failureReason: "test" } });
    expect((await getPublicCheckout(created.id))?.payment).toBeNull();
    expect((await getPublicCheckout(created.id, new Date(), HTTPS_APP))?.payment).toBeNull();
  });

  it("makes the transaction request the primary link when the app URL is HTTPS", async () => {
    const { cookie } = await newMerchant("Laptop Store");
    const created = await invoiceFor(cookie, { amount: "10.00" });
    const row = await db.invoice.findUniqueOrThrow({ where: { id: created.id } });

    const checkout = await getPublicCheckout(created.id, new Date(), HTTPS_APP);
    expect(checkout?.payment).toEqual({
      kind: "transaction-request",
      // The endpoint path carries only the invoice ID; the terms are read server-side.
      primary: `solana:https://pay.example.com/api/pay/${created.id}/transaction`,
      transfer: encodeTransferRequest(row, "Laptop Store"), // basic link kept as the fallback
    });
    expect(checkout?.payment).toEqual(paymentLinks(row, "Laptop Store", HTTPS_APP));
  });

  it("shows no transaction request for an expired invoice", async () => {
    const { cookie } = await newMerchant();
    const created = await invoiceFor(cookie, { amount: "5" });
    await db.invoice.update({ where: { id: created.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await getPublicCheckout(created.id, new Date(), HTTPS_APP))?.payment).toBeNull();
  });

  it("returns nothing for unknown or malformed IDs", async () => {
    expect(await getPublicCheckout("01a0f348-4244-76df-99c6-699a320850f3")).toBeNull();
    expect(await getPublicCheckout("not-a-uuid")).toBeNull();
    expect(await getPublicCheckout("'; DROP TABLE invoices; --")).toBeNull();
  });
});
