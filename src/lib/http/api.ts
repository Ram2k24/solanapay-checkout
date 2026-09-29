import { NextResponse } from "next/server";
import type { z } from "zod";

// Error codes returned to clients. Messages are safe to show; internal details
// are only logged server-side.
export const API_ERRORS = {
  InvalidRequest: { status: 400, message: "The request is invalid." },
  Unauthenticated: { status: 401, message: "You are not signed in." },
  InvalidSignature: { status: 401, message: "The signature could not be verified." },
  ChallengeExpired: { status: 401, message: "The sign-in request expired or was already used. Please try again." },
  ForbiddenOrigin: { status: 403, message: "Request origin not allowed." },
  RateLimited: { status: 429, message: "Too many requests. Please wait and try again." },
  DatabaseUnavailable: { status: 503, message: "Service temporarily unavailable." },
  InternalError: { status: 500, message: "Something went wrong." },
} as const;

export type ApiErrorCode = keyof typeof API_ERRORS;

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(code);
  }
}

export function errorResponse(code: ApiErrorCode, headers?: HeadersInit) {
  const { status, message } = API_ERRORS[code];
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

// Parses a JSON body against a Zod schema; throws ApiError("InvalidRequest") on any problem.
export async function parseJsonBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("InvalidRequest");
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError("InvalidRequest");
  return result.data;
}
