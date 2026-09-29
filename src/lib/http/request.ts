import "server-only";
import { publicEnv } from "@/lib/config/public-env";
import { ApiError } from "./api";

// CSRF protection for state-changing requests: browsers always send an Origin
// header on cross-site POSTs, so rejecting any origin other than our own blocks
// forged requests from other sites. (The session cookie is also SameSite=Lax.)
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== new URL(publicEnv.NEXT_PUBLIC_APP_URL).origin) {
    throw new ApiError("ForbiddenOrigin");
  }
}

// Client IP for rate limiting. Only the first X-Forwarded-For entry is used, which
// is trustworthy only behind a proxy that overwrites the header (e.g. Vercel).
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
