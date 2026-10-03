import { getBase64Encoder, getTransactionDecoder, type Transaction } from "@solana/kit";

// Browser side of the in-browser payment (Phase 8.2): asks OUR server for the unsigned
// payment transaction for the connected account. The server builds it from the stored
// invoice (amount, mint, decimals, recipient, reference) through the same Transaction
// Request endpoint phone wallets use; the browser sends only the account address and
// never edits the transaction. It only checks, before any wallet sees it, that the
// connected account is the only signer (and so the fee payer).

export const REQUEST_TIMEOUT_MS = 10_000;

export type PaymentRequestErrorKind =
  | "self-payment" // the connected wallet is the merchant's payout wallet
  | "not-payable" // expired, paid, or too close to expiry for a new transaction
  | "rate-limited"
  | "unavailable" // server or Solana RPC unreachable, timeout, or unexpected response
  | "invalid"; // the transaction failed the checks below

const SERVER_CODES: Record<string, PaymentRequestErrorKind> = {
  SelfPaymentNotAllowed: "self-payment",
  InvoiceNotPayable: "not-payable",
  NotFound: "not-payable",
  RateLimited: "rate-limited",
};

const MESSAGES: Record<PaymentRequestErrorKind, string> = {
  "self-payment": "This wallet receives the payment, so it can't pay this invoice. Connect a different account.",
  "not-payable": "This invoice can no longer be paid here. Reload the page to see its current status.",
  "rate-limited": "Too many attempts. Please wait a moment and try again.",
  unavailable: "We couldn't prepare the payment. Please try again.",
  invalid: "We couldn't prepare a valid payment for this wallet. Please reload the page and try again.",
};

export class PaymentRequestError extends Error {
  constructor(
    readonly kind: PaymentRequestErrorKind,
    readonly retryAfterSeconds?: number,
    options?: ErrorOptions,
  ) {
    super(MESSAGES[kind], options);
    this.name = "PaymentRequestError";
  }
}

export async function requestPaymentTransaction(
  invoiceId: string,
  account: string,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<Transaction> {
  const doFetch = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(`/api/pay/${encodeURIComponent(invoiceId)}/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account }),
      credentials: "omit", // the endpoint reads no cookies
      cache: "no-store",
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error; // cancelled by the caller: not an error to show
    throw new PaymentRequestError("unavailable", undefined, { cause: error });
  }

  const body = (await response.json().catch(() => null)) as {
    transaction?: unknown;
    error?: { code?: unknown };
  } | null;

  if (!response.ok) {
    const code = typeof body?.error?.code === "string" ? body.error.code : "";
    const kind = SERVER_CODES[code] ?? "unavailable";
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new PaymentRequestError(kind, kind === "rate-limited" && retryAfter > 0 ? retryAfter : undefined);
  }
  if (typeof body?.transaction !== "string") throw new PaymentRequestError("unavailable");
  return decodePaymentTransaction(body.transaction, account);
}

// Decodes the server's base64 wire transaction and checks it is for `account` to sign
// alone: exactly one signature slot, account's, still empty. The decoder lists the
// message's signer accounts in order and the first signer is always the fee payer, so
// this also proves the customer pays the fee.
export function decodePaymentTransaction(base64: string, account: string): Transaction {
  let transaction: Transaction;
  try {
    transaction = getTransactionDecoder().decode(getBase64Encoder().encode(base64));
  } catch (error) {
    throw new PaymentRequestError("invalid", undefined, { cause: error });
  }
  const signers = Object.entries(transaction.signatures);
  const signedOnlyByAccount = signers.length === 1 && signers[0]![0] === account && signers[0]![1] === null;
  if (!signedOnlyByAccount) throw new PaymentRequestError("invalid");
  return transaction;
}
