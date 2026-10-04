import "server-only";
import { db } from "@/lib/db/client";

// Deletes short-lived rows nobody needs any more (Phase 13, decisions D1-D2): used or
// expired wallet challenges, ended sessions (they also hold IP address and user agent),
// and old rate-limit windows. Runs after each reconciler run. Never touches invoices,
// payments, unmatched entries, wallets or the audit log.
//
// Deletes in small batches (ctid ... LIMIT) so no statement holds locks for long, and
// stops after `maxBatches` per table; whatever is left goes on the next run.

export const RETENTION_MS = {
  nonceAfterExpiry: 24 * 60 * 60_000, // 1 day: long enough to investigate a failed sign-in
  sessionAfterEnd: 7 * 24 * 60 * 60_000, // 7 days after expiry or sign-out
  rateLimitWindow: 60 * 60_000, // 1 hour: the longest window is 60 s; sliding ones read one previous window
} as const;

export const CLEANUP = { batch: 1000, maxBatches: 5 } as const;

export type CleanupSummary = { nonces: number; sessions: number; rateLimits: number };

export async function cleanupExpired(options: { now?: Date; batch?: number; maxBatches?: number } = {}): Promise<CleanupSummary> {
  const now = (options.now ?? new Date()).getTime();
  const batch = options.batch ?? CLEANUP.batch;
  const maxBatches = options.maxBatches ?? CLEANUP.maxBatches;

  const nonceCutoff = new Date(now - RETENTION_MS.nonceAfterExpiry);
  const sessionCutoff = new Date(now - RETENTION_MS.sessionAfterEnd);
  const windowCutoff = new Date(now - RETENTION_MS.rateLimitWindow);

  const inBatches = async (deleteBatch: () => Promise<number>) => {
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const deleted = await deleteBatch();
      total += deleted;
      if (deleted < batch) break; // nothing more to delete
    }
    return total;
  };

  const nonces = await inBatches(() => db.$executeRaw`
    DELETE FROM auth_nonces WHERE ctid IN (
      SELECT ctid FROM auth_nonces WHERE expires_at < ${nonceCutoff} LIMIT ${batch})`);
  const sessions = await inBatches(() => db.$executeRaw`
    DELETE FROM sessions WHERE ctid IN (
      SELECT ctid FROM sessions WHERE expires_at < ${sessionCutoff} OR revoked_at < ${sessionCutoff} LIMIT ${batch})`);
  const rateLimits = await inBatches(() => db.$executeRaw`
    DELETE FROM rate_limits WHERE ctid IN (
      SELECT ctid FROM rate_limits WHERE window_start < ${windowCutoff} LIMIT ${batch})`);

  return { nonces, sessions, rateLimits };
}
