import { expect, test } from "@playwright/test";
import { query, resetDatabase } from "./support/db";
import { createInvoice, short, signInAsNewMerchant, tile } from "./support/merchant";

// §19 E2E: create invoice, checkout (the customer's page) and dashboard, through the
// real UI. The payment itself is covered in payment.spec.ts.

test.beforeEach(async () => {
  await resetDatabase();
});

test("a merchant creates an invoice; the server fixes its terms", async ({ page }) => {
  const wallet = await signInAsNewMerchant(page);

  const invoice = await createInvoice(page, { amount: "1234.567", orderId: "ORD-E2E-1", description: "Two flat whites" });

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("1,234.567 USDC");
  await expect(page.getByText(invoice.invoice_number).first()).toBeVisible();
  await expect(page.getByText("pending", { exact: true }).first()).toBeVisible(); // badge text; CSS capitalizes it
  await expect(page.getByText(`http://localhost:3200/pay/${invoice.id}`)).toBeVisible();
  await expect(page.getByRole("img", { name: "Solana Pay QR code" })).toBeVisible();

  // Terms come from the server: exact base units, the merchant's payout wallet, devnet USDC.
  expect(invoice).toMatchObject({
    invoice_number: expect.stringMatching(/^INV-\d{4}-00001$/),
    amount: "1234567000",
    status: "PENDING",
    recipient_wallet: wallet.address,
    token_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // Circle's devnet USDC
  });
});

test("invalid amounts are refused with a message, and nothing is created", async ({ page }) => {
  await signInAsNewMerchant(page);
  await page.goto("/invoices/new");

  // Empty, zero, not a number, 7 decimals (USDC has 6), far above the devnet cap.
  for (const amount of ["", "0", "abc", "1.1234567", "1000000000"]) {
    await page.getByLabel("Amount (USDC)").fill(amount);
    await page.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByLabel("Amount (USDC)").locator("xpath=..").locator("span.text-red-700")).toBeVisible();
    await expect(page).toHaveURL(/\/invoices\/new$/);
  }
  expect(await query("SELECT id FROM invoices")).toEqual([]);
});

test("the customer's checkout page shows what to pay, and nothing internal", async ({ page, browser }) => {
  const wallet = await signInAsNewMerchant(page, "E2E Coffee");
  const invoice = await createInvoice(page, {
    amount: "12.5",
    orderId: "ORD-E2E-2",
    description: "Two flat whites",
    customerReference: "Alice, table 4",
  });

  // A customer: another browser, no session.
  const customer = await (await browser.newContext()).newPage();
  await customer.goto(`/pay/${invoice.id}`);

  await expect(customer.getByText("Pay E2E Coffee")).toBeVisible();
  await expect(customer.getByText(/^12\.50\s*USDC$/)).toBeVisible();
  await expect(customer.getByText("Two flat whites")).toBeVisible();
  await expect(customer.getByText(invoice.invoice_number)).toBeVisible();
  await expect(customer.getByText("ORD-E2E-2")).toBeVisible();
  await expect(customer.getByText(short(wallet.address))).toBeVisible();
  await expect(customer.getByRole("img", { name: "Solana Pay QR code" })).toBeVisible();
  await expect(customer.getByRole("link", { name: "Open in wallet" })).toHaveAttribute("href", /^solana:/);

  // Internal fields stay with the merchant.
  await expect(customer.getByText("Alice, table 4")).toHaveCount(0);
  await expect(customer.getByText(invoice.reference)).toHaveCount(0);
});

test("an expired invoice can't be paid from the checkout page", async ({ page, browser }) => {
  await signInAsNewMerchant(page);
  const invoice = await createInvoice(page, { amount: "5" });
  await query("UPDATE invoices SET expires_at = created_at + interval '1 millisecond' WHERE id = $1", [invoice.id]);

  const customer = await (await browser.newContext()).newPage();
  await customer.goto(`/pay/${invoice.id}`);

  await expect(customer.getByText("This invoice has expired. Ask the merchant for a new payment link.")).toBeVisible();
  await expect(customer.getByRole("img", { name: "Solana Pay QR code" })).toHaveCount(0);
  await expect(customer.getByRole("link", { name: "Open in wallet" })).toHaveCount(0);
  await expect(customer.getByRole("button", { name: /Pay .* USDC/ })).toHaveCount(0);
});

test("an unknown invoice is not found", async ({ page }) => {
  const response = await page.goto("/pay/01a10769-6d13-71aa-b98e-6faf1fc380d5");
  expect(response?.status()).toBe(404);
});

test("the dashboard counts the merchant's invoices", async ({ page }) => {
  await signInAsNewMerchant(page);
  await expect(page.getByText("No invoices yet")).toBeVisible();
  await createInvoice(page, { amount: "1" });
  const expired = await createInvoice(page, { amount: "2" });
  await query("UPDATE invoices SET expires_at = created_at + interval '1 millisecond' WHERE id = $1", [expired.id]);

  await page.goto("/dashboard");

  await expect(tile(page, "Total invoices")).toHaveText("2");
  await expect(tile(page, "Pending")).toHaveText("1");
  await expect(tile(page, "Expired")).toHaveText("1");
  await expect(tile(page, "Paid")).toHaveText("0");
  await expect(tile(page, "USDC received")).toHaveText("0.00");
  await expect(page.getByText("No payments yet. They appear here once verified on Solana.")).toBeVisible();
  await expect(page.getByRole("link", { name: expired.invoice_number })).toBeVisible();
});
