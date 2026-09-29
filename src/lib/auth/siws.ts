import { getBase58Decoder } from "@solana/kit";

// Sign-In With Solana (SIWS) message, following the format in
// https://github.com/phantom/sign-in-with-solana. The server builds the full text;
// the wallet signs it verbatim, so the server never parses client-supplied messages.

export const SIGN_IN_STATEMENT =
  "Sign in to SolanaPay Checkout. This request will not trigger a blockchain transaction or cost any fee.";

export type SignInMessageFields = {
  domain: string; // host[:port] of the app, e.g. "localhost:3000"
  address: string; // wallet address signing in
  uri: string; // origin of the app, e.g. "http://localhost:3000"
  chainId: "mainnet" | "testnet" | "devnet";
  nonce: string;
  issuedAt: Date;
  expirationTime: Date;
};

export function buildSignInMessage(fields: SignInMessageFields): string {
  return [
    `${fields.domain} wants you to sign in with your Solana account:`,
    fields.address,
    "",
    SIGN_IN_STATEMENT,
    "",
    `URI: ${fields.uri}`,
    "Version: 1",
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt.toISOString()}`,
    `Expiration Time: ${fields.expirationTime.toISOString()}`,
  ].join("\n");
}

// 32 random bytes, base58-encoded: alphanumeric, as SIWS requires (min. 8 characters).
export function generateNonce(): string {
  return getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32)));
}
