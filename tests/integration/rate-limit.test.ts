import { beforeEach, describe, expect, it } from "vitest";
import { POST as nonce } from "@/app/api/auth/nonce/route";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { consumeRateLimit, enforceRateLimit } from "@/lib/http/rate-limit";
import { resetDatabase } from "../support/db";
import { apiRequest } from "../support/http";
import { createTestWallet } from "../support/wallet";
import { freezeClockMidMinute } from "../support/clock";

beforeEach(resetDatabase);

// Pinned clocks make window boundaries deterministic. 2026-10-02T12:00:00Z is a
// multiple of both 10 s and 60 s windows.
const T0 = Date.parse("2026-10-02T12:00:00.000Z");
const at = (ms: number) => ({ now: new Date(T0 + ms) });

async function consumeMany(n: number, key: string, limit: number, windowSeconds: number, opts: { sliding?: boolean; now?: Date }) {
  const results = [];
  for (let i = 0; i < n; i++) results.push(await consumeRateLimit(key, limit, windowSeconds, opts));
  return results;
}

describe("fixed window (existing behaviour)", () => {
  it("allows the limit, then reports when the window ends", async () => {
    const results = await consumeMany(4, "t:fixed", 3, 60, at(20_000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterSeconds).toBe(40); // the window resets 40 s later
    expect((await consumeRateLimit("t:fixed", 3, 60, at(60_000))).allowed).toBe(true); // new window
  });

  it("counts denied requests (abuse keeps the key blocked)", async () => {
    await consumeMany(5, "t:fixed-denied", 3, 60, at(0));
    const [row] = await db.$queryRaw<{ count: number }[]>`SELECT count FROM rate_limits WHERE key = 't:fixed-denied'`;
    expect(row!.count).toBe(5);
  });
});

describe("sliding window (shared budgets)", () => {
  it("prevents the boundary burst a fixed window allows", async () => {
    // 20 requests late in one window...
    expect((await consumeMany(20, "t:slide", 20, 10, { sliding: true, ...at(9_900) })).every((r) => r.allowed)).toBe(true);
    // ...a fixed window would allow 20 more 200 ms later; the sliding window allows none yet.
    const next = await consumeRateLimit("t:slide", 20, 10, { sliding: true, ...at(10_100) });
    expect(next).toEqual({ allowed: false, retryAfterSeconds: 1 }); // allowed again from 10.5 s
    expect((await consumeRateLimit("t:slide", 20, 10, { sliding: true, ...at(10_500) })).allowed).toBe(true);
  });

  it("reports the calculated earliest retry time", async () => {
    await consumeMany(10, "t:retry", 10, 10, { sliding: true, ...at(0) }); // a full window
    // 4 s into the next window the previous window still counts 10*(1-0.4) = 6, so 4 more
    // fit (the 4th: 6 + 3 + 1 = 10), and the 5th is denied.
    const results = await consumeMany(5, "t:retry", 10, 10, { sliding: true, ...at(14_000) });
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, true, false]);
    // previous 10, current 4: need 10*(1-x) + 4 + 1 <= 10 -> x >= 0.5, at 15 s: 1 s from now.
    expect(results[4]!.retryAfterSeconds).toBe(1);
  });

  it("doesn't let denied requests consume the budget", async () => {
    await consumeMany(15, "t:budget", 10, 10, { sliding: true, ...at(1_000) });
    const [row] = await db.$queryRaw<{ count: number }[]>`SELECT count FROM rate_limits WHERE key = 't:budget'`;
    expect(row!.count).toBe(10);
  });

  it("never overshoots when many callers race (row-locked, database-backed)", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => consumeRateLimit("t:race", 20, 10, { sliding: true, ...at(2_000) })));
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
  });

  it("uses the database clock when none is pinned", async () => {
    expect((await consumeRateLimit("t:dbclock", 1, 10, { sliding: true })).allowed).toBe(true);
    expect((await consumeRateLimit("t:dbclock", 1, 10, { sliding: true })).allowed).toBe(false);
  });
});

describe("Retry-After on HTTP 429", () => {
  it("enforceRateLimit throws RateLimited with the calculated delay", async () => {
    await enforceRateLimit("t:enforce", 1, 60, at(15_000));
    const error = await enforceRateLimit("t:enforce", 1, 60, at(15_000)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "RateLimited", retryAfterSeconds: 45 });
  });

  it("existing routes now send Retry-After with their 429", async () => {
    freezeClockMidMinute(); // all requests in one fixed rate-limit window
    const wallet = await createTestWallet();
    const request = () =>
      nonce(apiRequest("/api/auth/nonce", { body: { walletAddress: wallet.address }, headers: { "x-forwarded-for": "198.51.100.7" } }));
    for (let i = 0; i < 10; i++) await request();
    const limited = await request();
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });
});
