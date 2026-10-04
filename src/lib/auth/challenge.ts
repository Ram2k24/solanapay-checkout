import "server-only";
import { publicEnv } from "@/lib/config/public-env";
import { serverEnv } from "@/lib/config/server-env";
import { db } from "@/lib/db/client";
import { buildPayoutChangeMessage } from "@/lib/merchant/payout-change-message";
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

// Creates a one-time challenge for the signed-in wallet to confirm changing its
// merchant's payout wallet. The new wallet is stored in the row, so the confirmation
// takes it from the database, never from the confirming request.
export async function issuePayoutChangeChallenge(walletAddress: string, newPayoutWallet: string) {
  const appUrl = new URL(publicEnv.NEXT_PUBLIC_APP_URL);
  const nonce = generateNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_SECONDS * 1000);

  const message = buildPayoutChangeMessage({
    domain: appUrl.host,
    address: walletAddress,
    newPayoutWallet,
    uri: appUrl.origin,
    chainId: serverEnv.network,
    nonce,
    issuedAt,
    expirationTime: expiresAt,
  });

  await db.authNonce.create({ data: { nonce, walletAddress, message, expiresAt, purpose: "PAYOUT_CHANGE", newPayoutWallet } });
  return { nonce, message, expiresAt };
}

export type ChallengePurpose = "SIGN_IN" | "PAYOUT_CHANGE";

// Marks the challenge used and returns it, or null if it doesn't exist, has expired,
// was already used, or was issued for another purpose (Phase 11.4: a signed payout-change
// confirmation can't sign anyone in, and a sign-in signature can't change a wallet).
// `forWallet` also requires the challenge to belong to that wallet, so nobody can use up
// another wallet's pending challenge by sending its nonce.
// The single UPDATE ... WHERE used_at IS NULL makes this atomic: two concurrent requests
// with the same nonce can't both succeed (replay protection).
export async function consumeChallenge(
  nonce: string,
  purpose: ChallengePurpose,
  forWallet?: string,
): Promise<{ walletAddress: string; message: string; newPayoutWallet: string | null } | null> {
  const wallet = forWallet ?? null;
  const rows = await db.$queryRaw<{ wallet_address: string; message: string; new_payout_wallet: string | null }[]>`
    UPDATE auth_nonces SET used_at = now()
    WHERE nonce = ${nonce} AND purpose = ${purpose}::challenge_purpose AND used_at IS NULL AND expires_at > now()
      AND (${wallet}::text IS NULL OR wallet_address = ${wallet})
    RETURNING wallet_address, message, new_payout_wallet`;
  const row = rows[0];
  return row ? { walletAddress: row.wallet_address, message: row.message, newPayoutWallet: row.new_payout_wallet } : null;
}
