import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as nonce } from "@/app/api/auth/nonce/route";
import { POST as createInvoice } from "@/app/api/invoices/route";
import { POST as createMerchant } from "@/app/api/merchant/route";
import { POST as requestChange } from "@/app/api/merchant/payout-wallet/challenge/route";
import { POST as confirmChange } from "@/app/api/merchant/payout-wallet/route";
import { db } from "@/lib/db/client";
import { resetDatabase } from "../support/db";
import { apiRequest, json, signInNewWallet } from "../support/http";
import { createTestWallet } from "../support/wallet";
import { freezeClockMidMinute } from "../support/clock";

// Phase 11.4c: changing the payout wallet needs the signed-in wallet's signature over a
// payout-change challenge naming the new wallet (decision D5).
beforeEach(resetDatabase);

type Session = Awaited<ReturnType<typeof signInNewWallet>>;

async function merchant(): Promise<Session> {
  const session = await signInNewWallet();
  await createMerchant(apiRequest("/api/merchant", { cookie: session.cookie, body: { name: "Shop" } }));
  return session;
}
const challengeFor = (cookie: string | undefined, payoutWallet: string, origin?: string | null) =>
  requestChange(apiRequest("/api/merchant/payout-wallet/challenge", { cookie, body: { payoutWallet }, origin }));
const confirm = (cookie: string | undefined, body: unknown) => confirmChange(apiRequest("/api/merchant/payout-wallet", { cookie, body }));
const defaultWallet = async () => (await db.wallet.findFirstOrThrow({ where: { isDefault: true } })).address;

async function changeTo(session: Session, newWallet: string) {
  const challenge = await json(await challengeFor(session.cookie, newWallet));
  return confirm(session.cookie, { nonce: challenge.nonce, signature: await session.wallet.sign(challenge.message) });
}

describe("changing the payout wallet", () => {
  it("changes it after the signed-in wallet signs, audits it, and keeps the old wallet on record", async () => {
    const session = await merchant();
    const next = await createTestWallet();

    const challengeResponse = await challengeFor(session.cookie, next.address);
    expect(challengeResponse.status).toBe(200);
    const challenge = await json(challengeResponse);
    expect(challenge.message).toContain(`New payout wallet for your SolanaPay Checkout merchant account:\n${next.address}`);
    expect(challenge.message).toContain("Chain ID: devnet");
    expect(await defaultWallet()).toBe(session.wallet.address); // nothing changes before the signature

    const response = await confirm(session.cookie, { nonce: challenge.nonce, signature: await session.wallet.sign(challenge.message) });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ payoutWallet: next.address });
    expect(await defaultWallet()).toBe(next.address);
    expect(await db.wallet.count()).toBe(2);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "merchant.payout_wallet_changed" } });
    expect(audit.data).toEqual({ from: session.wallet.address, to: next.address });
  });

  it("existing invoices keep their recipient; new invoices are paid to the new wallet", async () => {
    const session = await merchant();
    const before = await json(await createInvoice(apiRequest("/api/invoices", { cookie: session.cookie, body: { amount: "1" } })));
    const next = await createTestWallet();
    expect((await changeTo(session, next.address)).status).toBe(200);
    const after = await json(await createInvoice(apiRequest("/api/invoices", { cookie: session.cookie, body: { amount: "1" } })));

    expect((await db.invoice.findUniqueOrThrow({ where: { id: before.id } })).recipientWallet).toBe(session.wallet.address);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: after.id } })).recipientWallet).toBe(next.address);
  });

  it("can switch back to a wallet used before", async () => {
    const session = await merchant();
    const next = await createTestWallet();
    await changeTo(session, next.address);
    expect((await changeTo(session, session.wallet.address)).status).toBe(200);
    expect(await defaultWallet()).toBe(session.wallet.address);
    expect(await db.wallet.count({ where: { isDefault: true } })).toBe(1);
  });
});

describe("refusals", () => {
  it("requires sign-in, a merchant profile and our own site", async () => {
    const next = await createTestWallet();
    expect((await challengeFor(undefined, next.address)).status).toBe(401);
    const noProfile = await signInNewWallet();
    expect((await json(await challengeFor(noProfile.cookie, next.address))).error.code).toBe("MerchantProfileRequired");
    const session = await merchant();
    expect((await challengeFor(session.cookie, next.address, "https://evil.example")).status).toBe(403);
    expect((await confirm(undefined, { nonce: "x".repeat(10), signature: "x" })).status).toBe(401);
  });

  it("rejects an invalid, program or current wallet before any challenge exists", async () => {
    const session = await merchant();
    for (const [address, message] of [
      ["not-an-address", /valid Solana address/],
      [TOKEN_PROGRAM_ADDRESS, /not a wallet/],
      [session.wallet.address, /already your payout wallet/],
    ] as const) {
      const response = await challengeFor(session.cookie, address);
      expect(response.status).toBe(400);
      expect((await json(response)).error.fields.payoutWallet).toMatch(message);
    }
    expect(await db.authNonce.count({ where: { purpose: "PAYOUT_CHANGE" } })).toBe(0);
  });

  it("rejects a signature by any other wallet, even the new one", async () => {
    const session = await merchant();
    const next = await createTestWallet();
    const challenge = await json(await challengeFor(session.cookie, next.address));

    const response = await confirm(session.cookie, { nonce: challenge.nonce, signature: await next.sign(challenge.message) });

    expect(response.status).toBe(401);
    expect((await json(response)).error.code).toBe("InvalidSignature");
    expect(await defaultWallet()).toBe(session.wallet.address);
  });

  it("rejects a replayed or expired confirmation", async () => {
    const session = await merchant();
    const next = await createTestWallet();
    const challenge = await json(await challengeFor(session.cookie, next.address));
    const body = { nonce: challenge.nonce, signature: await session.wallet.sign(challenge.message) };
    expect((await confirm(session.cookie, body)).status).toBe(200);
    expect((await json(await confirm(session.cookie, body))).error.code).toBe("ChallengeExpired");

    const other = await createTestWallet();
    const late = await json(await challengeFor(session.cookie, other.address));
    await db.authNonce.update({ where: { nonce: late.nonce }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await confirm(session.cookie, { nonce: late.nonce, signature: await session.wallet.sign(late.message) });
    expect((await json(expired)).error.code).toBe("ChallengeExpired");
    expect(await defaultWallet()).toBe(next.address);
  });

  it("rejects a sign-in challenge as confirmation", async () => {
    const session = await merchant();
    const signIn = await json(await nonce(apiRequest("/api/auth/nonce", { body: { walletAddress: session.wallet.address } })));

    const response = await confirm(session.cookie, { nonce: signIn.nonce, signature: await session.wallet.sign(signIn.message) });

    expect((await json(response)).error.code).toBe("ChallengeExpired");
    expect(await defaultWallet()).toBe(session.wallet.address);
  });

  it("can't use, or use up, another merchant's challenge", async () => {
    const victim = await merchant();
    const attacker = await merchant();
    const target = await createTestWallet();
    const challenge = await json(await challengeFor(victim.cookie, target.address));

    const response = await confirm(attacker.cookie, { nonce: challenge.nonce, signature: await attacker.wallet.sign(challenge.message) });

    expect((await json(response)).error.code).toBe("ChallengeExpired");
    expect((await db.authNonce.findUniqueOrThrow({ where: { nonce: challenge.nonce } })).usedAt).toBeNull();
    expect((await confirm(victim.cookie, { nonce: challenge.nonce, signature: await victim.wallet.sign(challenge.message) })).status).toBe(200);
  });

  it("limits challenges to 10 per minute per merchant", async () => {
    freezeClockMidMinute(); // all requests in one fixed rate-limit window
    const session = await merchant();
    const next = await createTestWallet();
    for (let i = 0; i < 10; i++) expect((await challengeFor(session.cookie, next.address)).status).toBe(200);
    expect((await challengeFor(session.cookie, next.address)).status).toBe(429);
  });
});
