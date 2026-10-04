import { getBase64Encoder, getPublicKeyFromAddress, isAddress, isSignatureBytes, verifySignature } from "@solana/kit";

// True only if `signature` is a valid Ed25519 signature of `message` by the wallet `walletAddress`.
// Never throws for bad input: malformed addresses or signatures simply fail verification.
export async function verifyWalletSignature(
  walletAddress: string,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (!isAddress(walletAddress) || !isSignatureBytes(signature)) return false;
  try {
    const publicKey = await getPublicKeyFromAddress(walletAddress);
    return await verifySignature(publicKey, signature, message);
  } catch {
    return false;
  }
}

// Decodes a base64 signature sent by our pages; null if it isn't valid base64.
export function decodeBase64Signature(value: string): Uint8Array | null {
  try {
    return new Uint8Array(getBase64Encoder().encode(value));
  } catch {
    return null;
  }
}
