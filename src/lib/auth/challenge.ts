import "server-only";
import { publicEnv } from "@/lib/config/public-env";
import { serverEnv } from "@/lib/config/server-env";
import { db } from "@/lib/db/client";
import { buildSignInMessage, generateNonce } from "./siws";

export const CHALLENGE_TTL_SECONDS = 5 * 60;

// Creates a one-time sign-in challenge for `walletAddress` and stores the exact
// message the wallet must sign.
export async function issueChallenge(walletAddress: string) {
  const appUrl = new URL(publicEnv.NEXT_PUBLIC_APP_URL);
  const nonce = generateNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_SECONDS * 1000);

  const message = buildSignInMessage({
    domain: appUrl.host,
    address: walletAddress,
    uri: appUrl.origin,
    chainId: serverEnv.network,
    nonce,
    issuedAt,
    expirationTime: expiresAt,
  });

  await db.authNonce.create({ data: { nonce, walletAddress, message, expiresAt } });
  return { nonce, message, expiresAt };
}

// Marks the challenge used and returns it, or null if it doesn't exist, has expired,
// or was already used. The single UPDATE ... WHERE used_at IS NULL makes this atomic:
// two concurrent requests with the same nonce can't both succeed (replay protection).
export async function consumeChallenge(nonce: string): Promise<{ walletAddress: string; message: string } | null> {
  const rows = await db.$queryRaw<{ wallet_address: string; message: string }[]>`
    UPDATE auth_nonces SET used_at = now()
    WHERE nonce = ${nonce} AND used_at IS NULL AND expires_at > now()
    RETURNING wallet_address, message`;
  const row = rows[0];
  return row ? { walletAddress: row.wallet_address, message: row.message } : null;
}
