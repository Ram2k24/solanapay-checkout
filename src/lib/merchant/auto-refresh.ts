// Keeps the merchant dashboard current (Phase 11, decision D3): re-render it every 30 s
// while the tab is visible. A re-render reads only our database; it never calls Solana,
// so it doesn't touch the RPC budget. Detection stays with the reconciler and status API.
// Framework-free, like status-poller.ts, so the timing is tested with fake timers.

export const DASHBOARD_REFRESH_MS = 30_000;

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

export function createAutoRefresh(options: {
  intervalMs?: number;
  refresh: () => void; // starts a re-render
  isBusy?: () => boolean; // a re-render is still running: skip this tick
  isHidden: () => boolean;
  now?: () => number;
  timers?: Timers;
}) {
  const intervalMs = options.intervalMs ?? DASHBOARD_REFRESH_MS;
  const now = options.now ?? Date.now;
  const timers: Timers = options.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  let timer: unknown = null;
  let lastRefresh = now(); // the page was just rendered
  let stopped = false;

  const clear = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const schedule = (delay: number) => {
    clear();
    if (!stopped && !options.isHidden()) timer = timers.setTimeout(tick, Math.max(0, delay));
  };
  const refreshNow = () => {
    lastRefresh = now();
    options.refresh();
    schedule(intervalMs);
  };
  function tick() {
    timer = null;
    if (options.isBusy?.()) schedule(intervalMs); // never two re-renders at once
    else refreshNow();
  }

  return {
    start: () => schedule(intervalMs),
    refreshNow: () => {
      if (!stopped) refreshNow();
    },
    // Hidden: stop. Visible again: refresh at once if the data is already stale,
    // otherwise wait out the rest of the interval.
    visibilityChanged: () => {
      if (stopped) return;
      if (options.isHidden()) return clear();
      const age = now() - lastRefresh;
      if (age >= intervalMs) refreshNow();
      else schedule(intervalMs - age);
    },
    stop: () => {
      stopped = true;
      clear();
    },
  };
}
