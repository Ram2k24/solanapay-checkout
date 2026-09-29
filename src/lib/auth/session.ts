import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { publicEnv } from "@/lib/config/public-env";
import { serverEnv } from "@/lib/config/server-env";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";

export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours, absolute

// Over HTTPS the "__Host-" prefix makes browsers enforce Secure, Path=/ and no
// Domain attribute, so the cookie can't be set or read by other subdomains.
const secure = new URL(publicEnv.NEXT_PUBLIC_APP_URL).protocol === "https:";
export const SESSION_COOKIE = secure ? "__Host-sp_session" : "sp_session";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

// Only the HMAC of a token is stored. Without AUTH_SECRET, a copy of the
// sessions table can't be turned back into working cookies.
function hashToken(token: string): string {
  return createHmac("sha256", serverEnv.AUTH_SECRET).update(token).digest("hex");
}

export type AuthSession = { sessionId: string; userId: string; walletAddress: string; expiresAt: Date };

export async function createSession(
  userId: string,
  meta: { ipAddress: string; userAgent: string | null },
  tx: Pick<Prisma.TransactionClient, "session"> = db,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await tx.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: meta.ipAddress.slice(0, 45),
      userAgent: meta.userAgent?.slice(0, 256) ?? null,
    },
  });
  return { token, expiresAt };
}

export async function getSession(request: NextRequest): Promise<AuthSession | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { walletAddress: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  return {
    sessionId: session.id,
    userId: session.userId,
    walletAddress: session.user.walletAddress,
    expiresAt: session.expiresAt,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, // not readable by JavaScript (limits XSS damage)
    secure,
    sameSite: "lax", // not sent on cross-site POSTs (CSRF defense)
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
}
