import { db } from "@/lib/db/client";

// Fixtures for dashboard and transaction-history tests: merchants, invoices and verified
// payments written straight to the database. Two merchants can share PAYOUT (seen on
// devnet in Phase 8.5), so queries must be scoped by the invoice's merchant.
export const PAYOUT = "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT";
export const PAYER = "BdStSPH3K1uabV1KYFzobL8FH3d2wbiz2irNgNi3vGHi";
export const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));
export const HOUR = 60 * 60_000;

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let seq = 0;
const next = () => ++seq;
// Unique and valid base58 (no 0, O, I, l), like a real signature or address.
const base58 = (n: number) => {
  let out = "";
  for (let v = n; v > 0; v = Math.floor(v / 58)) out = BASE58[v % 58] + out;
  return out.padStart(6, "1");
};

export async function merchant(owner: string) {
  const user = await db.user.create({ data: { walletAddress: owner } });
  const m = await db.merchant.create({ data: { ownerUserId: user.id, name: `Store ${owner.slice(0, 4)}` } });
  await db.wallet.create({ data: { merchantId: m.id, address: PAYOUT, isDefault: true } });
  return m;
}

export type FixtureStatus = "PENDING" | "CONFIRMING" | "PAID" | "EXPIRED";

export async function invoice(merchantId: string, status: FixtureStatus, opts: { expiresInMs?: number; amount?: bigint; orderId?: string } = {}) {
  const n = next();
  return db.invoice.create({
    data: {
      merchantId, invoiceNumber: `INV-2026-${String(n).padStart(5, "0")}`, orderId: opts.orderId ?? null, network: "DEVNET",
      currency: "USDC", amount: opts.amount ?? USDC(1), tokenMint: MINT, tokenDecimals: 6, recipientWallet: PAYOUT,
      reference: `Ref${base58(n)}`.padEnd(44, "x"), status, paidAt: status === "PAID" ? new Date() : null,
      expiresAt: new Date(Date.now() + (opts.expiresInMs ?? HOUR)),
    },
  });
}

export async function payment(inv: { id: string; reference: string }, amount: bigint, commitment: "CONFIRMED" | "FINALIZED", late = false) {
  return db.payment.create({
    data: {
      invoiceId: inv.id, signature: `Sig${base58(next())}`.padEnd(87, "x"), network: "DEVNET", reference: inv.reference,
      senderWallet: PAYER, recipientWallet: PAYOUT, recipientTokenAccount: "4mCBk3FmruHdVz9Xy15C1KyEzSSimhrmX9dMF3d3XEhu",
      tokenMint: MINT, amount, slot: 1n, blockTime: new Date(), commitment, late,
      verifiedAt: new Date(), finalizedAt: commitment === "FINALIZED" ? new Date() : null,
    },
  });
}

// Fresh unique strings for other fixtures (e.g. unmatched-entry signatures).
export const uniqueSignature = (prefix = "Sig") => `${prefix}${base58(next())}`.padEnd(87, "x");

// UUIDv7 ids order by millisecond: space out inserts whose order a test checks.
export const tick = () => new Promise((resolve) => setTimeout(resolve, 3));
