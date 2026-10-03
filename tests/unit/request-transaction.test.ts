import { blockhash, getBase64Decoder, getBase64Encoder, getTransactionDecoder, getTransactionEncoder } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { buildPaymentTransaction, type StoredInvoiceTerms } from "@/lib/payments/transaction-request";
import {
  decodePaymentTransaction,
  PaymentRequestError,
  requestPaymentTransaction,
} from "@/lib/wallet/request-transaction";

// Real devnet addresses (Phase 7b); the transaction comes from the real server builder.
const MERCHANT = "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT";
const CUSTOMER = "BzvXu7r9JJxF8X9Bao4ZCSPNG9Ny91N6EjmPLQTmtD2g";
const OTHER_CUSTOMER = "BdStSPH3K1uabV1KYFzobL8FH3d2wbiz2irNgNi3vGHi";
const INVOICE_ID = "01a100e5-5216-72e9-be3f-62bbcc3ee63f";
const INVOICE: StoredInvoiceTerms = {
  network: "DEVNET",
  tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  tokenDecimals: 6,
  amount: 2_000_000n,
  recipientWallet: MERCHANT,
  reference: "3z1ckkRjDxwXmqpAywGHcFw6Jf1wGERdmM9tvpMVecVX",
};
const BLOCKHASH = { blockhash: blockhash("GoCkuX6Zpbz5FvXovJu5fZi3tMUjmt8W7T8pWgKBb4Py"), lastValidBlockHeight: 1000n };

const built = (account = CUSTOMER) => buildPaymentTransaction(INVOICE, account, BLOCKHASH);

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
const serverError = (status: number, code: string, headers?: Record<string, string>) =>
  json(status, { error: { code, message: "server text" } }, headers);

async function caught(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("decodePaymentTransaction", () => {
  it("returns the server's transaction unchanged, unsigned, for the connected account", async () => {
    const base64 = await built();
    const tx = decodePaymentTransaction(base64, CUSTOMER);
    expect(tx.signatures).toEqual({ [CUSTOMER]: null });
    // Byte-for-byte what the server sent: the browser never edits it.
    expect(getBase64Decoder().decode(getTransactionEncoder().encode(tx))).toBe(base64);
  });

  it("rejects a transaction whose fee payer is another account", async () => {
    const base64 = await built(OTHER_CUSTOMER);
    const error = await caught(Promise.resolve().then(() => decodePaymentTransaction(base64, CUSTOMER)));
    expect(error).toBeInstanceOf(PaymentRequestError);
    expect(error).toMatchObject({ kind: "invalid" });
  });

  it("rejects a transaction that already carries a signature", async () => {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(await built()));
    const signed = getBase64Decoder().decode(
      getTransactionEncoder().encode({ ...tx, signatures: { ...tx.signatures, [CUSTOMER]: new Uint8Array(64).fill(7) } } as never),
    );
    expect(() => decodePaymentTransaction(signed, CUSTOMER)).toThrow(PaymentRequestError);
  });

  it("rejects bytes that aren't a transaction", () => {
    expect(() => decodePaymentTransaction("bm90IGEgdHJhbnNhY3Rpb24=", CUSTOMER)).toThrow(PaymentRequestError);
  });
});

describe("requestPaymentTransaction", () => {
  it("sends only the account, without cookies, and returns the checked transaction", async () => {
    const transaction = await built();
    const fetch = vi.fn(async () => json(200, { transaction, message: "Laptop Store" }));

    const tx = await requestPaymentTransaction(INVOICE_ID, CUSTOMER, { fetch });

    expect(tx.signatures).toEqual({ [CUSTOMER]: null });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/pay/${INVOICE_ID}/transaction`);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store" });
    expect(JSON.parse(init.body as string)).toEqual({ account: CUSTOMER });
  });

  it.each([
    [400, "SelfPaymentNotAllowed", "self-payment"],
    [409, "InvoiceNotPayable", "not-payable"],
    [404, "NotFound", "not-payable"],
    [503, "RpcUnavailable", "unavailable"],
    [500, "InternalError", "unavailable"],
    [400, "InvalidAccount", "unavailable"],
  ])("maps HTTP %i %s to %s", async (status, code, kind) => {
    const error = await caught(requestPaymentTransaction(INVOICE_ID, CUSTOMER, { fetch: async () => serverError(status, code) }));
    expect(error).toMatchObject({ kind });
  });

  it("shows our own message, never the server's text", async () => {
    const error = (await caught(
      requestPaymentTransaction(INVOICE_ID, CUSTOMER, { fetch: async () => serverError(400, "SelfPaymentNotAllowed") }),
    )) as Error;
    expect(error.message).toMatch(/receives the payment/);
    expect(error.message).not.toContain("server text");
  });

  it("passes on the server's Retry-After for rate limits", async () => {
    const error = await caught(
      requestPaymentTransaction(INVOICE_ID, CUSTOMER, { fetch: async () => serverError(429, "RateLimited", { "retry-after": "7" }) }),
    );
    expect(error).toMatchObject({ kind: "rate-limited", retryAfterSeconds: 7 });
  });

  it("treats a non-JSON error page as unavailable", async () => {
    const error = await caught(
      requestPaymentTransaction(INVOICE_ID, CUSTOMER, { fetch: async () => new Response("<html>Bad gateway</html>", { status: 502 }) }),
    );
    expect(error).toMatchObject({ kind: "unavailable" });
  });

  it("treats a success without a transaction as unavailable", async () => {
    const error = await caught(requestPaymentTransaction(INVOICE_ID, CUSTOMER, { fetch: async () => json(200, { message: "x" }) }));
    expect(error).toMatchObject({ kind: "unavailable" });
  });

  it("checks the returned transaction: another account's is refused", async () => {
    const transaction = await built(OTHER_CUSTOMER);
    const error = await caught(requestPaymentTransaction(INVOICE_ID, CUSTOMER, { fetch: async () => json(200, { transaction }) }));
    expect(error).toMatchObject({ kind: "invalid" });
  });

  it("turns a network failure into unavailable", async () => {
    const error = await caught(
      requestPaymentTransaction(INVOICE_ID, CUSTOMER, { fetch: async () => Promise.reject(new TypeError("fetch failed")) }),
    );
    expect(error).toMatchObject({ kind: "unavailable" });
  });

  it("rethrows a cancellation by the caller as-is (nothing to show)", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    const pending = requestPaymentTransaction(INVOICE_ID, CUSTOMER, { fetch: fetch as never, signal: controller.signal });
    controller.abort();
    const error = await caught(pending);
    expect(error).not.toBeInstanceOf(PaymentRequestError);
    expect((error as Error).name).toBe("AbortError");
  });
});
