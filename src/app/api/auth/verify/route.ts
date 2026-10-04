import { getBase64Encoder } from "@solana/kit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeChallenge } from "@/lib/auth/challenge";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { verifyWalletSignature } from "@/lib/auth/signature";
import { db } from "@/lib/db/client";
import { ApiError, parseJsonBody } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/lib/http/request";
import { route } from "@/lib/http/route";

const bodySchema = z.object({
  nonce: z.string().min(8).max(64),
  signature: z.string().min(1).max(200), // base64-encoded 64-byte Ed25519 signature
});

function decodeBase64(value: string): Uint8Array | null {
  try {
    return new Uint8Array(getBase64Encoder().encode(value));
  } catch {
    return null;
  }
}

// Step 2 of sign-in: verifies the wallet's signature and starts a session.
export const POST = route("auth.verify", async (request, { log }) => {
  assertSameOrigin(request);
  const ipAddress = clientIp(request);
  await enforceRateLimit(`auth:verify:${ipAddress}`, 10, 60);
  const { nonce, signature } = await parseJsonBody(request, bodySchema);

  // Consumed before verifying, so a nonce can never be tried twice.
  const challenge = await consumeChallenge(nonce, "SIGN_IN");
  if (!challenge) throw new ApiError("ChallengeExpired");

  const signatureBytes = decodeBase64(signature);
  const valid =
    signatureBytes !== null &&
    (await verifyWalletSignature(challenge.walletAddress, new TextEncoder().encode(challenge.message), signatureBytes));
  if (!valid) {
    log.warn({ walletAddress: challenge.walletAddress }, "sign-in signature rejected");
    throw new ApiError("InvalidSignature");
  }

  const { walletAddress } = challenge;
  const now = new Date();
  const session = await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { walletAddress },
      create: { walletAddress, lastLoginAt: now },
      update: { lastLoginAt: now },
    });
    const created = await createSession(user.id, { ipAddress, userAgent: request.headers.get("user-agent") }, tx);
    await tx.auditLog.create({
      data: { actorType: "USER", actorId: user.id, action: "auth.sign_in", entityType: "user", entityId: user.id, data: { walletAddress } },
    });
    return created;
  });

  log.info({ walletAddress }, "signed in");
  const response = NextResponse.json({ walletAddress, expiresAt: session.expiresAt });
  setSessionCookie(response, session.token, session.expiresAt);
  return response;
});
