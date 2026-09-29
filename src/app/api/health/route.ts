import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/server-env";
import { db } from "@/lib/db/client";
import { logger } from "@/lib/log/logger";

// Health check for monitoring: 200 when the app and database are reachable,
// 503 otherwise. Exposes no secrets or internal error details.
export async function GET() {
  let database: "ok" | "unavailable" = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "unavailable";
    logger.error({ err: error }, "health check: database unavailable");
  }

  const healthy = database === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "error", network: serverEnv.network, database, time: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
