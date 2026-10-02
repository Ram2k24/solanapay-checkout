import type { InvoiceStatus } from "@/generated/prisma/enums";

// Polls the public invoice status for the checkout page (and, later, the Phase 8
// in-browser payment screen). Framework-free: no React, no DOM, so its timing is
// testable with fake timers. It only decides WHEN to ask the server; whatever status
// it receives is used to re-render server output, never as evidence of payment.
//
// Rules (Phase 10.3, locked):
//   - one request at a time: the next poll is scheduled after the previous completes
//   - every 3 s while the invoice may still change
//   - 10 s request timeout: the request is aborted and treated as an error
//   - errors back off 3 -> 6 -> 12 -> 24 -> 30 s (max); a success resets it
//   - 429: wait the server's Retry-After (falls back to the backoff if absent)
//   - hidden tab: no polling; visible again: poll at once (unless a wait is pending)
//   - stop at PAID or FAILED, on 404, and expires_at + 5 min (EXPIRED alone is not
//     final before that: a last-second payment may still be detected)

export const POLLING = {
  intervalMs: 3_000,
  backoffMs: [3_000, 6_000, 12_000, 24_000, 30_000],
  requestTimeoutMs: 10_000,
  postExpiryWindowMs: 5 * 60_000,
} as const;

export type FetchResult =
  | { kind: "ok"; status: InvoiceStatus }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "not-found" }
  | { kind: "error" };

export type PollerState = "active" | "backoff" | "paused" | "stopped";

type Timers = { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };

export type StatusPollerOptions = {
  fetchStatus: (signal: AbortSignal) => Promise<FetchResult>;
  initialStatus: InvoiceStatus;
  expiresAt: string | Date;
  onStatus?: (status: InvoiceStatus, previous: InvoiceStatus) => void;
  onState?: (state: PollerState) => void;
  isHidden?: () => boolean;
  now?: () => number;
  timers?: Timers;
};

export function createStatusPoller(options: StatusPollerOptions) {
  const now = options.now ?? (() => Date.now());
  const timers: Timers = options.timers ?? { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
  const isHidden = options.isHidden ?? (() => false);
  const stopAt = new Date(options.expiresAt).getTime() + POLLING.postExpiryWindowMs;

  let status = options.initialStatus;
  let state: PollerState = "active";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  let errors = 0;
  let notBefore = 0; // after a 429 or an error: no poll before this time, even on tab focus

  const setState = (next: PollerState) => {
    if (next !== state) {
      state = next;
      options.onState?.(next);
    }
  };

  const isFinal = () => status === "PAID" || status === "FAILED" || now() >= stopAt;

  function stop() {
    if (timer) timers.clearTimeout(timer);
    timer = null;
    inFlight?.abort();
    inFlight = null;
    setState("stopped");
  }

  function schedule(delayMs: number, label: "active" | "backoff") {
    if (state === "stopped") return;
    if (timer) timers.clearTimeout(timer);
    timer = null;
    if (label === "backoff") notBefore = now() + delayMs;
    if (isHidden()) return setState("paused");
    setState(label);
    timer = timers.setTimeout(poll, delayMs);
  }

  async function poll() {
    timer = null;
    if (state === "stopped" || inFlight) return;
    if (isFinal()) return stop();
    if (isHidden()) return setState("paused");

    const controller = new AbortController();
    inFlight = controller;
    if (state === "paused") setState("active"); // e.g. the tab is visible again: show it right away
    const timeout = timers.setTimeout(() => controller.abort(), POLLING.requestTimeoutMs);
    let result: FetchResult;
    try {
      result = await options.fetchStatus(controller.signal);
    } catch {
      result = { kind: "error" }; // network failure, or aborted by the timeout
    } finally {
      timers.clearTimeout(timeout);
    }
    if (inFlight !== controller) return; // stopped while the request was running
    inFlight = null;
    if (controller.signal.aborted) result = { kind: "error" };

    switch (result.kind) {
      case "ok": {
        errors = 0;
        notBefore = 0;
        const previous = status;
        status = result.status;
        if (status !== previous) options.onStatus?.(status, previous);
        return isFinal() ? stop() : schedule(POLLING.intervalMs, "active");
      }
      case "not-found":
        return stop(); // an unknown invoice can't become valid later
      case "rate-limited": {
        const seconds = result.retryAfterSeconds;
        if (seconds !== null && Number.isFinite(seconds) && seconds > 0) return schedule(seconds * 1000, "backoff");
        return schedule(nextBackoff(), "backoff");
      }
      case "error":
        return schedule(nextBackoff(), "backoff");
    }
  }

  function nextBackoff(): number {
    const delay = POLLING.backoffMs[Math.min(errors, POLLING.backoffMs.length - 1)]!;
    errors += 1;
    return delay;
  }

  return {
    // The page was just rendered from the server, so the first poll waits one interval.
    start() {
      if (isFinal()) return stop();
      schedule(POLLING.intervalMs, "active");
    },
    // Call on the browser's visibilitychange event.
    visibilityChanged() {
      if (state === "stopped") return;
      if (isHidden()) {
        if (timer) timers.clearTimeout(timer);
        timer = null;
        return setState("paused"); // a running request may finish; nothing new is scheduled
      }
      if (inFlight) return; // its completion schedules the next poll
      const wait = notBefore - now();
      if (wait > 0) return schedule(wait, "backoff");
      void poll();
    },
    stop,
    get state() {
      return state;
    },
    get status() {
      return status;
    },
  };
}

// Converts an HTTP response from GET /api/pay/[id]/status into a FetchResult.
export async function readStatusResponse(response: Response): Promise<FetchResult> {
  if (response.status === 404) return { kind: "not-found" };
  if (response.status === 429) {
    const header = response.headers.get("retry-after");
    const seconds = header !== null && /^\d+$/.test(header.trim()) ? Number(header) : null;
    return { kind: "rate-limited", retryAfterSeconds: seconds };
  }
  if (!response.ok) return { kind: "error" };
  const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
  const valid: readonly string[] = ["DRAFT", "PENDING", "CONFIRMING", "PAID", "EXPIRED", "FAILED"];
  return typeof body?.status === "string" && valid.includes(body.status)
    ? { kind: "ok", status: body.status as InvoiceStatus }
    : { kind: "error" };
}
