import type { Payment } from "@/generated/prisma/client";
import { USDC_DECIMALS } from "@/lib/config/networks";
import { formatUnits } from "@/lib/money/format";

// CSV of verified payments (Phase 12 export, decision D4). RFC 4180: every cell quoted,
// quotes doubled, CRLF line ends, UTF-8 with a byte-order mark so spreadsheet apps read
// it as UTF-8. Cells that a spreadsheet would run as a formula (starting with = + - @,
// tab or CR) get a leading apostrophe: order IDs are merchant-supplied text, so a value
// like =HYPERLINK(...) must open as plain text.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | bigint | boolean | null): string {
  const text = value === null ? "" : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export const CSV_COLUMNS = [
  "block_time_utc", "invoice_number", "order_id", "amount_usdc", "amount_base_units", "status", "paid_late",
  "sender_wallet", "recipient_wallet", "recipient_token_account", "token_mint", "reference", "network", "slot",
  "signature", "verified_at_utc", "finalized_at_utc", "payment_id",
] as const;

type Row = Payment & { invoice: { invoiceNumber: string; orderId: string | null } };

export function paymentsCsv(payments: Row[]): string {
  const lines = [CSV_COLUMNS.map(csvCell).join(",")];
  for (const p of payments) {
    lines.push(
      [
        p.blockTime?.toISOString() ?? null, p.invoice.invoiceNumber, p.invoice.orderId, formatUnits(p.amount, USDC_DECIMALS),
        p.amount, p.commitment === "FINALIZED" ? "finalized" : "confirming", p.late, p.senderWallet, p.recipientWallet,
        p.recipientTokenAccount, p.tokenMint, p.reference, p.network.toLowerCase(), p.slot, p.signature,
        p.verifiedAt.toISOString(), p.finalizedAt?.toISOString() ?? null, p.id,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
