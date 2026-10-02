# Payment flow

How a USDC payment moves through SolanaPay Checkout. Sections are filled in as each
phase is implemented; nothing below "planned" exists yet.

## Overview

    Merchant                     Server                               Customer / Solana
    ────────                     ──────                               ─────────────────
    Create invoice ─────────────▶ validate, fix payment terms,
                                  store PENDING invoice          (Phase 6: implemented)
                                  build Solana Pay URL + QR ────▶ scan / open link      (Phase 7: implemented)
                                  build unsigned tx (stored terms) ◀─ wallet POSTs account (Phase 7b: implemented)
                                                                  wallet signs USDC
                                                                  transfer + reference  (Phase 8: planned in-browser)
                                  find tx by reference,
                                  verify against stored invoice
                                  CONFIRMING → PAID              ◀── confirmed / finalized (Phase 9: implemented;
                                                                     automatic detection: Phase 10)

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
## 4b. Transaction Request: the primary payment path (Phase 7b: implemented)

Spec: `SPEC.md`, "Transaction Request". The QR contains only a link to our server:

    solana:https://<app>/api/pay/<invoice id>/transaction

| Step | Who | What |
|---|---|---|
| 1 | Wallet | `GET` → `{ label: merchant name, icon: <app>/solana-pay-icon.svg }` |
| 2 | Wallet | `POST { "account": "<customer wallet>" }` |
| 3 | Server | Loads the invoice by ID; checks effective status PENDING and ≥ 120 s before expiry; validates the account (on-curve wallet, not the merchant's payout wallet) |
| 4 | Server | `buildPaymentTransaction(storedInvoice, account, blockhash)` → unsigned v0 transaction; responds `{ transaction, message }` |
| 5 | Wallet | Shows the transaction, the customer approves, the wallet signs and sends it |

The transaction (`src/lib/payments/transaction-request.ts`):
1. Associated Token `CreateIdempotent` for the merchant's USDC account (customer pays
   rent only if it doesn't exist yet).
2. Token `TransferChecked` of exactly `invoice.amount` with `invoice.token_decimals`,
   from the customer's USDC account to the merchant's, with `invoice.reference`
   appended as a **read-only, non-signer** account.

The customer is the fee payer and the **only signer**; the signature slot is empty.
The server holds no keys and never signs.

**Invariant, enforced by the interface:** the builder takes the stored invoice row
and the customer account, nothing else. The POST body schema reads only `account`;
any other field (`amount`, `recipient`, `mint`, `reference`, ...) is dropped. A test
sends injected terms and asserts the transaction is byte-for-byte identical.

**Serving a transaction proves nothing.** The wallet may modify it or never send it,
and the invoice stays PENDING. Only on-chain verification (Phase 9) can mark it paid.

**Which link is primary** (`paymentLinks()`):
- App URL is **HTTPS**: the QR and "Open in wallet" use the transaction request; the
  plain transfer link is offered as a fallback ("Wallet doesn't support this QR code?").
- App URL is **http** (local development): the transfer request, because the spec
  requires HTTPS for transaction requests. Phone testing uses a temporary tunnel
  (see devnet-testing.md).

### Phone test result (2026-10-01)

A throwaway prototype (same transaction, outside the repo, temporary cloudflared quick
tunnel) was scanned with **Phantom on Android** (devnet): it called GET and POST,
showed the label, icon and domain, and sent the transaction **unchanged, with the
reference**: signature
`5YcPT4Vsh4bUrU1mcuQaff18oTgAVxM5WjpSMFiYqZGQ3ixJpy9oktiWdxYapWagsq2MzJ9RHVmufPUPufALPywi`,
found with `getSignaturesForAddress(reference)`.

Findings that shaped the implementation and Phase 9:
1. Phantom sends **GET and POST concurrently**, so POST never depends on GET.
2. **Every scan is a new POST**, so one invoice can produce several valid transactions
   with the same reference. If more than one lands, Phase 9 must settle the invoice
   once and record the others as duplicates for refund, never "paid twice".
3. RPC `jsonParsed` output labels the appended reference as a `multisigAuthority`
   signer of `transferChecked`. That is a parser artefact (the account is read-only and
   didn't sign). Phase 9 verification must use raw account keys and token balance
   changes, not the parsed authority fields.
4. Phantom showed our `label` as the message (not our `message` field), the devnet
   mint as "Unknown" (no token metadata on devnet), and "This domain is new" for the
   tunnel domain.

**Real-app test (Step 4, same day):** the implemented endpoint, scanned from the
checkout page through a temporary tunnel, produced
`39m866ogKRdHeuqrePGz7TwXrr3u1bcUsc5eaH2QrxtEUnPyDHR9pycmCCEfj1zd65HqzE2sRKCpJnga8emL9YE3`,
found by the invoice's stored reference and matching every stored term. An earlier
scan of the same invoice was approved but never landed; a prompt rescan worked
(details and the unconfirmed blockhash-expiry explanation in devnet-testing.md §6).
Phase 9 must expect a transaction to be served and never land.

Only Phantom on Android has been tested; other wallets are unverified.

## 5. In-browser payment (Phase 8: planned)
## 6. Verification (Phase 9: implemented)

**Never paid on the browser's word.** An invoice becomes PAID only when the server
finds the transaction on-chain itself and it matches the **stored** invoice. A wallet
saying "sent", a returned signature, or a signature a user pastes is at most a lookup
key.

### What counts as a payment

`src/lib/payments/verify-payment.ts` (pure functions, unit-tested on real devnet
transactions saved in `tests/fixtures/solana/`). The transaction is read in raw
`json` encoding (not `jsonParsed`, whose token parser mislabels a reference as a
multisig signer), with each account's signer/writable role resolved from the header,
including v0 address lookup tables.

1. **Did it credit the merchant?** (`readIncomingTransfer`) The transaction succeeded,
   and the net balance change of the merchant's token account is positive. That account
   is the ATA of the **stored** recipient wallet for the **stored** mint under the
   classic Token program (the Solana Pay spec allows no other account). Otherwise the
   transaction is irrelevant: wrong recipient, mint, Token-2022 or failed.
2. **Does it settle this invoice?** (`matchInvoice`) Exactly one top-level Token
   `Transfer`/`TransferChecked` into that account carries the invoice's reference as a
   **read-only, non-signer** account (TransferChecked: mint and 6 decimals checked), and
   **both** that instruction's amount **and** the net credit equal the stored amount
   (exact; decision 2026-10-02). Signer accounts never count as references: Phantom
   appends its own signer to the transfer.
3. **Network:** the RPC's genesis hash must be the configured cluster's
   (`GENESIS_HASH`, checked once per process); the invoice's network must match.
4. **Finality:** `confirmed` → payment CONFIRMED, invoice **CONFIRMING**; `finalized` →
   FINALIZED, invoice **PAID** (`paid_at`). A later check upgrades CONFIRMED → FINALIZED.
5. **Late:** block time after `expires_at` (or unknown) → still settles (the money
   arrived), with `late = true` and a "Paid late" badge for review (decision A).

The transfer doesn't have to be the last instruction (a rule for wallets building
transactions); what matters is reference, destination and amount on the same
instruction plus an exact net credit, which rules out tricks with extra instructions.

### Recording: exactly once

`checkInvoicePayment` (`src/lib/payments/check-payment.ts`): signatures for the stored
reference, oldest first, failed ones skipped; for each, one database transaction with
the invoice row locked (`SELECT … FOR UPDATE`).

| Finding | Recorded as |
|---|---|
| Settles, invoice PENDING | `payments` row; PENDING → CONFIRMING (→ PAID if finalized), via `assertTransition`, audited |
| Already recorded, now finalized | CONFIRMED → FINALIZED; CONFIRMING → PAID |
| Settles, but the invoice already has a payment | unmatched `DUPLICATE_PAYMENT` (never paid twice) |
| Reference present, amount not exact | unmatched `AMOUNT_MISMATCH`; invoice stays PENDING |
| Invoice EXPIRED/FAILED in the database | unmatched `INVOICE_NOT_PAYABLE` |
| Found by the reference, not on a valid transfer | unmatched `NO_REFERENCE` / `UNKNOWN_REFERENCE` (or left to the merchant's invoice whose reference it carries) |
| Doesn't credit the merchant | nothing |
| Not yet visible at `confirmed` (e.g. served by a transaction request, never sent) | nothing; a later check sees it if it lands |

Re-running is always safe. Concurrent checks serialize on the row lock, and the
database independently guarantees one record per transaction (unique signatures plus a
cross-table trigger under an advisory lock; a test runs 10 checks at once). Payment and
unmatched evidence is immutable (see database.md).

### Unmatched payments (suspense)

Real USDC that reached the merchant but can't settle an invoice automatically. Listed
under **Unmatched payments** (open count in the navigation) with a plain-language
reason. The merchant handles it outside the app (refund, or accept it against an
invoice manually) and marks it **resolved with a note**: final and audited, so write a
note that will still make sense later. Assigning an entry to an invoice from the app is
deliberately not offered (manual matching of money is risky; decision 2026-10-02).

### Triggers (Phase 9)

- **Check for payment** on the invoice page (`POST /api/invoices/[id]/verify`).
- **Look up a transaction** (`POST /api/payments/lookup {signature}`): verifies a
  transaction against the merchant's payout wallet and Circle's USDC. Not paying the
  merchant: rejected, nothing recorded. Carrying one of the merchant's references: that
  invoice is checked. Otherwise: unmatched.
- Automatic detection (polling, expiry) is Phase 10.

### Verified on devnet (2026-10-02)

- INV-2026-00017 → **PAID** from its phone payment
  `39m866ogKRdHeuqrePGz7TwXrr3u1bcUsc5eaH2QrxtEUnPyDHR9pycmCCEfj1zd65HqzE2sRKCpJnga8emL9YE3` (finalized; not late), via Check for payment.
- Phantom's reference-less payment `5txudqhx…` (Phase 7 field finding) → recorded as
  `NO_REFERENCE` via lookup, then resolved.
- The customer page shows "Payment confirmed" with signature and Explorer link, without
  the payer's wallet.

## 7. Detection and expiry (Phase 10: planned)
