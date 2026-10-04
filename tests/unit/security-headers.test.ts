import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { contentSecurityPolicy, securityHeaders } from "@/lib/http/security-headers";

const LOCAL = { appUrl: "http://localhost:3000", rpcUrl: "https://api.devnet.solana.com", development: false };
const HOSTED = { appUrl: "https://checkout.example.com", rpcUrl: "https://rpc.provider.example/v2/key123", development: false };
const header = (opts: typeof LOCAL, key: string) => securityHeaders(opts).find((h) => h.key === key)?.value;
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `) || d === name);

describe("content security policy (Phase 13, decision D4)", () => {
  const csp = contentSecurityPolicy(LOCAL);

  it("allows only our own scripts: no external hosts, no eval in production", () => {
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
  });

  it("lets the browser connect only to us and the configured RPC origin (never its path or key)", () => {
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://api.devnet.solana.com");
    expect(directive(contentSecurityPolicy(HOSTED), "connect-src")).toBe("connect-src 'self' https://rpc.provider.example");
  });

  it("blocks framing, plugins, base-tag and foreign form targets", () => {
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(csp.split("; ")).toContain(d);
    }
  });

  it("allows wallet icons (data: URIs) and our own fonts", () => {
    expect(directive(csp, "img-src")).toBe("img-src 'self' data: blob:");
    expect(directive(csp, "font-src")).toBe("font-src 'self'");
  });

  it("adds eval and a websocket only for the development server", () => {
    const dev = contentSecurityPolicy({ ...LOCAL, development: true });
    expect(directive(dev, "script-src")).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain(" ws:");
    expect(directive(csp, "connect-src")).not.toContain("ws:");
  });

  it("upgrades insecure requests only on HTTPS deployments", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy(HOSTED)).toContain("upgrade-insecure-requests");
  });
});

describe("other security headers", () => {
  it("sends nosniff, anti-framing, a referrer policy and a permissions policy", () => {
    expect(header(LOCAL, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(LOCAL, "X-Frame-Options")).toBe("DENY");
    expect(header(LOCAL, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header(LOCAL, "Permissions-Policy")).toContain("camera=()");
  });

  it("sends HSTS only for an HTTPS app URL", () => {
    expect(header(LOCAL, "Strict-Transport-Security")).toBeUndefined();
    expect(header(HOSTED, "Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
  });
});

describe("next.config.ts", () => {
  it("applies the headers to every route, from the configured URLs", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");
    const csp = rules[0]!.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).toContain(`connect-src 'self' ${new URL(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!).origin}`);
  });
});
