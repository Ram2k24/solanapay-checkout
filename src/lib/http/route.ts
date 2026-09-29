import "server-only";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/log/logger";
import { ApiError, errorResponse } from "./api";

type RouteContext = { log: typeof logger; requestId: string };

// Wraps a route handler with a request ID, a request-scoped logger and uniform
// error handling: known ApiErrors become safe JSON errors; anything else is logged
// with full details and returned as a generic error (no internals leak to clients).
export function route(name: string, handler: (request: NextRequest, ctx: RouteContext) => Promise<Response>) {
  return async (request: NextRequest): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const log = logger.child({ requestId, route: name });

    let response: Response;
    try {
      response = await handler(request, { log, requestId });
    } catch (error) {
      if (error instanceof ApiError) {
        log.info({ code: error.code }, "request rejected");
        response = errorResponse(error.code);
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
