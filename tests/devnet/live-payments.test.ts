import { beforeAll, describe, expect, it } from "vitest";
import { matchInvoice, readIncomingTransfer, type PaymentTerms } from "@/lib/payments/verify-payment";
import { toChainTransaction, type ChainTransaction, type RpcTransactionJson } from "@/lib/solana/chain-transaction";
import { assertExpectedCluster, getConfirmedTransaction } from "@/lib/solana/server-rpc";

// §19 blockchain tests against the LIVE devnet chain (Phase 14, decision F4): real
// payments made during development, fetched by signature through the app's own RPC
// code (SOLANA_RPC_URL) and checked by its own verification code. Read-only: no keys,
// no transactions, no database. Each payment is also checked against changed invoice
// terms (wrong amount, token, recipient, reference, an expired invoice).
//
// The expected values were read from the development database (payments table) on
// 2026-10-04. If devnet ever prunes these transactions, getTransaction returns null and
// the suite says so: replace them with newer payments.

const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MERCHANT = "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT";
const MERCHANT_USDC_ACCOUNT = "4mCBk3FmruHdVz9Xy15C1KyEzSSimhrmX9dMF3d3XEhu";
const TERMS: PaymentTerms = { recipientWallet: MERCHANT, tokenMint: DEVNET_USDC, tokenDecimals: 6 };

const PAYMENTS = [
  {
    invoice: "INV-2026-00017 (phone, transaction request)",
    signature: "39m866ogKRdHeuqrePGz7TwXrr3u1bcUsc5eaH2QrxtEUnPyDHR9pycmCCEfj1zd65HqzE2sRKCpJnga8emL9YE3",
    reference: "HRPD44J8nG2dM1WTrtKuayYpebkeLiB7h46nbkraFZB2",
    amount: 1_000_000n,
    sender: "BzvXu7r9JJxF8X9Bao4ZCSPNG9Ny91N6EjmPLQTmtD2g",
    expiresAt: new Date("2026-10-01T18:21:33.511Z"),
  },
  {
    invoice: "INV-2026-00023 (browser wallet, 2 USDC)",
    signature: "44aK9dusnvWsi3p7XA1p9ykBMNkenWCdvJaf3cYJnjCSApXwYfESQJHDKh5J2pW2YcLAvz7WUKugiaikcVidvf5e",
    reference: "2x9XPKSVe3DW2bJUAXPY2Ue6PuVLXfgVqzBg5LobLYr7",
    amount: 2_000_000n,
    sender: "BdStSPH3K1uabV1KYFzobL8FH3d2wbiz2irNgNi3vGHi",
    expiresAt: new Date("2026-10-03T10:20:42.572Z"),
  },
  {
    invoice: "INV-2026-00041 (browser wallet, under the CSP)",
    signature: "2ph5pGmFGANpQnkhF1BkcywXXBoj5774P1ZRHGfWCqAvTgRh346cuZMqs7zkBh3UJkAKJYBBzXQgw6PtmCF6Phzx",
    reference: "FAULYBttRD9iFfbKPzizPxzPNPZXvpndWYnu8RTYCoYm",
    amount: 1_000_000n,
    sender: "BdStSPH3K1uabV1KYFzobL8FH3d2wbiz2irNgNi3vGHi",
    expiresAt: new Date("2026-10-04T07:52:17.773Z"),
  },
  {
    invoice: "INV-2026-00043 (browser wallet, app as least-privilege role)",
    signature: "7cBm1YJiC7bHsJGTP7URNAfhyuqe2zqUYBid7AJn5xYNFX5i9Z3txnx3tx6goAHg4cVa1J46MDgu9ZzQNJB8Q4D",
    reference: "C2aiZRgsMfiDKZ5momqzJdhYJrRcAuRcxcxae7DjdNyQ",
    amount: 1_000_000n,
    sender: "BdStSPH3K1uabV1KYFzobL8FH3d2wbiz2irNgNi3vGHi",
    expiresAt: new Date("2026-10-04T15:25:12.130Z"),
  },
];

// Phantom's transfer-link payment that dropped the reference (Phase 7b).
const NO_REFERENCE_PAYMENT = "5txudqhxsvv45UCqodLLmtHih8jFQmQdfL9WyYY65AzmfT5bonfTNRxqUMZTLYMg7prNLMKXzfPNrpWTrRb4EaLX";

// Public devnet sometimes takes seconds to open a connection (see troubleshooting.md);
// a read-only call is simply tried again.
async function withRetry<T>(call: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (error) {
      if (i >= attempts) throw error;
    }
  }
}

async function fetchTransaction(signature: string): Promise<ChainTransaction> {
  const raw = await withRetry(() => getConfirmedTransaction(signature));
  if (!raw) throw new Error(`devnet no longer returns ${signature}; replace it with a newer payment`);
  return toChainTransaction(raw as unknown as RpcTransactionJson);
}

beforeAll(async () => {
  await withRetry(() => assertExpectedCluster()); // SOLANA_RPC_URL really serves devnet
});

describe.each(PAYMENTS)("$invoice", (payment) => {
  let tx: ChainTransaction;
  const invoice = { reference: payment.reference, amount: payment.amount, expiresAt: payment.expiresAt };
  beforeAll(async () => {
    tx = await fetchTransaction(payment.signature);
  });

  it("valid payment: settles its invoice, from the recorded payer, into the merchant's USDC account", async () => {
    const incoming = await readIncomingTransfer(tx, TERMS);
    expect(incoming).toMatchObject({ recipientTokenAccount: MERCHANT_USDC_ACCOUNT, amount: payment.amount, senderWallet: payment.sender });
    expect(incoming!.references).toContain(payment.reference);
    expect(matchInvoice(incoming!, invoice)).toEqual({ kind: "settles", senderWallet: payment.sender, late: false });
  });

  it("wrong amount: doesn't settle an invoice for another amount", async () => {
    const incoming = await readIncomingTransfer(tx, TERMS);
    expect(matchInvoice(incoming!, { ...invoice, amount: payment.amount + 1n })).toEqual({ kind: "amount-mismatch" });
  });

  it("wrong token: isn't a payment in another mint", async () => {
    expect(await readIncomingTransfer(tx, { ...TERMS, tokenMint: MAINNET_USDC })).toBeNull();
  });

  it("wrong recipient: isn't a payment to another wallet", async () => {
    expect(await readIncomingTransfer(tx, { ...TERMS, recipientWallet: payment.sender })).toBeNull();
  });

  it("invalid reference: doesn't settle an invoice with another reference", async () => {
    const incoming = await readIncomingTransfer(tx, TERMS);
    const other = PAYMENTS.find((p) => p.reference !== payment.reference)!.reference;
    expect(matchInvoice(incoming!, { ...invoice, reference: other })).toEqual({ kind: "not-this-invoice" });
  });

  it("expired invoice: a payment that landed after expiry still settles, flagged late", async () => {
    const incoming = await readIncomingTransfer(tx, TERMS);
    const expiredBefore = new Date(incoming!.blockTime!.getTime() - 60_000);
    expect(matchInvoice(incoming!, { ...invoice, expiresAt: expiredBefore })).toEqual({ kind: "settles", senderWallet: payment.sender, late: true });
  });
});

describe("a payment without a reference (Phantom transfer link)", () => {
  it("is seen as money into the merchant's account, but settles no invoice", async () => {
    const incoming = await readIncomingTransfer(await fetchTransaction(NO_REFERENCE_PAYMENT), TERMS);
    expect(incoming).toMatchObject({ recipientTokenAccount: MERCHANT_USDC_ACCOUNT, amount: 1_000_000n, references: [] });
    for (const payment of PAYMENTS) {
      expect(matchInvoice(incoming!, { reference: payment.reference, amount: 1_000_000n, expiresAt: payment.expiresAt })).toEqual({ kind: "not-this-invoice" });
    }
  });
});
