// Can the connected wallet pay an invoice from the browser (Phase 8)? Pure, so it is
// unit-tested without a wallet. It only decides what the checkout page offers; the
// transaction itself is built by the server from the stored invoice, and the invoice
// is marked paid only by on-chain verification.
//
// The browser path uses the wallet's `solana:signAndSendTransaction` (decision D1,
// 2026-10-03): the wallet signs and broadcasts. Our transactions are version 0.

export type PayReadiness = "ready" | "wrong-network" | "read-only" | "no-send" | "no-v0";

// The parts of the wallet plugin's `connected` state this check reads.
export type ConnectedWalletLike = {
  account: { chains: readonly string[] };
  signer: object | null;
  supportedTransactionVersions: ReadonlySet<string | number>;
};

export function payReadiness(connected: ConnectedWalletLike, chain: string): PayReadiness {
  // First: an account on another network also has no signer for ours, and switching
  // network is the fix the customer can actually make.
  if (!connected.account.chains.includes(chain)) return "wrong-network";
  if (connected.signer === null) return "read-only";
  if (!("signAndSendTransactions" in connected.signer)) return "no-send";
  // The plugin reports the versions every signing feature accepts (an intersection),
  // so this is conservative: a wallet is never offered a version it can't handle.
  if (!connected.supportedTransactionVersions.has(0)) return "no-v0";
  return "ready";
}

// Safe to show to customers. `network` is e.g. "devnet".
export function describePayReadiness(readiness: Exclude<PayReadiness, "ready">, network: string): string {
  switch (readiness) {
    case "wrong-network":
      return `This wallet account isn't set to Solana ${network}. Switch your wallet to ${network} and reconnect.`;
    case "read-only":
      return "This wallet account can't sign transactions. Connect another account or use the QR code.";
    case "no-send":
    case "no-v0":
      return "This wallet can't pay from the browser. Use the QR code or payment link instead.";
  }
}
