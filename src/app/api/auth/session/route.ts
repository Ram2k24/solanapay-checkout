import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { route } from "@/lib/http/route";

// Who is signed in (used by the UI). Never returns the session token.
export const GET = route("auth.session", async (request) => {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ authenticated: false });
  return NextResponse.json({ authenticated: true, walletAddress: session.walletAddress, expiresAt: session.expiresAt });
});
