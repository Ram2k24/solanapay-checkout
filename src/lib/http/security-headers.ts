// Security headers for every response (Phase 13, decision D4). Used by next.config.ts,
// so this module must stay dependency-free (no "@/" imports, no server-only).
//
// Baseline Content-Security-Policy: no external scripts, plugins, framing or foreign
// form targets; the browser may connect only to our own origin and the configured
// Solana RPC (wallet balances). Scripts keep 'unsafe-inline' because Next.js inlines
// its bootstrap scripts; a nonce-based policy without it is on the Phase 17 roadmap.

export type SecurityHeaderOptions = {
  appUrl: string; // NEXT_PUBLIC_APP_URL
  rpcUrl: string; // NEXT_PUBLIC_SOLANA_RPC_URL
  development: boolean; // `next dev`: hot reload needs eval and a websocket
};

export function contentSecurityPolicy({ appUrl, rpcUrl, development }: SecurityHeaderOptions): string {
  const rpc = new URL(rpcUrl).origin;
  const https = new URL(appUrl).protocol === "https:";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", // wallet icons are data: URIs (Wallet Standard)
    "font-src 'self'", // next/font serves fonts from our own origin
    `connect-src 'self' ${rpc}${development ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'", // no framing: protects the Pay and payout-change buttons from clickjacking
    ...(https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  const https = new URL(options.appUrl).protocol === "https:";
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" }, // for browsers that ignore frame-ancestors
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
    // Only over HTTPS: on plain-HTTP localhost it would be ignored, and it must never
    // be sent by a deployment that isn't fully on HTTPS. Two years, no preload yet.
    ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  ];
}
