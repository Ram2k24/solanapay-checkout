import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/http/request";

// Phase 13: the /pay page now uses the same validated helper as the API routes,
// passing the headers of the page request.
describe("clientIp", () => {
  const headers = (value?: string) => new Headers(value === undefined ? {} : { "x-forwarded-for": value });

  it("takes the first X-Forwarded-For entry, from a request or from page headers", () => {
    expect(clientIp(new Request("http://localhost/", { headers: headers("203.0.113.7, 10.0.0.1") }))).toBe("203.0.113.7");
    expect(clientIp(headers("2001:db8::1"))).toBe("2001:db8::1");
  });

  it.each([
    ["missing", undefined],
    ["not an IP", "evil.example"],
    ["oversized and forged", "x".repeat(10_000)],
    ["empty", ""],
  ])("counts a %s header as unknown", (_label, value) => {
    expect(clientIp(headers(value))).toBe("unknown");
  });
});

describe("clientIp with Next.js page headers", () => {
  // Shaped like the adapter Next.js's headers() returns: get(), plus an internal
  // `headers` field holding the raw headers (which has no get()).
  class PageHeaders {
    readonly headers: Record<string, string>;
    constructor(raw: Record<string, string>) {
      this.headers = raw;
    }
    get(name: string): string | null {
      return this.headers[name.toLowerCase()] ?? null;
    }
  }

  it("reads through get(), not the internal field", () => {
    expect(clientIp(new PageHeaders({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new PageHeaders({ "x-forwarded-for": "x".repeat(10_000) }))).toBe("unknown");
    expect(clientIp(new PageHeaders({}))).toBe("unknown");
  });
});
