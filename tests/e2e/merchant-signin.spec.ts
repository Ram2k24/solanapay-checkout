import { expect, test, type Page } from "@playwright/test";
import { query, resetDatabase } from "./support/db";
import { installTestWallet, TEST_WALLET_NAME, type TestWallet } from "./support/test-wallet";

// §19 E2E: merchant login (Sign-In With Solana through a real wallet flow) and
// onboarding, in a real browser against a production build.

test.beforeEach(async () => {
  await resetDatabase();
});

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

async function connectWallet(page: Page) {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("dialog", { name: "Wallet" }).getByRole("button", { name: TEST_WALLET_NAME }).click();
}

async function signIn(page: Page, wallet: TestWallet) {
  await connectWallet(page);
  await expect(page.getByRole("button", { name: short(wallet.address) })).toBeVisible();
  await page.getByRole("button", { name: "Sign in with wallet" }).click();
  await expect(page.getByText("Signed in as merchant")).toBeVisible();
}

test("merchant pages ask for sign-in and show no data before it", async ({ page }) => {
  await installTestWallet(page);
  for (const path of ["/dashboard", "/invoices", "/transactions", "/settings"]) {
    await page.goto(path);
    await expect(page.getByText("Sign in required")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Merchant" })).toHaveCount(0);
  }
});

test("a new merchant signs in with a wallet, sets up a profile and reaches the dashboard", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await page.goto("/dashboard");

  await signIn(page, wallet);

  // No profile yet: the dashboard sends the merchant to onboarding.
  await expect(page.getByRole("heading", { name: "Set up your merchant profile" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${short(wallet.address)}.`)).toBeVisible();
  await expect(page.getByLabel("Payout wallet")).toHaveValue(wallet.address); // defaults to the signed-in wallet

  await page.getByLabel("Business name").fill("E2E Coffee");
  await page.getByRole("button", { name: "Create merchant profile" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("E2E Coffee", { exact: true })).toBeVisible();

  // What the server stored, not what the page shows.
  const stored = await query(
    `SELECT m.name, u.wallet_address AS owner, w.address AS payout, w.is_default
       FROM merchants m JOIN users u ON u.id = m.owner_user_id JOIN wallets w ON w.merchant_id = m.id`,
  );
  expect(stored).toEqual([{ name: "E2E Coffee", owner: wallet.address, payout: wallet.address, is_default: true }]);

  // The session survives a reload (cookie, not page state).
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("cancelling the signature in the wallet leaves the merchant signed out, with a clear message", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await page.goto("/dashboard");
  await connectWallet(page);

  await wallet.rejectNextRequest();
  await page.getByRole("button", { name: "Sign in with wallet" }).click();

  // Scoped to the wallet panel: Next.js also renders an (empty) role="alert" route announcer.
  await expect(page.getByRole("dialog", { name: "Wallet" }).getByRole("alert")).toHaveText("You cancelled the request in your wallet.");
  await expect(page.getByText("Sign in required")).toBeVisible();
  expect(await query("SELECT id FROM sessions")).toEqual([]);

  // Trying again works.
  await page.getByRole("button", { name: "Sign in with wallet" }).click();
  await expect(page.getByText("Signed in as merchant")).toBeVisible();
});

test("signing out ends the session on the server", async ({ page }) => {
  const wallet = await installTestWallet(page);
  await page.goto("/dashboard");
  await signIn(page, wallet);
  await expect(page.getByRole("heading", { name: "Set up your merchant profile" })).toBeVisible();

  // The wallet panel may have closed while the page re-rendered; open it again if so.
  const signOut = page.getByRole("button", { name: "Sign out" });
  if (!(await signOut.isVisible())) await page.getByRole("button", { name: short(wallet.address) }).click();
  await signOut.click();

  await expect(page.getByText("Sign in required")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Sign in required")).toBeVisible();
  expect(await query("SELECT id FROM sessions WHERE revoked_at IS NULL")).toEqual([]);
});
