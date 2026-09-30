import type { CounterKind, Prisma } from "@/generated/prisma/client";

// Per merchant, per calendar year (UTC):
//   invoice numbers       INV-2026-00001
//   auto order IDs        ORD-2026-00001 (only when the merchant leaves Order ID blank)
export function formatInvoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(5, "0")}`;
}

export function formatOrderId(year: number, sequence: number): string {
  return `ORD-${year}-${String(sequence).padStart(5, "0")}`;
}

// Merchants can't type IDs in the auto-generated format; otherwise a hand-typed
// "ORD-2026-00007" could later collide with the automatic one.
export const AUTO_ORDER_ID_PATTERN = /^ORD-\d{4}-\d+$/i;

// Reserves the next sequence number for a merchant, counter kind and year. Must run
// inside the invoice-creation transaction: the upsert locks the counter row until
// commit, so concurrent creates are serialized and never get the same number.
export async function reserveSequence(
  tx: Prisma.TransactionClient,
  merchantId: string,
  kind: CounterKind,
  year: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO invoice_counters (merchant_id, kind, year, last_value)
    VALUES (${merchantId}::uuid, ${kind}::counter_kind, ${year}, 1)
    ON CONFLICT (merchant_id, kind, year) DO UPDATE SET last_value = invoice_counters.last_value + 1
    RETURNING last_value`;
  const value = rows[0]?.last_value;
  if (value === undefined) throw new Error("counter upsert returned no row");
  return value;
}
