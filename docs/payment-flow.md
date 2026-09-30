# Payment flow

How a USDC payment moves through SolanaPay Checkout. Sections are filled in as each
phase is implemented; nothing below "planned" exists yet.

## Overview

    Merchant                     Server                               Customer / Solana
    ────────                     ──────                               ─────────────────
    Create invoice ─────────────▶ validate, fix payment terms,
                                  store PENDING invoice          (Phase 6: implemented)
                                  build Solana Pay URL + QR ────▶ scan / open link      (Phase 7: planned)
                                                                  wallet signs USDC
                                                                  transfer + reference  (Phase 8: planned)
                                  find tx by reference,
                                  verify against stored invoice
                                  CONFIRMING → PAID              ◀── confirmed / finalized (Phases 9–10: planned)

## 1. Invoice creation (Phase 6: implemented)

`POST /api/invoices`, merchant session required (Origin-checked, 30/min per merchant).

| The merchant chooses | The server decides |
|---|---|
| amount (decimal string, ≤ 6 decimals, ≤ `MAX_INVOICE_AMOUNT_USDC`) | network (config) |
| order ID (optional; blank → `ORD-YYYY-NNNNN`) | currency USDC, token mint (Circle allowlist), decimals 6 |
| description, customer reference (optional) | recipient = the merchant's default payout wallet |
| expiry: 5–1440 minutes (default 30) | reference = fresh random public key |
| | invoice number `INV-YYYY-NNNNN`, status `PENDING` |

The request schema is strict: sending any server-decided field (`tokenMint`,
`recipientWallet`, `network`, `status`, `reference`, ...) is rejected with 400.
Amounts are converted to integer base units (`"10.00"` → `10000000`) with string
and `bigint` arithmetic only.

One transaction: reserve invoice number (and order ID if blank) → insert invoice →
audit `invoice.created`.

**Idempotency** (`Idempotency-Key` header, optional): same key + same request →
the original invoice (200, `idempotent-replayed: true`); same key + different
request → 409 `IdempotencyConflict`; no key → a new invoice. Concurrent duplicates
are resolved by the database's unique index.

## 2. The stored-invoice invariant

**Every payment-critical value used later comes from the stored invoice, never from
a later browser request.** Phases 7–9 read `amount`, `token_mint`,
`token_decimals`, `recipient_wallet`, `network` and `reference` from the database.

Enforcement:
- The create API rejects client-supplied payment terms (strict schema, tested).
- A database trigger (`invoices_terms_immutable`) rejects any UPDATE of payment
  terms after creation. Only lifecycle fields (`status`, `paid_at`,
  `failure_reason`, `expires_at`, `updated_at`) can change.
- Payout wallets must be real wallets: valid, on the Ed25519 curve, and not a
  well-known program or mint address (a token account for those would be
  unrecoverable).

## 3. Lifecycle

    PENDING ──▶ CONFIRMING ──▶ PAID
       │             │
       ├──▶ EXPIRED  └──▶ FAILED
       └──▶ FAILED

All transitions go through `assertTransition()` (`src/lib/payments/invoice-state.ts`).
Until the expiry job exists (Phase 10), reads compute an **effective status**: a
PENDING invoice past `expires_at` is shown and filtered as EXPIRED. A CONFIRMING
invoice is never shown as expired: a payment seen before expiry completes.

## 4. Solana Pay link and QR (Phase 7: planned)
## 5. Customer payment (Phase 8: planned)
## 6. Verification and detection (Phases 9–10: planned)
