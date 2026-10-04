import "server-only";
import { isIP } from "node:net";
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
// Anything that isn't an IP address (e.g. a forged, oversized header) counts as
// "unknown", so it can't overflow the rate-limit key column or mint fresh keys.
// Takes a request (route handlers) or its headers (server pages, via headers()).
export function clientIp(source: Request | { get(name: string): string | null }): string {
  const headers = "headers" in source ? source.headers : source;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return isIP(forwarded) ? forwarded : "unknown";
}
