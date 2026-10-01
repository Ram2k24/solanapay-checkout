import "server-only";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/log/logger";
import { ApiError, errorResponse } from "./api";

type RouteContext<P> = { log: typeof logger; requestId: string; params: P };

// Wraps a route handler with a request ID, a request-scoped logger and uniform
// error handling: known ApiErrors become safe JSON errors; anything else is logged
// with full details and returned as a generic error (no internals leak to clients).
// `P` is the shape of dynamic URL segments, e.g. { id: string } for /api/invoices/[id].
// Next.js passes them as a Promise in the second argument; the wrapper awaits them.
export function route<P extends Record<string, string> = Record<string, never>>(
  name: string,
  handler: (request: NextRequest, ctx: RouteContext<P>) => Promise<Response>,
) {
  return async (request: NextRequest, segment?: { params: Promise<P> }): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const log = logger.child({ requestId, route: name });

    let response: Response;
    try {
      const params = segment ? await segment.params : ({} as P);
      response = await handler(request, { log, requestId, params });
    } catch (error) {
      if (error instanceof ApiError) {
        log.info(
          { code: error.code, fields: error.fields ? Object.keys(error.fields) : undefined, err: error.cause },
          "request rejected",
        );
        response = errorResponse(error.code, error.fields);
      } else if (isDatabaseUnavailable(error)) {
        log.error({ err: error }, "database unavailable");
        response = errorResponse("DatabaseUnavailable");
      } else {
        log.error({ err: error }, "unhandled error");
        response = errorResponse("InternalError");
      }
    }
    response.headers.set("x-request-id", requestId);
    response.headers.set("cache-control", "no-store");
    return response;
  };
}

// Prisma connection-level failures (P1xxx codes: can't reach server, timeouts, ...).
function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code.startsWith("P1");
}
