import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { cleanupExpired, RETENTION_MS } from "@/lib/maintenance/cleanup";
import { resetDatabase } from "../support/db";
import { invoice, merchant, PAYER, payment, uniqueSignature, USDC } from "../support/payments";

// Phase 13.2: expired-row cleanup (decisions D1-D2). Times are relative to a pinned NOW.
beforeEach(resetDatabase);

const NOW = new Date("2026-10-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
let n = 0;

const nonce = (expiresAt: Date) =>
  db.authNonce.create({ data: { nonce: `Nonce${++n}`.padEnd(12, "x"), walletAddress: PAYER, message: "m", expiresAt } });
const session = async (fields: { expiresAt: Date; revokedAt?: Date }) => {
  const user = await db.user.upsert({ where: { walletAddress: PAYER }, create: { walletAddress: PAYER }, update: {} });
  return db.session.create({ data: { userId: user.id, tokenHash: String(++n).padStart(64, "0"), ...fields } });
};
const window = (windowStart: Date) => db.rateLimit.create({ data: { key: `test:${++n}`, windowStart, count: 1 } });

describe("cleanupExpired", () => {
  it("deletes only rows past their retention, in every table it owns", async () => {
    await nonce(ago(RETENTION_MS.nonceAfterExpiry + HOUR));
    const recentNonce = await nonce(ago(HOUR)); // expired, but within a day
    const liveNonce = await nonce(new Date(NOW.getTime() + 5 * 60_000));

    await session({ expiresAt: ago(8 * DAY) });
    await session({ expiresAt: new Date(NOW.getTime() + HOUR), revokedAt: ago(8 * DAY) });
    const recentlyRevoked = await session({ expiresAt: new Date(NOW.getTime() + HOUR), revokedAt: ago(DAY) });
    const recentlyExpired = await session({ expiresAt: ago(6 * DAY) });
    const live = await session({ expiresAt: new Date(NOW.getTime() + 8 * HOUR) });

    await window(ago(2 * HOUR));
    const recentWindow = await window(ago(30 * 60_000));
    const currentWindow = await window(NOW);

    expect(await cleanupExpired({ now: NOW })).toEqual({ nonces: 1, sessions: 2, rateLimits: 1 });

    expect((await db.authNonce.findMany()).map((r) => r.id).sort()).toEqual([recentNonce.id, liveNonce.id].sort());
    expect((await db.session.findMany()).map((r) => r.id).sort()).toEqual([recentlyRevoked.id, recentlyExpired.id, live.id].sort());
    expect((await db.rateLimit.findMany()).map((r) => r.key).sort()).toEqual([recentWindow.key, currentWindow.key].sort());
  });

  it("never touches invoices, payments, unmatched entries, wallets or the audit log, however old", async () => {
    const m = await merchant(PAYER);
    const inv = await invoice(m.id, "PAID", { expiresInMs: -365 * DAY });
    await payment(inv, USDC(1), "FINALIZED");
    await db.unmatchedPayment.create({
      data: {
        merchantId: m.id, reason: "NO_REFERENCE", signature: uniqueSignature(), network: "DEVNET", recipientWallet: PAYER,
        recipientTokenAccount: "4mCBk3FmruHdVz9Xy15C1KyEzSSimhrmX9dMF3d3XEhu", tokenMint: inv.tokenMint, amount: USDC(1), slot: 1n,
        commitment: "FINALIZED",
      },
    });
    await db.auditLog.create({ data: { actorType: "SYSTEM", actorId: "test", action: "test", entityType: "invoice", entityId: inv.id } });
    const counts = () =>
      Promise.all([db.invoice.count(), db.payment.count(), db.unmatchedPayment.count(), db.wallet.count(), db.auditLog.count(), db.merchant.count()]);
    const before = await counts();

    await cleanupExpired({ now: new Date(NOW.getTime() + 10 * 365 * DAY) }); // ten years later

    expect(await counts()).toEqual(before);
  });

  it("deletes in batches and stops after the per-run limit; the next run continues", async () => {
    for (let i = 0; i < 7; i++) await window(ago(2 * HOUR));

    expect((await cleanupExpired({ now: NOW, batch: 2, maxBatches: 2 })).rateLimits).toBe(4);
    expect(await db.rateLimit.count()).toBe(3);
    expect((await cleanupExpired({ now: NOW, batch: 2, maxBatches: 2 })).rateLimits).toBe(3);
    expect(await db.rateLimit.count()).toBe(0);
  });

  it("is a no-op when there's nothing to delete", async () => {
    expect(await cleanupExpired({ now: NOW })).toEqual({ nonces: 0, sessions: 0, rateLimits: 0 });
  });
});
