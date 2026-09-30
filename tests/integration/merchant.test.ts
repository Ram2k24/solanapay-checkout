import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { address } from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getMerchant, POST as createMerchant } from "@/app/api/merchant/route";
import { CIRCLE_USDC_MINT } from "@/lib/config/networks";
import { db } from "@/lib/db/client";
import { resetDatabase } from "../support/db";
import { apiRequest, json, signInNewWallet } from "../support/http";
import { createTestWallet } from "../support/wallet";

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
