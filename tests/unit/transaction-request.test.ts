import {
  blockhash,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getU64Decoder,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  buildPaymentTransaction,
  TransactionRequestError,
  type StoredInvoiceTerms,
} from "@/lib/payments/transaction-request";

// Real devnet addresses from the Phase 7b phone test (transaction 5YcPT4Vs…), so the
// expected token accounts are ground truth from the chain, not re-derived by the code under test.
const MERCHANT = "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT";
const MERCHANT_USDC_ACCOUNT = "4mCBk3FmruHdVz9Xy15C1KyEzSSimhrmX9dMF3d3XEhu";
const CUSTOMER = "BzvXu7r9JJxF8X9Bao4ZCSPNG9Ny91N6EjmPLQTmtD2g";
const CUSTOMER_USDC_ACCOUNT = "8vYa2LcqzGHcW9rgjP1a6Zz7TXqKT8SqRdnRrbZvy7X";
const REFERENCE = "3z1ckkRjDxwXmqpAywGHcFw6Jf1wGERdmM9tvpMVecVX";
const DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const BLOCKHASH = { blockhash: blockhash("GoCkuX6Zpbz5FvXovJu5fZi3tMUjmt8W7T8pWgKBb4Py"), lastValidBlockHeight: 1000n };

const INVOICE: StoredInvoiceTerms = {
  network: "DEVNET",
  tokenMint: DEVNET_USDC,
  tokenDecimals: 6,
  amount: 1_000_000n, // 1 USDC
  recipientWallet: MERCHANT,
  reference: REFERENCE,
};

// Decodes the wire transaction the way a wallet would, resolving account indexes to
// addresses and roles (from the message header) so tests read like the transaction.
function decode(base64: string) {
  const bytes = getBase64Encoder().encode(base64);
  const tx = getTransactionDecoder().decode(bytes);
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  // Kit 8 also knows the newer v1 message format, which has a different layout; we build v0.
  if (message.version === 1) throw new Error("unexpected v1 message");
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = message.header;
  const keys: string[] = [...message.staticAccounts];
  const account = (index: number) => ({
    address: keys[index],
    signer: index < numSignerAccounts,
    writable:
      index < numSignerAccounts
        ? index < numSignerAccounts - numReadonlySignerAccounts
        : index < keys.length - numReadonlyNonSignerAccounts,
  });
  const instructions = message.instructions.map((ix) => ({
    program: keys[ix.programAddressIndex],
    accounts: (ix.accountIndices ?? []).map(account),
    data: ix.data ?? new Uint8Array(),
  }));
  return { size: bytes.length, tx, message, keys, account, instructions };
}

describe("buildPaymentTransaction", () => {
  it("builds the expected unsigned USDC payment", async () => {
    const { size, tx, message, keys, instructions } = decode(await buildPaymentTransaction(INVOICE, CUSTOMER, BLOCKHASH));

    expect(message.version).toBe(0);
    expect(size).toBeLessThanOrEqual(1232); // Solana's maximum transaction size
    expect(message.lifetimeToken).toBe(BLOCKHASH.blockhash);
    expect(keys[0]).toBe(CUSTOMER); // fee payer
    expect(instructions.map((ix) => ix.program)).toEqual([ATA_PROGRAM, TOKEN_PROGRAM]);

    // 1. Create the merchant's USDC account if missing (CreateIdempotent = 1), paid by the customer.
    const [create, transfer] = instructions;
    expect(create!.data).toEqual(new Uint8Array([1]));
    expect(create!.accounts.map((a) => a.address)).toEqual([
      CUSTOMER, MERCHANT_USDC_ACCOUNT, MERCHANT, DEVNET_USDC, SYSTEM_PROGRAM, TOKEN_PROGRAM,
    ]);

    // 2. TransferChecked (12): u64 amount + u8 decimals, then the reference as the last account.
    expect(transfer!.data[0]).toBe(12);
    expect(getU64Decoder().decode(transfer!.data.slice(1, 9))).toBe(1_000_000n);
    expect(transfer!.data[9]).toBe(6);
    expect(transfer!.accounts.map((a) => a.address)).toEqual([
      CUSTOMER_USDC_ACCOUNT, DEVNET_USDC, MERCHANT_USDC_ACCOUNT, CUSTOMER, REFERENCE,
    ]);

    // Only the customer must sign, and the server leaves that signature empty.
    expect(Object.keys(tx.signatures)).toEqual([CUSTOMER]);
    expect(tx.signatures[CUSTOMER as keyof typeof tx.signatures]).toBeNull();
  });

  it("marks the reference read-only and non-signing, and the customer as the only signer", async () => {
    const { message, account, keys } = decode(await buildPaymentTransaction(INVOICE, CUSTOMER, BLOCKHASH));
    expect(message.header.numSignerAccounts).toBe(1);
    expect(account(keys.indexOf(CUSTOMER))).toMatchObject({ signer: true, writable: true });
    expect(account(keys.indexOf(REFERENCE))).toMatchObject({ signer: false, writable: false });
    expect(account(keys.indexOf(MERCHANT))).toMatchObject({ signer: false, writable: false });
    expect(account(keys.indexOf(MERCHANT_USDC_ACCOUNT))).toMatchObject({ signer: false, writable: true });
  });

  it("takes the amount from the stored invoice", async () => {
    const { instructions } = decode(
      await buildPaymentTransaction({ ...INVOICE, amount: 123_456_789n }, CUSTOMER, BLOCKHASH),
    );
    expect(getU64Decoder().decode(instructions[1]!.data.slice(1, 9))).toBe(123_456_789n);
  });

  it("is deterministic for the same inputs", async () => {
    const a = await buildPaymentTransaction(INVOICE, CUSTOMER, BLOCKHASH);
    const b = await buildPaymentTransaction(INVOICE, CUSTOMER, BLOCKHASH);
    expect(a).toBe(b);
  });

  it.each([
    ["not an address", "not-a-wallet"],
    ["empty", ""],
    ["an off-curve address (a token account, which cannot sign)", MERCHANT_USDC_ACCOUNT],
  ])("rejects a customer account that is %s", async (_, account) => {
    await expect(buildPaymentTransaction(INVOICE, account, BLOCKHASH)).rejects.toThrow(
      new TransactionRequestError("InvalidCustomerAccount"),
    );
  });

  it("rejects the merchant paying their own invoice", async () => {
    await expect(buildPaymentTransaction(INVOICE, MERCHANT, BLOCKHASH)).rejects.toThrow(
      new TransactionRequestError("CustomerIsRecipient"),
    );
  });

  it.each<[string, Partial<StoredInvoiceTerms>]>([
    ["a mint that is not Circle's devnet USDC", { tokenMint: MAINNET_USDC }],
    ["a network that is not enabled", { network: "MAINNET", tokenMint: MAINNET_USDC }],
    ["the testnet network", { network: "TESTNET" }],
    ["decimals other than USDC's", { tokenDecimals: 9 }],
    ["a zero amount", { amount: 0n }],
    ["a malformed recipient", { recipientWallet: "not-a-wallet" }],
    ["a malformed reference", { reference: "not-a-reference" }],
  ])("refuses invoice terms with %s", async (_, override) => {
    await expect(buildPaymentTransaction({ ...INVOICE, ...override }, CUSTOMER, BLOCKHASH)).rejects.toThrow(
      new TransactionRequestError("UnsupportedInvoiceTerms"),
    );
  });
});
