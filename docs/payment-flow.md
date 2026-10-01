# Payment flow

How a USDC payment moves through SolanaPay Checkout. Sections are filled in as each
phase is implemented; nothing below "planned" exists yet.

## Overview

    Merchant                     Server                               Customer / Solana
    ────────                     ──────                               ─────────────────
    Create invoice ─────────────▶ validate, fix payment terms,
                                  store PENDING invoice          (Phase 6: implemented)
                                  build Solana Pay URL + QR ────▶ scan / open link      (Phase 7: implemented)
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

## 4. Solana Pay link and QR (Phase 7: implemented)

`src/lib/payments/solana-pay.ts`, implemented from the official spec
(`solana-foundation/pay`, `typescript/packages/solana-pay/spec/SPEC.md`, Transfer Request):

    solana:<recipient_wallet>?amount=<user units>&spl-token=<token_mint>&reference=<reference>&label=<merchant name>&message=<invoice number · description>

- Built **only from the stored invoice row** (and the merchant name).
- Amount in user units with a leading zero and no exponent or separators
  (`10000000` base units → `10`, `10000` → `0.01`).
- `label`/`message` encoded with `encodeURIComponent` (space = `%20`, as in the spec).
- **No memo** (it would be stored publicly on-chain) and **no redirect** (SPEC 1.1, optional).
- Unit tests reproduce the spec's three example URLs exactly, and read back the QR payload.

**QR code:** rendered on the server as SVG (`qrcode`, error correction M); the
browser runs no QR code library.

**Merchant view** (`/invoices/[id]`): QR, customer checkout link, Solana Pay link.

**Public checkout** (`/pay/[id]`, no sign-in, `noindex`, 60 views/min per IP):
merchant name, amount, description, invoice number, order ID, shortened recipient,
network, expiry countdown, QR, "Open in wallet", "Copy payment link". Only
allowlisted columns are read (`getPublicCheckout`); the customer reference, merchant
email and internal IDs are never selected. Expired/paid/failed invoices show a status
message and **no** QR or payment link.

### Field finding: Phantom mobile dropped the reference (2026-10-01)

A devnet payment made by scanning our QR with **Phantom mobile** (Testnet Mode) was a
plain `transferChecked` of 1 USDC to the merchant **without the `reference`
account** (label and message weren't shown either):
signature `5txudqhxsvv45UCqodLLmtHih8jFQmQdfL9WyYY65AzmfT5bonfTNRxqUMZTLYMg7prNLMKXzfPNrpWTrRb4EaLX`.
`getSignaturesForAddress(reference)` therefore can't find it.

This is evidence about that wallet flow, not proof about all wallets. Decision
(option C):
1. **Transaction Requests** become the primary QR/payment path (Phase 7b): the wallet
   fetches a transaction built by our server from the stored invoice, so the
   reference is always included. Wallet support is verified from documentation and a
   phone test before implementation.
2. The transfer-request link stays as a fallback for basic wallets.
3. Phase 9 adds an **Unmatched payments** list: incoming USDC without a matching
   reference is recorded for merchant review (like a suspense account) and is
   **never** marked paid automatically. The transaction above is its first test case.
## 5. Customer payment (Phase 8: planned)
## 6. Verification and detection (Phases 9–10: planned)
