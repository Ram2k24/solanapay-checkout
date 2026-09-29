import { generateKeyPair, getAddressFromPublicKey, getBase64Decoder, signBytes } from "@solana/kit";

// A throwaway wallet for tests: a fresh Ed25519 key pair that exists only in memory.
export async function createTestWallet() {
  const keyPair = await generateKeyPair();
  const address = await getAddressFromPublicKey(keyPair.publicKey);
  return {
    address: address as string,
    // Signs a text message the way a wallet's signMessage does; returns base64.
    async sign(message: string): Promise<string> {
      const signature = await signBytes(keyPair.privateKey, new TextEncoder().encode(message));
      return getBase64Decoder().decode(signature);
    },
  };
}
