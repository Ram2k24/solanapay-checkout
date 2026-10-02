import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/config/server-env";
import { ApiError } from "./api";

// Internal jobs (the reconciler) authenticate with `Authorization: Bearer <CRON_SECRET>`.
// Both values are hashed first so the comparison is constant-time and length-independent:
// response timing reveals nothing about how much of a guess was right.
export function assertCronSecret(request: Request): void {
  const match = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!match || !timingSafeEqual(digest(match[1]!), digest(serverEnv.CRON_SECRET))) {
    throw new ApiError("InvalidCredentials");
  }
}
