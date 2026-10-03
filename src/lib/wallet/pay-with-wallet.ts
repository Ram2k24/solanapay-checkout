import { getBase58Decoder, type TransactionSendingSigner } from "@solana/kit";
import { isUserRejection } from "./errors";
import { PaymentRequestError, requestPaymentTransaction, type PaymentRequestErrorKind } from "./request-transaction";

// In-browser payment (Phase 8.3): get the server-built transaction for the connected
// account, then let the wallet sign and send it (`solana:signAndSendTransaction`,
// decision D1). The returned signature is for display only: the invoice changes only
// when the server finds and verifies the payment on-chain, which the checkout page's
// status polling then shows.

export type WalletPayFailure = {
  kind: "cancelled" | "wallet-error" | PaymentRequestErrorKind;
  message: string;
  retryAfterSeconds?: number;
};

export async function payWithWallet(
  invoiceId: string,
  signer: Pick<TransactionSendingSigner, "address" | "signAndSendTransactions">,
  options: { onApproving?: () => void; signal?: AbortSignal; request?: typeof requestPaymentTransaction } = {},
): Promise<string> {
  const request = options.request ?? requestPaymentTransaction;
  const transaction = await request(invoiceId, signer.address, { signal: options.signal });
  options.signal?.throwIfAborted(); // left the page before the wallet was asked
  options.onApproving?.();
  const [signature] = await signer.signAndSendTransactions([transaction]);
  if (!signature) throw new Error("wallet returned no signature");
  return getBase58Decoder().decode(signature);
}

// What to tell the customer. A wallet error may come before or after broadcasting (the
// wallet doesn't say), so the message never claims that nothing was sent.
export function describePayFailure(error: unknown): WalletPayFailure {
  if (error instanceof PaymentRequestError) {
    return { kind: error.kind, message: error.message, retryAfterSeconds: error.retryAfterSeconds };
  }
  if (isUserRejection(error)) return { kind: "cancelled", message: "You cancelled the payment in your wallet." };
  return {
    kind: "wallet-error",
    message:
      "Your wallet couldn't complete the payment. Check that you have enough USDC and a little SOL for the fee, then try again. If your wallet shows the payment as sent, wait here instead: this page updates automatically.",
  };
}
