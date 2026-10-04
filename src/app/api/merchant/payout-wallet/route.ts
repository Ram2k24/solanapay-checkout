import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeChallenge } from "@/lib/auth/challenge";
import { decodeBase64Signature, verifyWalletSignature } from "@/lib/auth/signature";
import { db } from "@/lib/db/client";
import { ApiError, parseJsonBody } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { assertSameOrigin } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { payoutWalletProblem } from "@/lib/merchant/payout-wallet";
import { lockPayoutAddress, sharedPayoutProblem } from "@/lib/merchant/shared-payout";
import { requireMerchant } from "@/lib/merchant/require-merchant";

// Step 2 of changing the payout wallet (Phase 11.4c, decision D5). Needs, besides the
// session, the signed-in wallet's signature over a PAYOUT_CHANGE challenge issued to it:
// a stolen session cookie alone can't redirect future payments. The new wallet comes
// from the stored challenge, not from this request. Existing invoices keep their
// recipient (their terms are immutable, enforced by the database); new invoices use the
// new default wallet. Every other session of the merchant is signed out.
const bodySchema = z.strictObject({
  nonce: z.string().min(8).max(64),
  signature: z.string().min(1).max(200), // base64 Ed25519 signature
});

export const POST = route("merchant.payout_wallet.change", async (request, { log }) => {
  assertSameOrigin(request);
  const { session, merchant } = await requireMerchant(request);
  await enforceRateLimit(`merchant:payout:change:${merchant.id}`, 10, 60);
  const { nonce, signature } = await parseJsonBody(request, bodySchema);

  // Used up before verifying (as at sign-in), so a nonce can't be tried twice.
  const challenge = await consumeChallenge(nonce, "PAYOUT_CHANGE", session.walletAddress);
  if (!challenge?.newPayoutWallet) throw new ApiError("ChallengeExpired");

  const signatureBytes = decodeBase64Signature(signature);
  const valid =
    signatureBytes !== null &&
    (await verifyWalletSignature(session.walletAddress, new TextEncoder().encode(challenge.message), signatureBytes));
  if (!valid) {
    log.warn({ merchantId: merchant.id }, "payout wallet change: signature rejected");
    throw new ApiError("InvalidSignature");
  }

  const to = challenge.newPayoutWallet;
  const problem = payoutWalletProblem(to); // re-checked: the rules may have changed since the challenge
  if (problem) throw new ApiError("InvalidRequest", { payoutWallet: problem });

  const change = await db.$transaction(async (tx) => {
    // One change at a time per merchant: concurrent confirmations queue here.
    await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchant.id}::uuid FOR UPDATE`;
    const current = await tx.wallet.findFirstOrThrow({ where: { merchantId: merchant.id, isDefault: true } });
    if (current.address === to) return null; // already done (e.g. a parallel confirmation)
    // Another merchant may have taken this wallet since the challenge (decision D5).
    await lockPayoutAddress(tx, to);
    const shared = await sharedPayoutProblem(tx, to, session.userId);
    if (shared) throw new ApiError("InvalidRequest", { payoutWallet: shared });
    await tx.wallet.update({ where: { id: current.id }, data: { isDefault: false } });
    await tx.wallet.upsert({
      where: { merchantId_address: { merchantId: merchant.id, address: to } },
      create: { merchantId: merchant.id, address: to, label: "Default", isDefault: true },
      update: { isDefault: true },
    });
    // Where the money goes just changed: sign the merchant out everywhere else
    // (Phase 13, decision D8), so a session stolen earlier can't act on the new setup.
    const { count: otherSessionsRevoked } = await tx.session.updateMany({
      where: { userId: session.userId, id: { not: session.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorType: "USER", actorId: session.userId, action: "merchant.payout_wallet_changed", entityType: "merchant",
        entityId: merchant.id, data: { from: current.address, to, otherSessionsRevoked },
      },
    });
    return { from: current.address, otherSessionsRevoked };
  });

  if (change) log.info({ merchantId: merchant.id, from: change.from, to, otherSessionsRevoked: change.otherSessionsRevoked }, "payout wallet changed");
  return NextResponse.json({ payoutWallet: to, otherSessionsRevoked: change?.otherSessionsRevoked ?? 0 });
});
