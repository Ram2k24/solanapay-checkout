import "server-only";
import { Prisma, type Invoice } from "@/generated/prisma/client";
import { USDC_DECIMALS } from "@/lib/config/networks";
import { serverEnv } from "@/lib/config/server-env";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { parseAmount } from "@/lib/money/parse";
import { formatInvoiceNumber, formatOrderId, reserveSequence } from "./invoice-number";
import { generateReference } from "./reference";
import { hashRequest } from "./request-hash";

// What the merchant may choose. Everything payment-critical (network, token mint,
// decimals, recipient, reference, number, status) is decided here on the server.
export type CreateInvoiceInput = {
  amount: string; // decimal USDC, e.g. "10.00"
  orderId: string | null; // null: an ORD-YYYY-NNNNN ID is generated
  description: string | null;
  customerReference: string | null;
  expiresInMinutes: number;
};

type Merchant = { id: string; userId: string; payoutWallet: string };

const maxAmount = (() => {
  const parsed = parseAmount(serverEnv.MAX_INVOICE_AMOUNT_USDC, USDC_DECIMALS);
  if (!parsed.ok) throw new Error("MAX_INVOICE_AMOUNT_USDC is not a valid amount");
  return parsed.value;
})();

const AMOUNT_MESSAGES = {
  format: "Enter an amount like 10 or 10.50.",
  "too-many-decimals": `USDC supports at most ${USDC_DECIMALS} decimal places.`,
  "not-positive": "The amount must be greater than zero.",
  "too-large": `The maximum invoice amount is ${serverEnv.MAX_INVOICE_AMOUNT_USDC} USDC.`,
} as const;

const NETWORK = { devnet: "DEVNET", testnet: "TESTNET", mainnet: "MAINNET" } as const;

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  // Prisma reports the violated constraint's fields in meta; match loosely across driver adapters.
  return JSON.stringify(error.meta ?? {}).includes(field);
}

// Creates a PENDING invoice. With an idempotency key, a retry of the same request
// returns the original invoice (`created: false`); a different request with the same
// key is rejected with IdempotencyConflict.
export async function createInvoice(
  merchant: Merchant,
  input: CreateInvoiceInput,
  idempotencyKey: string | null,
): Promise<{ invoice: Invoice; created: boolean }> {
  const amount = parseAmount(input.amount, USDC_DECIMALS, maxAmount);
  if (!amount.ok) throw new ApiError("InvalidRequest", { amount: AMOUNT_MESSAGES[amount.reason] });

  const requestHash = idempotencyKey
    ? hashRequest({
        amount: amount.value.toString(),
        orderId: input.orderId,
        description: input.description,
        customerReference: input.customerReference,
        expiresInMinutes: input.expiresInMinutes,
      })
    : null;

  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(merchant.id, idempotencyKey);
    if (existing) return replay(existing, requestHash);
  }

  const now = new Date();
  const reference = await generateReference();

  try {
    const invoice = await db.$transaction(async (tx) => {
      const year = now.getUTCFullYear();
      const invoiceNumber = formatInvoiceNumber(year, await reserveSequence(tx, merchant.id, "INVOICE", year));
      const orderId = input.orderId ?? formatOrderId(year, await reserveSequence(tx, merchant.id, "ORDER", year));
      const created = await tx.invoice.create({
        data: {
          merchantId: merchant.id,
          invoiceNumber,
          orderId,
          description: input.description,
          customerReference: input.customerReference,
          network: NETWORK[serverEnv.network],
          currency: "USDC",
          amount: amount.value,
          tokenMint: serverEnv.usdcMint,
          tokenDecimals: USDC_DECIMALS,
          recipientWallet: merchant.payoutWallet,
          reference,
          status: "PENDING",
          // Both timestamps from the same clock reading, so expires_at - created_at is exact.
          createdAt: now,
          expiresAt: new Date(now.getTime() + input.expiresInMinutes * 60_000),
          idempotencyKey,
          requestHash,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "USER",
          actorId: merchant.userId,
          action: "invoice.created",
          entityType: "invoice",
          entityId: created.id,
          data: { invoiceNumber: created.invoiceNumber, amount: created.amount.toString(), expiresAt: created.expiresAt.toISOString() },
        },
      });
      return created;
    });
    return { invoice, created: true };
  } catch (error) {
    // Two concurrent requests with the same key: the database's unique index lets only
    // one commit. The loser (whose counter increment was rolled back too) replays it.
    if (idempotencyKey && isUniqueViolation(error, "idempotency_key")) {
      const existing = await findByIdempotencyKey(merchant.id, idempotencyKey);
      if (existing) return replay(existing, requestHash);
    }
    throw error;
  }
}

function findByIdempotencyKey(merchantId: string, idempotencyKey: string) {
  return db.invoice.findUnique({ where: { merchantId_idempotencyKey: { merchantId, idempotencyKey } } });
}

function replay(existing: Invoice, requestHash: string | null) {
  if (existing.requestHash !== requestHash) throw new ApiError("IdempotencyConflict");
  return { invoice: existing, created: false };
}
