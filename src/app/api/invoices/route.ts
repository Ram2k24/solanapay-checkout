import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseJsonBody } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { assertSameOrigin } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { requireMerchant } from "@/lib/merchant/require-merchant";
import { createInvoice } from "@/lib/payments/create-invoice";
import { toInvoiceDto } from "@/lib/payments/invoice-dto";
import { LIST_STATUSES, listInvoices } from "@/lib/payments/list-invoices";
import { AUTO_ORDER_ID_PATTERN } from "@/lib/payments/invoice-number";
import { INVOICE_EXPIRY_MINUTES, INVOICE_TEXT_LIMITS } from "@/lib/payments/policy";

const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;

// Optional text: trimmed; empty becomes null; no control characters.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .regex(NO_CONTROL_CHARS, "Contains invalid characters.")
    .nullish()
    .transform((value) => value || null);

// Strict: any other field (tokenMint, recipientWallet, network, status, ...) is a 400.
const createSchema = z.strictObject({
  amount: z.string().max(32),
  // Blank: the server generates ORD-YYYY-NNNNN. That format is reserved for generated IDs.
  orderId: optionalText(INVOICE_TEXT_LIMITS.orderId).refine(
    (value) => value === null || !AUTO_ORDER_ID_PATTERN.test(value),
    "The ORD-YYYY-NNNNN format is reserved for automatic order IDs. Leave the field blank to get one.",
  ),
  description: optionalText(INVOICE_TEXT_LIMITS.description),
  customerReference: optionalText(INVOICE_TEXT_LIMITS.customerReference),
  expiresInMinutes: z
    .number()
    .int("Whole minutes only.")
    .min(INVOICE_EXPIRY_MINUTES.min, `At least ${INVOICE_EXPIRY_MINUTES.min} minutes.`)
    .max(INVOICE_EXPIRY_MINUTES.max, `At most ${INVOICE_EXPIRY_MINUTES.max} minutes (24 hours).`)
    .default(INVOICE_EXPIRY_MINUTES.default),
});

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,64}$/;

export const POST = route("invoices.create", async (request, { log }) => {
  assertSameOrigin(request);
  const { session, merchant, payoutWallet } = await requireMerchant(request);
  await enforceRateLimit(`invoices:create:${merchant.id}`, 30, 60);

  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey !== null && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new ApiError("InvalidRequest", { "Idempotency-Key": "Use 1-64 letters, digits, '-' or '_'." });
  }

  const input = await parseJsonBody(request, createSchema);
  const { invoice, created } = await createInvoice(
    { id: merchant.id, userId: session.userId, payoutWallet },
    input,
    idempotencyKey,
  );

  log.info({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, replayed: !created }, created ? "invoice created" : "invoice replayed");
  return NextResponse.json(toInvoiceDto(invoice), {
    status: created ? 201 : 200,
    headers: created ? undefined : { "idempotent-replayed": "true" },
  });
});

const listQuery = z.strictObject({
  status: z.enum(LIST_STATUSES).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const GET = route("invoices.list", async (request) => {
  const { merchant } = await requireMerchant(request);
  const query = listQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) throw new ApiError("InvalidRequest");

  const { invoices, nextCursor } = await listInvoices(merchant.id, query.data);
  return NextResponse.json({ invoices: invoices.map((i) => toInvoiceDto(i)), nextCursor });
});
