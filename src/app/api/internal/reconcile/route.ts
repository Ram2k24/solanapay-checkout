import { NextResponse } from "next/server";
import { assertCronSecret } from "@/lib/http/cron-auth";
import { route } from "@/lib/http/route";
import { runReconciler } from "@/lib/payments/reconciler";

// One reconciler run: detects payments and expires overdue invoices (chain first).
// Called on a schedule (every 30 s) by `npm run reconciler` in development and by the
// host's scheduler in production (Phase 15). Not for browsers: no session, no Origin
// check; the CRON_SECRET bearer token is the only credential.
export const POST = route("internal.reconcile", async (request, { log }) => {
  assertCronSecret(request);
  return NextResponse.json(await runReconciler(log));
});
