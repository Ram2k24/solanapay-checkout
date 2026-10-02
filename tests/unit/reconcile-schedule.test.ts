import { describe, expect, it } from "vitest";
import { backoffAfter, CADENCE, nextCheckAt } from "@/lib/payments/reconcile-schedule";

const T = Date.parse("2026-10-02T12:00:00.000Z");
const at = (offsetMs: number) => new Date(T + offsetMs);
const s = 1_000;
const min = 60 * s;

function next(status: Parameters<typeof nextCheckAt>[0]["status"], createdAgoMs: number, expiresInMs: number, now = T) {
  const result = nextCheckAt({ status, createdAt: at(-createdAgoMs), expiresAt: at(expiresInMs) }, new Date(now));
  return result === null ? null : result.getTime() - now;
}

describe("nextCheckAt", () => {
  it("PENDING: every 30 s for the first 10 minutes", () => {
    expect(next("PENDING", 1 * min, 29 * min)).toBe(30 * s);
    expect(next("PENDING", 9 * min + 59 * s, 20 * min)).toBe(30 * s);
  });

  it("PENDING: every 2 minutes after that", () => {
    expect(next("PENDING", 10 * min, 20 * min)).toBe(2 * min);
  });

  it("PENDING: never later than the expiry decision (expires_at + 180 s)", () => {
    expect(next("PENDING", 20 * min, 30 * s)).toBe(2 * min); // decision in 3.5 min: the normal 2 min step comes first
    expect(next("PENDING", 20 * min, -60 * s)).toBe(120 * s); // decision due in 2 min
    expect(next("PENDING", 20 * min, -170 * s)).toBe(10 * s);
  });

  it("PENDING past its expiry decision: due now (the reconciler expires it next)", () => {
    expect(next("PENDING", 60 * min, -5 * min)).toBe(0);
  });

  it("CONFIRMING: every 15 s until finalized", () => {
    expect(next("CONFIRMING", 60 * min, -60 * min)).toBe(15 * s);
  });

  it("EXPIRED: every 10 minutes for 24 hours after expiry, then never", () => {
    expect(next("EXPIRED", 2 * 60 * min, -1 * 60 * min)).toBe(10 * min);
    expect(next("EXPIRED", 25 * 60 * min, -(24 * 60 - 3) * min)).toBe(3 * min); // capped at the end of the watch
    expect(next("EXPIRED", 25 * 60 * min, -24 * 60 * min)).toBeNull();
  });

  it.each(["PAID", "FAILED", "DRAFT"] as const)("%s: no further checks", (status) => {
    expect(next(status, 60 * min, 0)).toBeNull();
  });

  it("matches the locked numbers", () => {
    expect(CADENCE).toMatchObject({ pendingFresh: 30 * s, pendingOlder: 2 * min, confirming: 15 * s, expiredWatch: 10 * min });
  });
});

describe("backoffAfter", () => {
  it("30 s → 1 → 2 → 4 → 8 → 10 min (max)", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffAfter)).toEqual([30 * s, 1 * min, 2 * min, 4 * min, 8 * min, 10 * min, 10 * min, 10 * min]);
  });
});
