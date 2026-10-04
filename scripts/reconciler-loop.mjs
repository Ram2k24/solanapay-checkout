// Development helper: runs the reconciler every 30 s by calling its endpoint, the same
// way a production scheduler will (Phase 15). Each run finishes before the next wait
// starts, so runs never overlap. Ctrl+C stops it after the current run.
//
// Usage:  npm run reconciler        (with the dev server running)
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

if (existsSync(".env")) process.loadEnvFile(".env");
if (process.env.APP_ENV === "production") {
  console.error("Refusing to run: this loop is for development. Use the host's scheduler in production.");
  process.exit(1);
}
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set in .env");
  process.exit(1);
}
const url = new URL("/api/internal/reconcile", process.env.RECONCILER_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
const INTERVAL_MS = 30_000;

const stop = new AbortController();
process.on("SIGINT", () => {
  console.log("\nStopping after the current run…");
  stop.abort();
});

console.log(`Reconciler loop: POST ${url.href} every ${INTERVAL_MS / 1000} s (Ctrl+C to stop)`);
while (!stop.signal.aborted) {
  const time = new Date().toISOString().slice(11, 19);
  try {
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(120_000) });
    const body = await response.json().catch(() => null);
    if (response.ok) {
      const { claimed, checked, confirming, paid, expired, unmatched, budgetDeferred, rpcErrors, aborted, durationMs, cleanup } = body;
      const cleaned = cleanup?.error
        ? " cleanup=FAILED"
        : cleanup && cleanup.nonces + cleanup.sessions + cleanup.rateLimits > 0
          ? ` cleaned=${cleanup.nonces}n/${cleanup.sessions}s/${cleanup.rateLimits}r`
          : "";
      console.log(
        `${time} claimed=${claimed} checked=${checked} confirming=${confirming} paid=${paid} expired=${expired} ` +
          `unmatched=${unmatched} deferred=${budgetDeferred} rpcErrors=${rpcErrors}${aborted ? " ABORTED (wrong cluster)" : ""} ${durationMs}ms${cleaned}`,
      );
    } else {
      console.log(`${time} HTTP ${response.status} ${body?.error?.code ?? ""}`);
    }
  } catch (error) {
    console.log(`${time} request failed: ${error instanceof Error ? error.message : error}`);
  }
  await sleep(INTERVAL_MS, undefined, { signal: stop.signal }).catch(() => {});
}
