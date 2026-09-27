import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/config/server-env";

// Liveness check for monitoring. Phase 3 adds a database check.
// Exposes no secrets: only status, network and server time.
export function GET() {
  return NextResponse.json({
    status: "ok",
    network: serverEnv.network,
    time: new Date().toISOString(),
  });
}
