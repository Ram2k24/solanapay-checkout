import { expect, type Page } from "@playwright/test";
import { query } from "./db";
import { installTestWallet, TEST_WALLET_NAME, type TestWallet } from "./test-wallet";

// Shared browser steps for the merchant side, done through the real UI.

export const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export async function connectWallet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("dialog", { name: "Wallet" }).getByRole("button", { name: TEST_WALLET_NAME }).click();
}

export async function signIn(page: Page, wallet: TestWallet): Promise<void> {
  await connectWallet(page);
  await expect(page.getByRole("button", { name: short(wallet.address) })).toBeVisible();
  await page.getByRole("button", { name: "Sign in with wallet" }).click();
  await expect(page.getByText("Signed in as merchant")).toBeVisible();
}

// A fresh wallet signs in and creates a merchant profile; ends on the dashboard.
export async function signInAsNewMerchant(page: Page, name = "E2E Coffee"): Promise<TestWallet> {
  const wallet = await installTestWallet(page);
  await page.goto("/onboarding");
  await signIn(page, wallet);
  await page.getByLabel("Business name").fill(name);
  await page.getByRole("button", { name: "Create merchant profile" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  return wallet;
}

// The value of a dashboard tile, e.g. tile(page, "Pending").
export function tile(page: Page, label: string) {
  return page
    .locator("dl > div")
    .filter({ has: page.locator("dt").getByText(label, { exact: true }) })
    .locator("dd")
    .first();
}

export type StoredInvoice = { id: string; invoice_number: string; amount: string; status: string; recipient_wallet: string; token_mint: string; reference: string };

// Creates an invoice through the form; returns the row the server stored.
export async function createInvoice(page: Page, fields: { amount: string; orderId?: string; description?: string; customerReference?: string }) {
  await page.goto("/invoices/new");
  await page.getByLabel("Amount (USDC)").fill(fields.amount);
  if (fields.orderId) await page.getByLabel("Order ID").fill(fields.orderId);
  if (fields.description) await page.getByLabel("Description").fill(fields.description);
  if (fields.customerReference) await page.getByLabel("Customer reference").fill(fields.customerReference);
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
  const [invoice] = await query<StoredInvoice>("SELECT * FROM invoices ORDER BY created_at DESC LIMIT 1");
  return invoice!;
}
