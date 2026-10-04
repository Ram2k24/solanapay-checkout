import { onTestFinished, vi } from "vitest";

// Fixed-window rate limits count per clock minute (src/lib/http/rate-limit.ts). A test
// that sends N allowed requests and expects request N+1 to be refused fails if a minute
// boundary falls in between (it did once, 2026-10-04). This freezes only Date, at 10 s
// into the next minute, for the rest of the test, so every request lands in one window.
// Timers, the database clock and network I/O stay real. Restored when the test ends,
// pass or fail.
export function freezeClockMidMinute(): void {
  const tenSecondsIntoNextMinute = Math.ceil(Date.now() / 60_000) * 60_000 + 10_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(tenSecondsIntoNextMinute);
  onTestFinished(() => {
    vi.useRealTimers();
  });
}
