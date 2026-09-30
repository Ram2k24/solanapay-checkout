import { createHash } from "node:crypto";

// SHA-256 of a request's normalized fields, used for idempotency: a retried
// request with the same Idempotency-Key must have the same hash. Keys are sorted
// so the hash doesn't depend on property order.
export function hashRequest(fields: Record<string, string | number | null>): string {
  const canonical = JSON.stringify(Object.keys(fields).sort().map((key) => [key, fields[key]]));
  return createHash("sha256").update(canonical).digest("hex");
}
