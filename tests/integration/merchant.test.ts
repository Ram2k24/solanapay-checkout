import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { address } from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getMerchant, PATCH as updateMerchant, POST as createMerchant } from "@/app/api/merchant/route";
import { CIRCLE_USDC_MINT } from "@/lib/config/networks";
import { db } from "@/lib/db/client";
import { resetDatabase } from "../support/db";
import { apiRequest, json, signInNewWallet, signInWith } from "../support/http";
import { createTestWallet } from "../support/wallet";
import { freezeClockMidMinute } from "../support/clock";

beforeEach(resetDatabase);

describe("merchant onboarding", () => {
  it("requires sign-in", async () => {
    const response = await createMerchant(apiRequest("/api/merchant", { body: { name: "Shop" } }));
    expect(response.status).toBe(401);
  });

  it("creates the profile with the signed-in wallet as default payout wallet", async () => {
    const { wallet, cookie } = await signInNewWallet();
    const response = await createMerchant(apiRequest("/api/merchant", { cookie, body: { name: "  Acme Store  ", email: "shop@example.com" } }));
    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({ name: "Acme Store", email: "shop@example.com", payoutWallet: wallet.address });

    const me = await json(await getMerchant(apiRequest("/api/merchant", { method: "GET", cookie })));
    expect(me.payoutWallet).toBe(wallet.address);
    expect(await db.wallet.count({ where: { isDefault: true } })).toBe(1);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "merchant.created" } })).entityId).toBe(me.id);
  });

  it("accepts a different valid payout wallet", async () => {
    const { cookie } = await signInNewWallet();
    const payout = await createTestWallet();
    const response = await createMerchant(apiRequest("/api/merchant", { cookie, body: { name: "Shop", payoutWallet: payout.address } }));
    expect((await json(response)).payoutWallet).toBe(payout.address);
  });

  it("rejects an invalid or program-derived payout wallet", async () => {
    const { wallet, cookie } = await signInNewWallet();
    const [tokenAccount] = await findAssociatedTokenPda({
      owner: address(wallet.address),
      mint: address(CIRCLE_USDC_MINT.devnet),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    for (const payoutWallet of ["not-an-address", tokenAccount]) {
      const response = await createMerchant(apiRequest("/api/merchant", { cookie, body: { name: "Shop", payoutWallet } }));
      expect(response.status).toBe(400);
      expect((await json(response)).error.fields.payoutWallet).toBeTruthy();
    }
    expect(await db.merchant.count()).toBe(0);
  });

  it("refuses another merchant's current payout wallet, chosen or as the signed-in default (Phase 13, D5)", async () => {
    const existing = await signInNewWallet();
    await createMerchant(apiRequest("/api/merchant", { cookie: existing.cookie, body: { name: "First" } }));

    const { cookie } = await signInNewWallet();
    const chosen = await createMerchant(apiRequest("/api/merchant", { cookie, body: { name: "Shop", payoutWallet: existing.wallet.address } }));
    expect(chosen.status).toBe(400);
    expect((await json(chosen)).error.fields.payoutWallet).toMatch(/another merchant's payout wallet/);

    // A wallet signing in to open a business, when it is already another merchant's payout wallet.
    const payout = await createTestWallet();
    const second = await signInNewWallet();
    await createMerchant(apiRequest("/api/merchant", { cookie: second.cookie, body: { name: "Second", payoutWallet: payout.address } }));
    const asDefault = await createMerchant(apiRequest("/api/merchant", { cookie: (await signInWith(payout)).cookie, body: { name: "Third" } }));
    expect(asDefault.status).toBe(400);
    expect((await json(asDefault)).error.fields.payoutWallet).toMatch(/another merchant's payout wallet/);
    expect(await db.merchant.count()).toBe(2);
  });

  it("allows only one profile per user", async () => {
    const { cookie } = await signInNewWallet();
    await createMerchant(apiRequest("/api/merchant", { cookie, body: { name: "Shop" } }));
    const second = await createMerchant(apiRequest("/api/merchant", { cookie, body: { name: "Shop 2" } }));
    expect(second.status).toBe(409);
    expect((await json(second)).error.code).toBe("MerchantAlreadyExists");
  });

  it("validates fields and rejects unknown ones", async () => {
    const { cookie } = await signInNewWallet();
    const blank = await json(await createMerchant(apiRequest("/api/merchant", { cookie, body: { name: "   " } })));
    expect(blank.error.fields.name).toBeTruthy();
    const extra = await json(await createMerchant(apiRequest("/api/merchant", { cookie, body: { name: "Shop", ownerUserId: "x" } })));
    expect(extra.error.fields.ownerUserId).toBe("This field is not accepted.");
  });

  it("returns 404 before onboarding", async () => {
    const { cookie } = await signInNewWallet();
    expect((await getMerchant(apiRequest("/api/merchant", { method: "GET", cookie }))).status).toBe(404);
  });
});

// Settings (Phase 11.4b): name and email only; the payout wallet needs its own signed flow.
describe("merchant settings: PATCH /api/merchant", () => {
  async function merchantSession(name = "Shop", email = "old@example.com") {
    const session = await signInNewWallet();
    await createMerchant(apiRequest("/api/merchant", { cookie: session.cookie, body: { name, email } }));
    return session;
  }
  const patch = (cookie: string | undefined, body: unknown, origin?: string | null) =>
    updateMerchant(apiRequest("/api/merchant", { method: "PATCH", cookie, body, origin }));

  it("requires sign-in and a merchant profile, from our own site", async () => {
    expect((await patch(undefined, { name: "X" })).status).toBe(401);
    const { cookie } = await signInNewWallet(); // signed in, no profile yet
    expect((await json(await patch(cookie, { name: "X" }))).error.code).toBe("MerchantProfileRequired");
    const merchant = await merchantSession();
    expect((await patch(merchant.cookie, { name: "X" }, "https://evil.example")).status).toBe(403);
    expect(await db.merchant.count({ where: { name: "X" } })).toBe(0);
  });

  it("updates name and email, audits old and new values, and keeps the payout wallet", async () => {
    const { wallet, cookie } = await merchantSession();
    const response = await patch(cookie, { name: "  Laptop Store  ", email: "pay@example.com" });

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ name: "Laptop Store", email: "pay@example.com", payoutWallet: wallet.address });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "merchant.updated" } });
    expect(audit.data).toEqual({ name: { from: "Shop", to: "Laptop Store" }, email: { from: "old@example.com", to: "pay@example.com" } });
  });

  it("updates one field alone, and an empty email clears it", async () => {
    const { cookie } = await merchantSession();
    expect(await json(await patch(cookie, { email: "" }))).toMatchObject({ name: "Shop", email: null });
    expect(await json(await patch(cookie, { name: "Renamed" }))).toMatchObject({ name: "Renamed", email: null });
  });

  it("writes nothing when nothing changes", async () => {
    const { cookie } = await merchantSession();
    expect((await patch(cookie, { name: "Shop", email: "old@example.com" })).status).toBe(200);
    expect(await db.auditLog.count({ where: { action: "merchant.updated" } })).toBe(0);
  });

  it("never changes the payout wallet: the field is rejected", async () => {
    const { wallet, cookie } = await merchantSession();
    const other = await createTestWallet();
    const response = await patch(cookie, { name: "Shop", payoutWallet: other.address });

    expect(response.status).toBe(400);
    expect((await json(response)).error.fields.payoutWallet).toBe("This field is not accepted.");
    expect((await db.wallet.findFirstOrThrow({ where: { isDefault: true } })).address).toBe(wallet.address);
  });

  it("validates: something to update, a non-blank name, a real email", async () => {
    const { cookie } = await merchantSession();
    expect((await patch(cookie, {})).status).toBe(400);
    expect((await json(await patch(cookie, { name: "   " }))).error.fields.name).toBeTruthy();
    expect((await json(await patch(cookie, { email: "not-an-email" }))).error.fields.email).toBeTruthy();
    expect(await db.merchant.findFirstOrThrow()).toMatchObject({ name: "Shop", email: "old@example.com" });
  });

  it("changes only the signed-in merchant", async () => {
    const mine = await merchantSession("Mine");
    await merchantSession("Theirs");
    await patch(mine.cookie, { name: "Mine renamed" });
    expect((await db.merchant.findMany({ orderBy: { createdAt: "asc" } })).map((m) => m.name)).toEqual(["Mine renamed", "Theirs"]);
  });

  it("is rate-limited to 20 updates per minute per merchant", async () => {
    freezeClockMidMinute(); // all requests in one fixed rate-limit window
    const { cookie } = await merchantSession();
    for (let i = 0; i < 20; i++) expect((await patch(cookie, { name: `Shop ${i}` })).status).toBe(200);
    const limited = await patch(cookie, { name: "One too many" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
