import { expect, test } from "@playwright/test";
import { generateKeyPair, getAddressFromPublicKey } from "@solana/kit";
import { query, resetDatabase } from "./support/db";
import { E2E_DEMO_MERCHANT_ID } from "./support/env";
import { short } from "./support/merchant";
import { installTestWallet, TEST_WALLET_NAME } from "./support/test-wallet";

// Phase 16 (decision H2-A): a visitor tries the product from the landing page, without
// signing up: "Try a demo payment" → the normal checkout → pay 0.01 USDC → PAID once the
// server has verified the payment.

let payout: string;
test.beforeEach(async () => {
  await resetDatabase();
  payout = await getAddressFromPublicKey((await generateKeyPair()).publicKey);
  const [user] = await query<{ id: string }>("INSERT INTO users (id, wallet_address, updated_at) VALUES (gen_random_uuid(), $1, now()) RETURNING id", [payout]);
  await query("INSERT INTO merchants (id, owner_user_id, name, updated_at) VALUES ($1, $2, 'SolanaPay Demo Store', now())", [E2E_DEMO_MERCHANT_ID, user!.id]);
  await query("INSERT INTO wallets (id, merchant_id, address, is_default, updated_at) VALUES (gen_random_uuid(), $1, $2, true, now())", [E2E_DEMO_MERCHANT_ID, payout]);
});

test("a visitor pays a demo invoice from the landing page and sees it verified", async ({ page }) => {
  const payer = await installTestWallet(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Try a demo payment" }).click();

  await expect(page).toHaveURL(/\/pay\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Pay SolanaPay Demo Store")).toBeVisible();
  await expect(page.getByText(/^0\.01\s*USDC$/)).toBeVisible();
  await expect(page.getByText(short(payout))).toBeVisible();

  const box = page.getByRole("region", { name: "Pay with a browser wallet" });
  await box.getByRole("button", { name: TEST_WALLET_NAME }).click();
  await page.getByRole("button", { name: "Pay 0.01 USDC" }).click();
  await expect(page.getByText("Payment confirmed")).toBeVisible({ timeout: 20_000 });

  const payments = await query(
    `SELECT p.amount, p.sender_wallet, p.recipient_wallet, i.status, i.merchant_id FROM payments p JOIN invoices i ON i.id = p.invoice_id`,
  );
  expect(payments).toEqual([{ amount: "10000", sender_wallet: payer.address, recipient_wallet: payout, status: "PAID", merchant_id: E2E_DEMO_MERCHANT_ID }]);
});
