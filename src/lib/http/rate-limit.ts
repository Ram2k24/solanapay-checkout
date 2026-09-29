import "server-only";
import { db } from "@/lib/db/client";
import { ApiError } from "./api";

// Fixed-window rate limit stored in PostgreSQL (works on serverless, where
// in-memory counters are not shared between instances).
// Throws ApiError("RateLimited") when `key` exceeds `limit` requests per window.
export async function enforceRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`;

  if ((rows[0]?.count ?? 0) > limit) throw new ApiError("RateLimited");
}
