import { NextResponse } from "next/server";
import type { z } from "zod";

// Error codes returned to clients. Messages are safe to show; internal details
// are only logged server-side.
export const API_ERRORS = {
  InvalidRequest: { status: 400, message: "The request is invalid." },
  InvalidAccount: { status: 400, message: "This wallet account can't be used for payment." },
  SelfPaymentNotAllowed: { status: 400, message: "This wallet receives the payment, so it can't pay this invoice." },
  InvalidRecipient: { status: 400, message: "This transaction doesn't send USDC to your payout wallet." },
  TransactionFailed: { status: 400, message: "This transaction failed on Solana, so no funds moved." },
  Unauthenticated: { status: 401, message: "You are not signed in." },
  InvalidSignature: { status: 401, message: "The signature could not be verified." },
  ChallengeExpired: { status: 401, message: "The sign-in request expired or was already used. Please try again." },
  ForbiddenOrigin: { status: 403, message: "Request origin not allowed." },
  MerchantProfileRequired: { status: 403, message: "Create your merchant profile first." },
  NotFound: { status: 404, message: "Not found." },
  TransactionNotFound: { status: 404, message: "Transaction not found on this network, or not confirmed yet." },
  MerchantAlreadyExists: { status: 409, message: "A merchant profile already exists for this account." },
  IdempotencyConflict: { status: 409, message: "This Idempotency-Key was already used with a different request." },
  PaymentAlreadyProcessed: { status: 409, message: "This entry has already been resolved." },
  InvoiceNotPayable: { status: 409, message: "This invoice can no longer be paid. Ask the merchant for a new payment link." },
  RateLimited: { status: 429, message: "Too many requests. Please wait and try again." },
  DatabaseUnavailable: { status: 503, message: "Service temporarily unavailable." },
  RpcUnavailable: { status: 503, message: "The Solana network could not be reached. Please try again." },
  InternalError: { status: 500, message: "Something went wrong." },
} as const;

export type ApiErrorCode = keyof typeof API_ERRORS;

// Per-field validation messages (field name -> message we wrote), for forms.
export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly fields?: FieldErrors,
    options?: ErrorOptions, // { cause }: the underlying error, logged server-side only
  ) {
    super(code, options);
  }
}

export function errorResponse(code: ApiErrorCode, fields?: FieldErrors, headers?: HeadersInit) {
  const { status, message } = API_ERRORS[code];
  return NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status, headers });
}

// Parses a JSON body against a Zod schema; throws ApiError("InvalidRequest") with
// per-field messages on any problem. Unknown fields are reported by name only.
export async function parseJsonBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError("InvalidRequest");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields: FieldErrors = {};
    for (const issue of result.error.issues) {
      if (issue.code === "unrecognized_keys") {
        for (const key of issue.keys) fields[key] = "This field is not accepted.";
      } else {
        fields[issue.path.join(".") || "body"] ??= issue.message;
      }
    }
    throw new ApiError("InvalidRequest", fields);
  }
  return result.data;
}
