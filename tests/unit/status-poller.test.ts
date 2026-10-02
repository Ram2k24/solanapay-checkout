import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { createStatusPoller, POLLING, readStatusResponse, type FetchResult } from "@/lib/payments/status-poller";

const T0 = Date.parse("2026-10-02T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

// A fake status endpoint: each call waits until the test answers it (or the request is
// aborted, like fetch does), so slow and hung requests can be simulated precisely.
function fakeServer() {
  const calls: { signal: AbortSignal; answer: (r: FetchResult) => void }[] = [];
  const fetchStatus = vi.fn(
    (signal: AbortSignal) =>
      new Promise<FetchResult>((resolve, reject) => {
        calls.push({ signal, answer: resolve });
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
  const last = () => calls.at(-1)!;
  return {
    fetchStatus,
    calls,
    async answer(result: FetchResult) {
      last().answer(result);
      await vi.advanceTimersByTimeAsync(0); // let the poller handle the response
    },
    ok: (status: InvoiceStatus): FetchResult => ({ kind: "ok", status }),
  };
}

function setup(options: { initialStatus?: InvoiceStatus; expiresInMs?: number; hidden?: boolean } = {}) {
  const server = fakeServer();
  let hidden = options.hidden ?? false;
  const onStatus = vi.fn();
  const poller = createStatusPoller({
    fetchStatus: server.fetchStatus,
    initialStatus: options.initialStatus ?? "PENDING",
    expiresAt: new Date(T0 + (options.expiresInMs ?? 30 * 60_000)),
    onStatus,
    isHidden: () => hidden,
  });
  const setHidden = (value: boolean) => {
    hidden = value;
    poller.visibilityChanged();
  };
  return { server, poller, onStatus, setHidden };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("cadence and overlap", () => {
  it("polls every 3 s while PENDING, the first one interval after start", async () => {
    const { server, poller } = setup();
    poller.start();
    await advance(2_999);
    expect(server.fetchStatus).toHaveBeenCalledTimes(0);
    await advance(1);
    expect(server.fetchStatus).toHaveBeenCalledTimes(1);
    await server.answer(server.ok("PENDING"));
    await advance(3_000);
    expect(server.fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("never overlaps: a slow response delays the next poll, scheduled from completion", async () => {
    const { server, poller } = setup();
    poller.start();
    await advance(3_000); // request 1 starts
    await advance(5_000); // ...and is still running after 5 s
    expect(server.fetchStatus).toHaveBeenCalledTimes(1);
    await server.answer(server.ok("PENDING"));
    await advance(2_999);
    expect(server.fetchStatus).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(server.fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("aborts a request after 10 s, treats it as an error and backs off", async () => {
    const { server, poller } = setup();
    poller.start();
    await advance(3_000);
    await advance(POLLING.requestTimeoutMs);
    expect(server.calls[0]!.signal.aborted).toBe(true);
    expect(poller.state).toBe("backoff");
    await advance(2_999);
    expect(server.fetchStatus).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(server.fetchStatus).toHaveBeenCalledTimes(2); // 3 s backoff after the timeout
  });
});

describe("hidden tab", () => {
  it("doesn't poll while hidden, and polls at once when visible again", async () => {
    const { server, poller, setHidden } = setup({ hidden: true });
    poller.start();
    await advance(60_000);
    expect(server.fetchStatus).toHaveBeenCalledTimes(0);
    expect(poller.state).toBe("paused");
    setHidden(false);
    await advance(0);
    expect(server.fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending poll when the tab is hidden", async () => {
    const { server, poller, setHidden } = setup();
    poller.start();
    await advance(2_000);
    setHidden(true);
    await advance(30_000);
    expect(server.fetchStatus).toHaveBeenCalledTimes(0);
  });

  it("lets a running request finish while hidden but schedules nothing after it", async () => {
    const { server, poller, setHidden } = setup();
    poller.start();
    await advance(3_000);
    setHidden(true);
    await server.answer(server.ok("PENDING"));
    await advance(30_000);
    expect(server.fetchStatus).toHaveBeenCalledTimes(1);
    expect(poller.state).toBe("paused");
  });
});

describe("no overlap on tab switching", () => {
  it("re-showing the tab while a request runs doesn't start a second one", async () => {
    const { server, poller, setHidden } = setup();
    poller.start();
    await advance(3_000); // request 1 running
    setHidden(true);
    setHidden(false);
    setHidden(true);
    setHidden(false);
    await advance(0);
    expect(server.fetchStatus).toHaveBeenCalledTimes(1);
    await server.answer(server.ok("PENDING")); // its completion schedules the next poll
    await advance(3_000);
    expect(server.fetchStatus).toHaveBeenCalledTimes(2);
  });
});

describe("429 and errors", () => {
  it("waits exactly the server's Retry-After", async () => {
    const { server, poller } = setup();
    poller.start();
    await advance(3_000);
    await server.answer({ kind: "rate-limited", retryAfterSeconds: 7 });
    await advance(6_999);
    expect(server.fetchStatus).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(server.fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps honouring Retry-After when the tab is refocused early", async () => {
    const { server, poller, setHidden } = setup();
    poller.start();
    await advance(3_000);
    await server.answer({ kind: "rate-limited", retryAfterSeconds: 20 });
    setHidden(true);
    await advance(5_000);
    setHidden(false); // 15 s of the 20 s wait remain
    await advance(14_999);
    expect(server.fetchStatus).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(server.fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("falls back to the backoff when Retry-After is missing", async () => {
    const { server, poller } = setup();
    poller.start();
    await advance(3_000);
    await server.answer({ kind: "rate-limited", retryAfterSeconds: null });
    await advance(3_000);
    expect(server.fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("backs off 3 → 6 → 12 → 24 → 30 → 30 s on errors, and resets after a success", async () => {
    const { server, poller } = setup();
    poller.start();
    await advance(3_000);
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      await server.answer({ kind: "error" });
      const before = server.fetchStatus.mock.calls.length;
      let waited = 0;
      while (server.fetchStatus.mock.calls.length === before) {
        await advance(1_000);
        waited += 1_000;
      }
      gaps.push(waited);
    }
    expect(gaps).toEqual([3_000, 6_000, 12_000, 24_000, 30_000, 30_000]);
    await server.answer(server.ok("PENDING"));
    await advance(3_000);
    expect(server.fetchStatus).toHaveBeenCalledTimes(8); // back to the 3 s cadence
    await server.answer({ kind: "error" }); // the next error starts again at 3 s, not 30 s
    await advance(3_000);
    expect(server.fetchStatus).toHaveBeenCalledTimes(9);
  });
});

describe("status changes and stopping", () => {
  it("reports only changes: PENDING → CONFIRMING → PAID, then stops", async () => {
    const { server, poller, onStatus } = setup();
    poller.start();
    for (const status of ["PENDING", "CONFIRMING", "CONFIRMING", "PAID"] as const) {
      await advance(3_000);
      await server.answer(server.ok(status));
    }
    expect(onStatus.mock.calls).toEqual([["CONFIRMING", "PENDING"], ["PAID", "CONFIRMING"]]);
    expect(poller.state).toBe("stopped");
    await advance(60_000);
    expect(server.fetchStatus).toHaveBeenCalledTimes(4);
  });

  it("stops at FAILED", async () => {
    const { server, poller } = setup();
    poller.start();
    await advance(3_000);
    await server.answer(server.ok("FAILED"));
    expect(poller.state).toBe("stopped");
  });

  it("keeps polling an EXPIRED invoice within 5 minutes after expiry, and reports a last-second payment", async () => {
    const { server, poller, onStatus } = setup({ expiresInMs: 1_000 });
    poller.start();
    await advance(3_000);
    await server.answer(server.ok("EXPIRED"));
    expect(poller.state).toBe("active"); // not final yet
    await advance(3_000);
    await server.answer(server.ok("PAID")); // detected during the grace period
    expect(onStatus.mock.calls).toEqual([["EXPIRED", "PENDING"], ["PAID", "EXPIRED"]]);
    expect(poller.state).toBe("stopped");
  });

  it("stops 5 minutes after expiry", async () => {
    const { server, poller } = setup({ expiresInMs: 0 });
    poller.start();
    while (poller.state !== "stopped" && Date.now() < T0 + 10 * 60_000) {
      await advance(3_000);
      if (server.calls.length && !server.calls.at(-1)!.signal.aborted) await server.answer(server.ok("EXPIRED")).catch(() => {});
    }
    expect(poller.state).toBe("stopped");
    expect(Date.now()).toBeLessThanOrEqual(T0 + POLLING.postExpiryWindowMs + 3_000);
  });

  it("stops on 404", async () => {
    const { server, poller } = setup();
    poller.start();
    await advance(3_000);
    await server.answer({ kind: "not-found" });
    expect(poller.state).toBe("stopped");
  });

  it("doesn't start for an invoice that is already final", async () => {
    const { server, poller } = setup({ initialStatus: "PAID" });
    poller.start();
    await advance(30_000);
    expect(server.fetchStatus).not.toHaveBeenCalled();
    expect(poller.state).toBe("stopped");
  });

  it("stop() aborts the running request and nothing follows", async () => {
    const { server, poller, onStatus } = setup();
    poller.start();
    await advance(3_000);
    poller.stop();
    expect(server.calls[0]!.signal.aborted).toBe(true);
    await advance(60_000);
    expect(server.fetchStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).not.toHaveBeenCalled();
  });
});

describe("a response arriving after stop()", () => {
  it("is ignored even if the request didn't honour the abort", async () => {
    let answer: (r: FetchResult) => void = () => {};
    const onStatus = vi.fn();
    const poller = createStatusPoller({
      fetchStatus: () => new Promise<FetchResult>((resolve) => (answer = resolve)), // ignores the signal
      initialStatus: "PENDING",
      expiresAt: new Date(T0 + 30 * 60_000),
      onStatus,
    });
    poller.start();
    await advance(3_000);
    poller.stop();
    answer({ kind: "ok", status: "PAID" });
    await advance(60_000);
    expect(onStatus).not.toHaveBeenCalled();
    expect(poller.state).toBe("stopped");
  });
});

describe("readStatusResponse", () => {
  const response = (status: number, body?: unknown, headers?: Record<string, string>) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

  it.each<[string, Response, FetchResult]>([
    ["200 with a status", response(200, { status: "PAID", expiresAt: "x", confirmation: null }), { kind: "ok", status: "PAID" }],
    ["200 with an unknown status", response(200, { status: "HACKED" }), { kind: "error" }],
    ["404", response(404, { error: {} }), { kind: "not-found" }],
    ["429 with Retry-After", response(429, {}, { "retry-after": "12" }), { kind: "rate-limited", retryAfterSeconds: 12 }],
    ["429 without Retry-After", response(429, {}), { kind: "rate-limited", retryAfterSeconds: null }],
    ["503", response(503, {}), { kind: "error" }],
  ])("%s", async (_, res, expected) => {
    expect(await readStatusResponse(res)).toEqual(expected);
  });
});
