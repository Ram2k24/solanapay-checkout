import { NextResponse } from "next/server";
import { clearSessionCookie, getSession, revokeSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { assertSameOrigin } from "@/lib/http/request";
import { route } from "@/lib/http/route";

// Revokes the current session server-side and clears the cookie. Idempotent.
export const POST = route("auth.logout", async (request, { log }) => {
  assertSameOrigin(request);
  const session = await getSession(request);
  if (session) {
    await revokeSession(session.sessionId);
    await db.auditLog.create({
      data: { actorType: "USER", actorId: session.userId, action: "auth.sign_out", entityType: "user", entityId: session.userId },
    });
    log.info({ walletAddress: session.walletAddress }, "signed out");
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
});
