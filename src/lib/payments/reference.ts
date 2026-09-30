import { generateKeyPair, getAddressFromPublicKey } from "@solana/kit";

// A Solana Pay reference: a fresh, random public key attached to the payment
// transaction as a read-only account, so the transaction can be found on-chain by
// looking up this address. Nobody ever needs its private key; it is discarded.
export async function generateReference(): Promise<string> {
  const { publicKey } = await generateKeyPair();
  return getAddressFromPublicKey(publicKey);
}
