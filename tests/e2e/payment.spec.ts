import { expect, test, type Browser, type Page } from "@playwright/test";
import { query, resetDatabase } from "./support/db";
import { createInvoice, short, signInAsNewMerchant, tile, type StoredInvoice } from "./support/merchant";
import { installTestWallet, TEST_WALLET_NAME, type TestWallet } from "./support/test-wallet";

// §19 E2E: checkout and payment state. A customer pays from a browser wallet; the
// transaction is signed by the wallet, "lands" on the mock chain, and the invoice
// becomes PAID only when the server finds and verifies it there. The browser's own
// claims never change the invoice.

test.beforeEach(async () => {
  await resetDatabase();
});

type StoredPayment = { signature: string; amount: string; sender_wallet: string; recipient_wallet: string; commitment: string; invoice_status: string };

const payments = () =>
  query<StoredPayment>(`SELECT p.signature, p.amount, p.sender_wallet, p.recipient_wallet, p.commitment, i.status AS invoice_status
                          FROM payments p JOIN invoices i ON i.id = p.invoice_id`);

// A customer in their own browser (no merchant session), with a wallet, on the checkout page.
async function customerAt(browser: Browser, invoice: StoredInvoice): Promise<{ customer: Page; payer: TestWallet }> {
  const customer = await (await browser.newContext()).newPage();
  const payer = await installTestWallet(customer);
  await customer.goto(`/pay/${invoice.id}`);
  const box = customer.getByRole("region", { name: "Pay with a browser wallet" });
  await box.getByRole("button", { name: TEST_WALLET_NAME }).click();
  await expect(box.getByText(short(payer.address))).toBeVisible();
  return { customer, payer };
}

test("a customer pays from a browser wallet; the invoice becomes PAID once verified on-chain", async ({ page, browser }) => {
  const merchant = await signInAsNewMerchant(page, "E2E Coffee");
  const invoice = await createInvoice(page, { amount: "7.25", orderId: "ORD-PAY-1" });
  const { customer, payer } = await customerAt(browser, invoice);

  await expect(customer.getByText("You'll pay 7.25 USDC to E2E Coffee.")).toBeVisible();
  await customer.getByRole("button", { name: "Pay 7.25 USDC" }).click();

  // The page updates by itself (status polling every 3 s), with no reload by the test.
  await expect(customer.getByText("Payment confirmed")).toBeVisible({ timeout: 20_000 });

  const [payment] = await payments();
  expect(payment).toMatchObject({
    amount: "7250000",
    sender_wallet: payer.address,
    recipient_wallet: merchant.address,
    commitment: "FINALIZED",
    invoice_status: "PAID",
  });
  await expect(customer.getByText(payment!.signature)).toBeVisible();
  await expect(customer.getByRole("link", { name: "View on Solana Explorer" })).toHaveAttribute("href", new RegExp(payment!.signature));
  await expect(customer.getByRole("button", { name: /^Pay / })).toHaveCount(0); // nothing left to pay

  // The merchant sees it: dashboard figures, recent payments, transaction history.
  await page.goto("/dashboard");
  await expect(tile(page, "Paid")).toHaveText("1");
  await expect(tile(page, "Pending")).toHaveText("0");
  await expect(tile(page, "USDC received")).toHaveText("7.25");
  await page.goto("/transactions");
  const row = page.getByRole("row").filter({ hasText: invoice.invoice_number });
  await expect(row).toContainText("Finalized");
  await expect(row).toContainText(short(payer.address));
  await row.getByRole("link", { name: "Details" }).click();
  await expect(page.getByText(payment!.signature)).toBeVisible();
});

test("the browser's word is not enough: a signature that never reached the chain leaves the invoice pending", async ({ page, browser }) => {
  await signInAsNewMerchant(page);
  const invoice = await createInvoice(page, { amount: "3" });
  const { customer, payer } = await customerAt(browser, invoice);

  payer.skipBroadcastOfNextTransaction();
  await customer.getByRole("button", { name: "Pay 3.00 USDC" }).click();
  await expect(customer.getByText("Payment sent. Waiting for confirmation on Solana…")).toBeVisible();

  // Several status checks later (every 3 s), still nothing recorded.
  await customer.waitForTimeout(10_000);
  expect(await payments()).toEqual([]);
  expect(await query("SELECT status FROM invoices")).toEqual([{ status: "PENDING" }]);
  await expect(customer.getByText("Payment confirmed")).toHaveCount(0);
});

test("cancelling in the wallet changes nothing, and the customer can try again", async ({ page, browser }) => {
  await signInAsNewMerchant(page);
  const invoice = await createInvoice(page, { amount: "2" });
  const { customer, payer } = await customerAt(browser, invoice);

  await payer.rejectNextRequest();
  await customer.getByRole("button", { name: "Pay 2.00 USDC" }).click();

  await expect(customer.getByText("You cancelled the payment in your wallet.")).toBeVisible();
  expect(await payments()).toEqual([]);
  await customer.getByRole("button", { name: "Pay 2.00 USDC" }).click();
  await expect(customer.getByText("Payment confirmed")).toBeVisible({ timeout: 20_000 });
});

test("a payment the chain refuses (not enough USDC) shows a helpful message and records nothing", async ({ page, browser }) => {
  await signInAsNewMerchant(page);
  const invoice = await createInvoice(page, { amount: "5000" }); // the mock payer holds 1,000 USDC
  const { customer } = await customerAt(browser, invoice);

  await customer.getByRole("button", { name: "Pay 5,000.00 USDC" }).click();

  await expect(customer.getByText(/Your wallet couldn't complete the payment\. Check that you have enough USDC/)).toBeVisible();
  expect(await payments()).toEqual([]);
  expect(await query("SELECT status FROM invoices")).toEqual([{ status: "PENDING" }]);
});
