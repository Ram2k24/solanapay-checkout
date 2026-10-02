import { describe, expect, it } from "vitest";
import {
  toChainTransaction,
  type ChainTransaction,
  type RpcTransactionJson,
} from "@/lib/solana/chain-transaction";
import { matchInvoice, readIncomingTransfer, type PaymentTerms } from "@/lib/payments/verify-payment";
import noReference from "../fixtures/solana/no-reference.json";
import referencePayment from "../fixtures/solana/reference-payment.json";
import unknownReference from "../fixtures/solana/unknown-reference.json";

// Real devnet transactions (public chain data, captured with getTransaction, "json"
// encoding), all paying 1 USDC to the merchant wallet 4dqH…QhZT:
//   reference-payment  39m866og…: Phase 7b transaction request for INV-2026-00017
//   unknown-reference  5YcPT4Vs…: Phase 7b spike (reference not used by any invoice)
//   no-reference       5txudqhx…: Phantom's transfer-link payment that dropped the reference
const MERCHANT = "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT";
const MERCHANT_USDC_ACCOUNT = "4mCBk3FmruHdVz9Xy15C1KyEzSSimhrmX9dMF3d3XEhu";
const CUSTOMER = "BzvXu7r9JJxF8X9Bao4ZCSPNG9Ny91N6EjmPLQTmtD2g";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const INV_17 = {
  reference: "HRPD44J8nG2dM1WTrtKuayYpebkeLiB7h46nbkraFZB2",
  amount: 1_000_000n,
  expiresAt: new Date("2026-10-01T18:21:33.511Z"), // stored expiry of INV-2026-00017
};
const TERMS: PaymentTerms = { recipientWallet: MERCHANT, tokenMint: DEVNET_USDC, tokenDecimals: 6 };

const fixture = (f: { result: unknown }) => toChainTransaction(f.result as RpcTransactionJson);
const payment = () => fixture(referencePayment);
const transferIx = (tx: ChainTransaction) => tx.instructions.at(-1)!;

function setAmount(data: Uint8Array, amount: bigint) {
  new DataView(data.buffer, data.byteOffset).setBigUint64(1, amount, true);
}

describe("toChainTransaction", () => {
  it("resolves account roles and balances of a version 0 transaction", () => {
    const tx = payment();
    expect(tx).toMatchObject({
      signature: referencePayment.signature,
      slot: 506350774n,
      blockTime: new Date("2026-10-01T17:34:34.000Z"),
      succeeded: true,
    });
    const accounts = transferIx(tx).accounts;
    expect(accounts.find((a) => a.address === CUSTOMER)).toEqual({ address: CUSTOMER, signer: true, writable: true });
    expect(accounts.find((a) => a.address === INV_17.reference)).toEqual({
      address: INV_17.reference, signer: false, writable: false,
    });
    expect(tx.postTokenBalances.find((b) => b.address === MERCHANT_USDC_ACCOUNT)?.amount).toBe(13_000_000n);
  });

  it("gives the same result for Kit's bigint values as for raw JSON numbers", () => {
    const toBigInts = (value: unknown): unknown =>
      typeof value === "number" ? BigInt(value)
        : Array.isArray(value) ? value.map(toBigInts)
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toBigInts(v)]))
        : value;
    expect(toChainTransaction(toBigInts(referencePayment.result) as RpcTransactionJson)).toEqual(payment());
  });

  it("treats addresses loaded from lookup tables as non-signers with their table's access", () => {
    const raw = structuredClone(referencePayment.result) as RpcTransactionJson & { meta: { loadedAddresses: unknown } };
    (raw.meta as { loadedAddresses: unknown }).loadedAddresses = { writable: ["LoadedWritable1"], readonly: ["LoadedReadonly1"] };
    (raw.transaction.message.instructions[1]!.accounts as number[]).push(9, 10);
    const accounts = transferIx(toChainTransaction(raw)).accounts.slice(-2);
    expect(accounts).toEqual([
      { address: "LoadedWritable1", signer: false, writable: true },
      { address: "LoadedReadonly1", signer: false, writable: false },
    ]);
  });

  it("rejects an account index outside the transaction", () => {
    const raw = structuredClone(referencePayment.result) as RpcTransactionJson;
    (raw.transaction.message.instructions[1]!.accounts as number[]).push(99);
    expect(() => toChainTransaction(raw)).toThrow(/out of range/);
  });
});

describe("verifying the real devnet payments", () => {
  it("settles INV-2026-00017 with its own payment", async () => {
    const incoming = await readIncomingTransfer(payment(), TERMS);
    expect(incoming).toMatchObject({
      recipientTokenAccount: MERCHANT_USDC_ACCOUNT,
      amount: 1_000_000n,
      senderWallet: CUSTOMER,
      references: [INV_17.reference],
    });
    expect(matchInvoice(incoming!, INV_17)).toEqual({ kind: "settles", senderWallet: CUSTOMER, late: false });
  });

  it("flags a payment that landed after the invoice expired as late", async () => {
    const incoming = await readIncomingTransfer(payment(), TERMS);
    const expiredEarlier = { ...INV_17, expiresAt: new Date("2026-10-01T17:30:00.000Z") };
    expect(matchInvoice(incoming!, expiredEarlier)).toEqual({ kind: "settles", senderWallet: CUSTOMER, late: true });
  });

  it("doesn't settle an invoice with another invoice's payment", async () => {
    const incoming = await readIncomingTransfer(fixture(unknownReference), TERMS);
    expect(incoming?.references).toEqual(["3z1ckkRjDxwXmqpAywGHcFw6Jf1wGERdmM9tvpMVecVX"]);
    expect(matchInvoice(incoming!, INV_17)).toEqual({ kind: "not-this-invoice" });
  });

  it("sees Phantom's transfer-link payment as incoming money without a reference", async () => {
    const incoming = await readIncomingTransfer(fixture(noReference), TERMS);
    // Phantom appends the payer (a signer) after the authority; that's not a reference.
    expect(transferIx(fixture(noReference)).accounts.at(-1)).toMatchObject({ address: CUSTOMER, signer: true });
    expect(incoming).toMatchObject({ amount: 1_000_000n, senderWallet: CUSTOMER, references: [] });
    expect(matchInvoice(incoming!, INV_17)).toEqual({ kind: "not-this-invoice" });
  });
});

describe("transactions that don't pay the merchant are irrelevant", () => {
  it.each<[string, Partial<PaymentTerms>]>([
    ["a different recipient wallet", { recipientWallet: CUSTOMER }],
    ["a different mint", { tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }],
  ])("expecting %s", async (_, override) => {
    expect(await readIncomingTransfer(payment(), { ...TERMS, ...override })).toBeNull();
  });

  it("a failed transaction", async () => {
    expect(await readIncomingTransfer({ ...payment(), succeeded: false }, TERMS)).toBeNull();
  });

  it("Token-2022 balances (USDC is a classic Token program mint)", async () => {
    const tx = payment();
    for (const b of [...tx.preTokenBalances, ...tx.postTokenBalances]) b.programAddress = TOKEN_2022;
    transferIx(tx).programAddress = TOKEN_2022;
    expect(await readIncomingTransfer(tx, TERMS)).toBeNull();
  });

  it("a transfer to an auxiliary token account (not the merchant's ATA)", async () => {
    const tx = payment();
    for (const b of [...tx.preTokenBalances, ...tx.postTokenBalances]) {
      if (b.address === MERCHANT_USDC_ACCOUNT) b.address = "AuxiliaryTokenAccount1111111111111111111111";
    }
    expect(await readIncomingTransfer(tx, TERMS)).toBeNull();
  });
});

describe("money that arrived but doesn't settle the invoice", () => {
  const verify = async (tx: ChainTransaction, invoice = INV_17) => {
    const incoming = await readIncomingTransfer(tx, TERMS);
    expect(incoming).not.toBeNull(); // real money arrived: it must be recorded, not dropped
    return matchInvoice(incoming!, invoice);
  };

  it("the invoice is for a different amount", async () => {
    expect(await verify(payment(), { ...INV_17, amount: 2_000_000n })).toEqual({ kind: "amount-mismatch" });
  });

  it("the transfer instruction's amount differs from the stored amount", async () => {
    const tx = payment();
    setAmount(transferIx(tx).data, 999_999n);
    expect(await verify(tx)).toEqual({ kind: "amount-mismatch" });
  });

  it("the net credit differs from the transfer (balances disagree)", async () => {
    const tx = payment();
    tx.postTokenBalances.find((b) => b.address === MERCHANT_USDC_ACCOUNT)!.amount += 1n;
    expect(await verify(tx)).toEqual({ kind: "amount-mismatch" });
  });

  it("the reference is on two transfers (ambiguous)", async () => {
    const tx = payment();
    tx.instructions.push(structuredClone(transferIx(tx)));
    expect(await verify(tx)).toEqual({ kind: "amount-mismatch" });
  });

  it.each<[string, { signer?: boolean; writable?: boolean }]>([
    ["signs", { signer: true }],
    ["is writable", { writable: true }],
  ])("the reference account %s (a reference must be read-only and non-signing)", async (_, role) => {
    const tx = payment();
    Object.assign(transferIx(tx).accounts.find((a) => a.address === INV_17.reference)!, role);
    expect(await verify(tx)).toEqual({ kind: "not-this-invoice" });
  });

  it("the reference is on another instruction, not the transfer", async () => {
    const tx = payment();
    const transfer = transferIx(tx);
    transfer.accounts = transfer.accounts.filter((a) => a.address !== INV_17.reference);
    tx.instructions[0]!.accounts.push({ address: INV_17.reference, signer: false, writable: false });
    expect(await verify(tx)).toEqual({ kind: "not-this-invoice" });
  });

  it("TransferChecked with the wrong decimals", async () => {
    const tx = payment();
    transferIx(tx).data[9] = 9;
    expect(await verify(tx)).toEqual({ kind: "not-this-invoice" });
  });
});

describe("accepted transfer instructions", () => {
  it("plain Transfer (no mint account) settles too", async () => {
    const tx = payment();
    const ix = transferIx(tx);
    // TransferChecked [source, mint, destination, authority, ref] -> Transfer [source, destination, authority, ref]
    ix.accounts.splice(1, 1);
    ix.data = Uint8Array.of(3, ...ix.data.slice(1, 9));
    const incoming = await readIncomingTransfer(tx, TERMS);
    expect(matchInvoice(incoming!, INV_17)).toEqual({ kind: "settles", senderWallet: CUSTOMER, late: false });
  });
});
