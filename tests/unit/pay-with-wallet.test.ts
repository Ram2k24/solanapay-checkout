import {
  address,
  blockhash,
  getBase58Encoder,
  getTransactionEncoder,
  type ReadonlyUint8Array,
  type Transaction,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { buildPaymentTransaction } from "@/lib/payments/transaction-request";
import { describePayFailure, payWithWallet } from "@/lib/wallet/pay-with-wallet";
import { decodePaymentTransaction, PaymentRequestError } from "@/lib/wallet/request-transaction";

const CUSTOMER = "BzvXu7r9JJxF8X9Bao4ZCSPNG9Ny91N6EjmPLQTmtD2g";
const INVOICE_ID = "01a100e5-5216-72e9-be3f-62bbcc3ee63f";
// A real devnet signature (Phase 9 fixture), as the wallet would return it: 64 bytes.
const SIGNATURE = "5txudqhxsvv45UCqodLLmtHih8jFQmQdfL9WyYY65AzmfT5bonfTNRxqUMZTLYMg7prNLMKXzfPNrpWTrRb4EaLX";

async function serverTransaction(): Promise<Transaction> {
  const base64 = await buildPaymentTransaction(
    {
      network: "DEVNET",
      tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      tokenDecimals: 6,
      amount: 2_000_000n,
      recipientWallet: "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT",
      reference: "3z1ckkRjDxwXmqpAywGHcFw6Jf1wGERdmM9tvpMVecVX",
    },
    CUSTOMER,
    { blockhash: blockhash("GoCkuX6Zpbz5FvXovJu5fZi3tMUjmt8W7T8pWgKBb4Py"), lastValidBlockHeight: 1000n },
  );
  return decodePaymentTransaction(base64, CUSTOMER);
}

function wallet(send: (txs: readonly Transaction[]) => Promise<readonly ReadonlyUint8Array[]>) {
  return { address: address(CUSTOMER), signAndSendTransactions: vi.fn(send) as never };
}

describe("payWithWallet", () => {
  it("asks the server for the connected account, hands that exact transaction to the wallet, returns the signature", async () => {
    const transaction = await serverTransaction();
    const request = vi.fn(async () => transaction);
    const steps: string[] = [];
    const signer = wallet(async (txs) => {
      steps.push("wallet");
      expect(txs).toHaveLength(1);
      expect(getTransactionEncoder().encode(txs[0]!)).toEqual(getTransactionEncoder().encode(transaction));
      return [getBase58Encoder().encode(SIGNATURE)];
    });

    const signature = await payWithWallet(INVOICE_ID, signer, { request, onApproving: () => steps.push("approving") });

    expect(signature).toBe(SIGNATURE);
    expect(request).toHaveBeenCalledWith(INVOICE_ID, CUSTOMER, expect.anything());
    expect(steps).toEqual(["approving", "wallet"]); // the UI says "approve" before the wallet opens
  });

  it("never opens the wallet when the server refuses", async () => {
    const signer = wallet(async () => []);
    const request = vi.fn(async () => {
      throw new PaymentRequestError("self-payment");
    });
    await expect(payWithWallet(INVOICE_ID, signer, { request })).rejects.toMatchObject({ kind: "self-payment" });
    expect(signer.signAndSendTransactions).not.toHaveBeenCalled();
  });

  it("never opens the wallet after the customer has left the page", async () => {
    const transaction = await serverTransaction();
    const controller = new AbortController();
    const signer = wallet(async () => []);
    const request = vi.fn(async () => {
      controller.abort();
      return transaction;
    });
    await expect(payWithWallet(INVOICE_ID, signer, { request, signal: controller.signal })).rejects.toThrow();
    expect(signer.signAndSendTransactions).not.toHaveBeenCalled();
  });

  it("fails if the wallet returns no signature", async () => {
    const transaction = await serverTransaction();
    await expect(payWithWallet(INVOICE_ID, wallet(async () => []), { request: async () => transaction })).rejects.toThrow();
  });
});

describe("describePayFailure", () => {
  it("tells a wallet rejection apart from a failure", () => {
    expect(describePayFailure({ code: 4001, message: "User rejected the request." })).toMatchObject({ kind: "cancelled" });
    expect(describePayFailure(new Error("Transaction simulation failed: insufficient funds"))).toMatchObject({ kind: "wallet-error" });
  });

  it("never claims nothing was sent after a wallet error, and never echoes wallet internals", () => {
    const { message } = describePayFailure(new Error("internal detail 0xdeadbeef"));
    expect(message).toMatch(/If your wallet shows the payment as sent, wait here/);
    expect(message).not.toContain("0xdeadbeef");
  });

  it("passes server-side refusals through with their own message and Retry-After", () => {
    expect(describePayFailure(new PaymentRequestError("rate-limited", 7))).toMatchObject({ kind: "rate-limited", retryAfterSeconds: 7 });
    expect(describePayFailure(new PaymentRequestError("not-payable")).message).toMatch(/can no longer be paid/);
  });
});
