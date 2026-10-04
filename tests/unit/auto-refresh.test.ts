import { describe, expect, it } from "vitest";
import { createAutoRefresh, DASHBOARD_REFRESH_MS } from "@/lib/merchant/auto-refresh";

// A fake clock with timers that fire when time is advanced.
function fakeTime() {
  let t = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        pending.set(next, { at: t + ms, fn });
        return next++;
      },
      clearTimeout: (id: unknown) => void pending.delete(id as number),
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
    scheduled: () => pending.size,
  };
}

function setup(opts: { hidden?: boolean; busy?: boolean } = {}) {
  const clock = fakeTime();
  const state = { hidden: opts.hidden ?? false, busy: opts.busy ?? false, refreshes: [] as number[] };
  const auto = createAutoRefresh({
    refresh: () => state.refreshes.push(clock.now()),
    isBusy: () => state.busy,
    isHidden: () => state.hidden,
    now: clock.now,
    timers: clock.timers,
  });
  return { auto, clock, state };
}

describe("createAutoRefresh", () => {
  it("refreshes every 30 s while visible", () => {
    const { auto, clock, state } = setup();
    auto.start();
    clock.advance(95_000);
    expect(state.refreshes).toEqual([30_000, 60_000, 90_000]);
    expect(DASHBOARD_REFRESH_MS).toBe(30_000);
  });

  it("does nothing while hidden", () => {
    const { auto, clock, state } = setup({ hidden: true });
    auto.start();
    clock.advance(120_000);
    expect(state.refreshes).toEqual([]);
    expect(clock.scheduled()).toBe(0);
  });

  it("stops when the tab is hidden, and refreshes at once on return if the data is stale", () => {
    const { auto, clock, state } = setup();
    auto.start();
    clock.advance(10_000);
    state.hidden = true;
    auto.visibilityChanged();
    clock.advance(100_000); // 110 s since the last render
    expect(state.refreshes).toEqual([]);
    state.hidden = false;
    auto.visibilityChanged();
    expect(state.refreshes).toEqual([110_000]);
    clock.advance(30_000);
    expect(state.refreshes).toEqual([110_000, 140_000]);
  });

  it("on a quick return, waits only for the rest of the interval", () => {
    const { auto, clock, state } = setup();
    auto.start();
    clock.advance(10_000);
    state.hidden = true;
    auto.visibilityChanged();
    clock.advance(5_000);
    state.hidden = false;
    auto.visibilityChanged(); // data is 15 s old
    clock.advance(14_999);
    expect(state.refreshes).toEqual([]);
    clock.advance(1);
    expect(state.refreshes).toEqual([30_000]);
  });

  it("Refresh refreshes now and restarts the 30 s count", () => {
    const { auto, clock, state } = setup();
    auto.start();
    clock.advance(20_000);
    auto.refreshNow();
    clock.advance(29_999);
    expect(state.refreshes).toEqual([20_000]);
    clock.advance(1);
    expect(state.refreshes).toEqual([20_000, 50_000]);
  });

  it("never starts a second re-render while one is running", () => {
    const { auto, clock, state } = setup({ busy: true });
    auto.start();
    clock.advance(60_000);
    expect(state.refreshes).toEqual([]);
    state.busy = false;
    clock.advance(30_000);
    expect(state.refreshes).toEqual([90_000]);
  });

  it("does nothing after stop", () => {
    const { auto, clock, state } = setup();
    auto.start();
    auto.stop();
    auto.refreshNow();
    auto.visibilityChanged();
    clock.advance(120_000);
    expect(state.refreshes).toEqual([]);
    expect(clock.scheduled()).toBe(0);
  });
});
