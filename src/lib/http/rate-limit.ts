import "server-only";
import { db } from "@/lib/db/client";
import { ApiError } from "./api";
import { slidingAllows, slidingRetryAfterMs } from "./sliding-window";

// Rate limits stored in PostgreSQL (the rate_limits table), so every application
// instance shares the same counters; nothing is kept in process memory.
//
// - fixed (default): one counter per window. Cheap; may allow up to 2x the limit across
//   a window boundary. Used for per-IP / per-user abuse limits. Denied requests count.
// - sliding: weighs the previous window too (see sliding-window.ts), so the limit holds
//   over any `windowSeconds` span. Used for budgets that must not be exceeded (e.g. our
//   RPC quota). Denied requests don't consume budget. Each key's check-and-increment is
//   serialized by a row lock, so concurrent instances can't overshoot together.
//
// retryAfterSeconds is the calculated earliest time a retry would be allowed.

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };
type Options = { sliding?: boolean; now?: Date };

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: Options = {},
): Promise<RateLimitResult> {
  return options.sliding
    ? consumeSliding(key, limit, windowSeconds * 1000, options.now)
    : consumeFixed(key, limit, windowSeconds * 1000, options.now ?? new Date());
}

// Throws ApiError("RateLimited") carrying Retry-After when `key` is over its limit.
export async function enforceRateLimit(key: string, limit: number, windowSeconds: number, options: Options = {}): Promise<void> {
  const result = await consumeRateLimit(key, limit, windowSeconds, options);
  if (!result.allowed) throw new ApiError("RateLimited", undefined, { retryAfterSeconds: result.retryAfterSeconds });
}

async function consumeFixed(key: string, limit: number, windowMs: number, now: Date): Promise<RateLimitResult> {
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, ${new Date(windowStart)}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`;
  const allowed = (rows[0]?.count ?? 0) <= limit;
  return { allowed, retryAfterSeconds: allowed ? 0 : toSeconds(windowStart + windowMs - now.getTime()) };
}

async function consumeSliding(key: string, limit: number, windowMs: number, fixedNow?: Date): Promise<RateLimitResult> {
  return db.$transaction(async (tx) => {
    // The database clock, so all instances agree on window boundaries (tests may pin it).
    const now = fixedNow ?? (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now;
    const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
    const elapsed = now.getTime() - windowStart;

    // Ensure the current window's row exists, then lock it: concurrent callers for this
    // key wait here in turn, so the check and the increment are one atomic step.
    await tx.$executeRaw`
      INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${new Date(windowStart)}, 0)
      ON CONFLICT (key, window_start) DO NOTHING`;
    const [current] = await tx.$queryRaw<{ count: number }[]>`
      SELECT count FROM rate_limits WHERE key = ${key} AND window_start = ${new Date(windowStart)} FOR UPDATE`;
    const [previous] = await tx.$queryRaw<{ count: number }[]>`
      SELECT count FROM rate_limits WHERE key = ${key} AND window_start = ${new Date(windowStart - windowMs)}`;
    const prev = previous?.count ?? 0;
    const curr = current?.count ?? 0;

    if (!slidingAllows(prev, curr, elapsed, windowMs, limit)) {
      return { allowed: false, retryAfterSeconds: toSeconds(slidingRetryAfterMs(prev, curr, elapsed, windowMs, limit)) };
    }
    await tx.$executeRaw`
      UPDATE rate_limits SET count = count + 1 WHERE key = ${key} AND window_start = ${new Date(windowStart)}`;
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

// Retry-After is whole seconds; round up so a client retrying on time is allowed.
function toSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}
