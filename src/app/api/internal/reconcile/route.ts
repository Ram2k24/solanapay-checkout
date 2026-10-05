import { NextResponse } from "next/server";
import { assertCronSecret } from "@/lib/http/cron-auth";
import { route } from "@/lib/http/route";
import { cleanupExpired, type CleanupSummary } from "@/lib/maintenance/cleanup";
import { runReconciler } from "@/lib/payments/reconciler";

// One reconciler run: detects payments and expires overdue invoices (chain first), then
// deletes expired challenges, ended sessions and old rate-limit windows (Phase 13).
// Called on a schedule: every 30 s by `npm run reconciler` in development, every 2 min by
// cron-job.org in production, with .github/workflows/reconcile.yml as backup (Phase 15). Not for browsers: no session,
// no Origin check; the CRON_SECRET bearer token is the only credential.
export const POST = route("internal.reconcile", async (request, { log }) => {
  assertCronSecret(request);
  const summary = await runReconciler(log);

  // Housekeeping never fails the payment work above: an error is logged and reported.
  let cleanup: CleanupSummary | { error: true };
  try {
    cleanup = await cleanupExpired();
    if (cleanup.nonces + cleanup.sessions + cleanup.rateLimits > 0) log.info({ ...cleanup }, "expired rows cleaned up");
  } catch (error) {
    log.warn({ err: error }, "cleanup failed; retried on the next run");
    cleanup = { error: true };
  }
  return NextResponse.json({ ...summary, cleanup });
});
