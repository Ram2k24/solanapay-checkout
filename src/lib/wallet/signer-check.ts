import { address, getPublicKeyFromAddress, signatureBytes, verifySignature } from "@solana/kit";

export type SignerCheck = "match" | "other-account" | "unknown";

type Verify = (wallet: string, message: Uint8Array, signature: Uint8Array) => Promise<boolean>;

const verifyInBrowser: Verify = async (wallet, message, signature) =>
  verifySignature(await getPublicKeyFromAddress(address(wallet)), signatureBytes(signature), message);

// Checks, before sending, which account a wallet signed with (Phase 13.3). Wallet apps can
// sign with their own active account even when the page believes another one is connected;
// the server would only answer "invalid signature". This is a usability check, never a
// security one: the server still verifies every signature, so on any doubt ("unknown",
// e.g. a browser without Ed25519 in WebCrypto) the page sends the signature anyway.
export async function checkSigner(
  wallet: string,
  message: Uint8Array,
  signature: Uint8Array,
  verify: Verify = verifyInBrowser,
): Promise<SignerCheck> {
  try {
    return (await verify(wallet, message, signature)) ? "match" : "other-account";
  } catch {
    return "unknown";
  }
}
