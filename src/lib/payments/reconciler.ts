import "server-only";
import { db } from "@/lib/db/client";
import type { logger } from "@/lib/log/logger";
import { checkInvoicePayment } from "./check-payment";
import { expireIfUnpaid } from "./expire-invoice";
import { takeRpcBudget } from "./public-status";
import { backoffAfter, CADENCE, nextCheckAt } from "./reconcile-schedule";

// The reconciler (Phase 10): finds invoices whose next check is due and runs the one
// verification path on them, so payments are detected and overdue invoices expire
// without anyone watching. It decides only WHEN to look; checkInvoicePayment and
// expireIfUnpaid decide what the chain means.
//
// Coordination: invoice_checks.lease_until. A run claims up to `batch` due rows in one
// statement (FOR UPDATE SKIP LOCKED), so concurrent runs never take the same invoice;
// a crashed run's leases simply expire. Correctness never depends on the lease: Phase 9's
// row locks and database rules guarantee exactly-once recording anyway.

export const RECONCILER = { batch: 25, parallelism: 3, leaseSeconds: 60 } as const;

export type ReconcileSummary = {
  claimed: number;
  checked: number; // successful chain checks
  confirming: number;
  paid: number;
  expired: number;
  unmatched: number;
  budgetDeferred: number; // left for the next run: the shared RPC budget ran out
  rpcErrors: number;
  stuckConfirming: number;
  aborted: boolean; // wrong cluster: the whole run stopped
  durationMs: number;
};

type Log = Pick<typeof logger, "info" | "warn" | "error">;
const ACTOR = { type: "SYSTEM" as const, id: "reconciler" };

// `now` pins the clock used for scheduling and the stuck-CONFIRMING warning (tests only).
export async function runReconciler(log: Log, options: { batch?: number; parallelism?: number; now?: Date } = {}): Promise<ReconcileSummary> {
  const started = Date.now();
  const summary: ReconcileSummary = {
    claimed: 0, checked: 0, confirming: 0, paid: 0, expired: 0, unmatched: 0,
    budgetDeferred: 0, rpcErrors: 0, stuckConfirming: 0, aborted: false, durationMs: 0,
  };

  const claimed = await claimDue(options.batch ?? RECONCILER.batch);
  summary.claimed = claimed.length;
  const queue = [...claimed];
  let stop = false; // budget exhausted or wrong cluster: release the rest

  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (stop) {
        await release(id);
        summary.budgetDeferred += summary.aborted ? 0 : 1;
        continue;
      }
      const result = await processOne(id, log, () => options.now ?? new Date());
      if (result === "budget") {
        stop = true;
        summary.budgetDeferred += 1;
      } else if (result === "wrong-cluster") {
        stop = true;
        summary.aborted = true;
        summary.rpcErrors += 1;
      } else if (result === "rpc-error") {
        summary.rpcErrors += 1;
      } else if (result) {
        summary.checked += result.checked ? 1 : 0;
        for (const key of ["confirming", "paid", "expired", "unmatched", "stuckConfirming"] as const) summary[key] += result[key];
      }
    }
  };
  await Promise.all(Array.from({ length: options.parallelism ?? RECONCILER.parallelism }, worker));

  summary.durationMs = Date.now() - started;
  log.info({ ...summary }, "reconciler run");
  return summary;
}

// Claims due, unleased rows in one statement. Rows another run is holding are skipped.
async function claimDue(batch: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ invoice_id: string }[]>`
    UPDATE invoice_checks
    SET lease_until = clock_timestamp() + make_interval(secs => ${RECONCILER.leaseSeconds}), updated_at = clock_timestamp()
    WHERE invoice_id IN (
      SELECT invoice_id FROM invoice_checks
      WHERE next_check_at <= clock_timestamp()
        AND (lease_until IS NULL OR lease_until < clock_timestamp())
      ORDER BY next_check_at
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED)
    RETURNING invoice_id`;
  return rows.map((r) => r.invoice_id);
}

const release = (invoiceId: string) =>
  db.invoiceCheck.update({ where: { invoiceId }, data: { leaseUntil: null } });

type Counts = { checked: boolean; confirming: number; paid: number; expired: number; unmatched: number; stuckConfirming: number };

async function processOne(invoiceId: string, log: Log, now: () => Date): Promise<Counts | "budget" | "rpc-error" | "wrong-cluster" | null> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { merchantId: true, status: true, createdAt: true, expiresAt: true, payment: { select: { verifiedAt: true } } },
  });
  if (!invoice) return null;
  const counts: Counts = { checked: false, confirming: 0, paid: 0, expired: 0, unmatched: 0, stuckConfirming: 0 };

  // Final states need no chain call: just stop scheduling them.
  const needsChain =
    invoice.status === "PENDING" ||
    invoice.status === "CONFIRMING" ||
    (invoice.status === "EXPIRED" && nextCheckAt(invoice, now()) !== null);
  if (!needsChain) {
    await recordSuccess(invoiceId, null);
    return counts;
  }

  if (!(await takeRpcBudget()).allowed) {
    await release(invoiceId);
    return "budget";
  }

  const ctx = { actor: ACTOR, log };
  try {
    let status = invoice.status;
    let recorded: { outcome: string }[] = [];
    if (status === "PENDING") {
      const expiry = await expireIfUnpaid(invoiceId, ctx); // chain-first; checks the chain if due
      if (expiry.outcome === "expired") counts.expired += 1;
      status = expiry.status;
      recorded = expiry.recorded;
      if (expiry.outcome === "not-due") {
        const check = await checkInvoicePayment({ invoiceId, merchantId: invoice.merchantId }, ctx);
        status = check.status;
        recorded = check.recorded;
      }
    } else {
      // CONFIRMING (finality) or EXPIRED (late-money watch: anything found is unmatched)
      const check = await checkInvoicePayment({ invoiceId, merchantId: invoice.merchantId }, ctx);
      status = check.status;
      recorded = check.recorded;
    }
    counts.checked = true;
    counts.unmatched += recorded.filter((r) => r.outcome.startsWith("unmatched-")).length;
    if (status === "CONFIRMING" && invoice.status !== "CONFIRMING") counts.confirming += 1;
    if (status === "PAID" && invoice.status !== "PAID") counts.paid += 1;

    if (status === "CONFIRMING" && invoice.payment && now().getTime() - invoice.payment.verifiedAt.getTime() > CADENCE.stuckConfirmingAfter) {
      counts.stuckConfirming += 1; // warn only: a confirmed payment is never failed automatically
      log.warn({ invoiceId, verifiedAt: invoice.payment.verifiedAt }, "invoice CONFIRMING for over 10 minutes; needs attention");
    }

    await recordSuccess(invoiceId, nextCheckAt({ ...invoice, status }, now()));
    return counts;
  } catch (error) {
    const wrongCluster = error instanceof Error && error.name === "WrongClusterError";
    await recordFailure(invoiceId, error);
    if (wrongCluster) {
      log.error({ err: error }, "reconciler stopped: SOLANA_RPC_URL serves the wrong cluster");
      return "wrong-cluster";
    }
    log.warn({ err: error, invoiceId }, "reconciler check failed; backing off");
    return "rpc-error";
  }
}

async function recordSuccess(invoiceId: string, next: Date | null) {
  await db.invoiceCheck.update({
    where: { invoiceId },
    data: { nextCheckAt: next, lastCheckedAt: new Date(), attempts: 0, lastError: null, leaseUntil: null },
  });
}

async function recordFailure(invoiceId: string, error: unknown) {
  const current = await db.invoiceCheck.findUniqueOrThrow({ where: { invoiceId }, select: { attempts: true } });
  const attempts = current.attempts + 1;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await db.invoiceCheck.update({
    where: { invoiceId },
    data: { attempts, lastError: message.slice(0, 500), nextCheckAt: new Date(Date.now() + backoffAfter(attempts)), leaseUntil: null },
  });
}
