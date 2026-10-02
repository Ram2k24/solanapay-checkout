import { describe, expect, it } from "vitest";
import { slidingAllows, slidingEstimate, slidingRetryAfterMs } from "@/lib/http/sliding-window";

const W = 10_000; // 10-second window

describe("slidingEstimate", () => {
  it("weights the previous window by how much of it is still in range", () => {
    expect(slidingEstimate(20, 0, 0, W)).toBe(20); // window just started: all of previous counts
    expect(slidingEstimate(20, 0, 2_500, W)).toBe(15);
    expect(slidingEstimate(20, 4, 5_000, W)).toBe(14);
    expect(slidingEstimate(20, 4, W, W)).toBe(4); // previous window fully out of range
  });
});

describe("slidingAllows", () => {
  it("allows exactly up to the limit", () => {
    expect(slidingAllows(0, 34, 0, W, 35)).toBe(true); // the 35th request
    expect(slidingAllows(0, 35, 0, W, 35)).toBe(false);
  });

  it("prevents the 2x burst a fixed window allows at a boundary", () => {
    // 20 requests just before the boundary, then a new window starts:
    expect(slidingAllows(20, 0, 100, W, 20)).toBe(false);
    // A fixed window would allow 20 more right away; sliding admits them gradually:
    expect(slidingAllows(20, 0, 500, W, 20)).toBe(true); // 19 + 1 = 20
    expect(slidingAllows(20, 1, 500, W, 20)).toBe(false);
  });
});

describe("slidingRetryAfterMs", () => {
  it("is 0 when allowed now", () => {
    expect(slidingRetryAfterMs(0, 3, 1_000, W, 35)).toBe(0);
  });

  it("waits for the previous window to decay, within the current window", () => {
    // previous 10, current 2, limit 10, 25% into the window: need 10*(1-x) <= 7 -> x >= 0.3
    expect(slidingRetryAfterMs(10, 2, 2_500, W, 10)).toBeCloseTo(500);
  });

  it("waits into the next window when the current window is full", () => {
    // current 10 = limit at 40%: next window starts in 6 s, then 10*(1-s/W) + 1 <= 10 -> s >= 1 s
    expect(slidingRetryAfterMs(0, 10, 4_000, W, 10)).toBeCloseTo(7_000);
  });

  it("is consistent: the request is allowed exactly at the computed time, not before", () => {
    const cases: [number, number, number, number][] = [
      [10, 2, 2_500, 10], [0, 10, 4_000, 10], [35, 0, 1, 35], [20, 20, 9_000, 20], [3, 1, 0, 1],
    ];
    for (const [previous, current, elapsed, limit] of cases) {
      const wait = slidingRetryAfterMs(previous, current, elapsed, W, limit);
      const at = elapsed + wait;
      // Re-evaluate at that moment (rolling the windows over if needed).
      const allowedAt = (t: number) =>
        t < W ? slidingAllows(previous, current, t, W, limit)
          : t < 2 * W ? slidingAllows(current, 0, t - W, W, limit)
          : slidingAllows(0, 0, t - 2 * W, W, limit);
      expect(allowedAt(at + 1e-6), `case ${[previous, current, elapsed, limit]}`).toBe(true);
      if (wait > 1) expect(allowedAt(at - 1)).toBe(false);
    }
  });
});
