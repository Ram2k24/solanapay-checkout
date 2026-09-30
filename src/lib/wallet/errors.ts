// Turns wallet errors into messages safe to show. Wallets report a user
// rejection differently (Wallet Standard error code, EIP-1193-style code 4001,
// or only a message), so several signals are checked.
export function isUserRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; context?: { __code?: unknown } };
  if (e.code === 4001) return true;
  if (e.context?.__code === "WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED") return true;
  return typeof e.message === "string" && /reject|denied|declin|cancel/i.test(e.message);
}

export function describeWalletError(error: unknown): string {
  if (isUserRejection(error)) return "You cancelled the request in your wallet.";
  return "Your wallet reported an error. Please try again.";
}
