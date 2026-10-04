# Security

SolanaPay Checkout handles payments, so security decisions are documented here as
they are implemented. Items marked **(planned)** are not built yet.

## Principles

- The application **never** requests, stores or uses private keys or seed phrases.
  Customers sign their own transactions in their own wallet.
- The backend never trusts client-reported payment status, amounts, recipients,
  token mints or networks (enforced from Phase 9).
- Secrets live only in server-side environment variables, validated at startup.

## Merchant authentication (Sign-In With Solana)

Connecting a wallet is **not** authentication. A merchant proves wallet ownership
by signing a one-time challenge:

1. `POST /api/auth/nonce {walletAddress}`: the server builds a
   [SIWS](https://github.com/phantom/sign-in-with-solana) message (domain, address,
   statement, URI, chain ID, nonce, issued/expiry time), stores it with a random
   256-bit nonce, and returns it. Valid for 5 minutes.
2. The wallet signs the message (`signMessage`).
3. `POST /api/auth/verify {nonce, signature}`: the server
   - consumes the nonce atomically (`UPDATE … WHERE used_at IS NULL AND expires_at > now()`),
     so it can't be replayed, even by concurrent requests;
   - verifies the Ed25519 signature over **its own stored copy** of the message,
     with the public key of the wallet the challenge was issued for;
   - in one transaction: upserts the user, creates a session, writes an audit log entry.

| Threat | Defense |
|---|---|
| Replay of a captured signature | Single-use, 5-minute nonce, consumed atomically |
| Tampered message / phishing | Server-built message bound to domain, wallet and chain ID; verified against the stored copy |
| Signature from another wallet | Verified with the challenge wallet's public key |
| Stolen `sessions` table | Only HMAC-SHA256(`AUTH_SECRET`, token) is stored |
| XSS reading the cookie | `HttpOnly` |
| CSRF | `SameSite=Lax` + Origin check on every state-changing request (403 otherwise) |
| Cookie over plain HTTP | `Secure` and the `__Host-` prefix whenever the app URL is HTTPS |
| Brute force / spam | 10 requests/minute/IP on nonce and verify (PostgreSQL-backed) |
| Logout not taking effect | Sessions are revoked server-side; old cookies stop working |
| Internal errors leaking | Clients get error codes only; details are logged with a request ID |

Sessions last 8 hours (absolute).

## Browser side (Phase 5)

- Connecting a wallet only shares a public address; the dashboard is authorized by
  the **server session**, checked on every request, never by browser state.
- The browser never sees the session token (HttpOnly cookie); it only asks
  `/api/auth/session` who is signed in.
- Wallet errors are shown as fixed, friendly messages; raw wallet errors are not displayed.
- If the connected wallet differs from the signed-in wallet, the UI warns and offers sign-out.
- Only wallets supporting the configured chain and `solana:signMessage` are listed.
- Balances count only Circle's USDC mint; the mint comes from shared config, not user input.
- The production client bundle was scanned for `AUTH_SECRET`/`CRON_SECRET` values: none present.

## Merchant data and invoices (Phase 6)

- **Authorization by query scoping:** every merchant query includes
  `merchant_id = <signed-in merchant>` in its WHERE clause. Another merchant's
  invoice returns **404**, not 403, so its existence isn't revealed.
- **Strict input schemas:** unknown fields are rejected (400), so clients can't
  smuggle payment terms (`tokenMint`, `recipientWallet`, `network`, `status`, ...).
- **Amounts** must be decimal strings (numbers/floats are rejected), ≤ 6 decimals,
  > 0 and ≤ `MAX_INVOICE_AMOUNT_USDC` (default 10,000).
- **Payout wallet validation:** valid address, on the Ed25519 curve (not a PDA or
  token account), and not the System/Token/Associated Token program or a USDC mint.
- **Immutable payment terms** (database trigger) and **idempotent creation**: see
  [payment-flow.md](payment-flow.md).
- Invoice creation is rate-limited (30/min per merchant) and audited.

## Public checkout (Phase 7)

- `/pay/[id]` needs no sign-in; the ID is an unguessable UUIDv7 (74 random bits).
- Reads only allowlisted columns; never exposes the customer reference, merchant
  email, internal IDs or idempotency data. `noindex, nofollow`.
- The payment link and QR are built from the stored invoice only, and only while the
  invoice is payable (effective status PENDING).
- Rate-limited per IP (60/min).

## Transaction Request endpoint (Phase 7b)

`GET/POST/OPTIONS /api/pay/[id]/transaction` is called by **wallets**, not by our pages.

- **No Origin (CSRF) check, by design.** CSRF abuses a browser's cookies; this
  endpoint reads no cookie or session, sets none, and changes no state. Wallets are
  not browsers and may send no Origin at all.
- **CORS `*` without credentials**, on every response including errors, so
  browser-based wallets can call it.
- **Input:** the invoice ID (path) and `account` (body). All payment terms come from the
  stored invoice; other body fields are dropped (see payment-flow.md, §4b).
- **Checks:** invoice payable (effective PENDING) with at least 120 s left; account is
  an on-curve wallet and not the merchant's own payout wallet.
- **Rate limits, counted independently:** POST 30/min per IP and 20/min per invoice
  (IP checked first, so a blocked IP doesn't use up the invoice's allowance); GET
  30/min per IP. Many IPs can still exhaust one invoice's 20/min for a minute; the
  customer then retries, or uses the basic link.
- **The server never signs** and serving a transaction is not evidence of payment.
- Logs the request ID, invoice ID and the customer's public address.

## Payment verification (Phase 9)

- **Server-side only:** status changes come from on-chain verification against the
  stored invoice (payment-flow.md §6), never from client input. Pasted signatures are
  lookup keys; the server fetches and checks the transaction itself.
- **Cluster check:** verification refuses to run unless the RPC's genesis hash is the
  configured network's.
- **Exactly once:** unique signatures, one payment per invoice, a cross-table trigger
  (payments vs unmatched), row locks; immutable, undeletable evidence.
- **No junk records:** a looked-up transaction that doesn't pay the merchant's wallet in
  USDC is rejected and not stored.
- **Routes** (session, Origin check, merchant scoping; another merchant's data is 404):
  verify 10/min per invoice, lookup 20/min per merchant, resolve 30/min per merchant.
- **Public data:** the checkout page shows the transaction signature and time once paid,
  never the payer's wallet.
- **Audit:** `payment.recorded`, `payment.finalized`, `invoice.status_changed`,
  `payment.unmatched`, `unmatched.resolved`, with actor and request ID.

## Automatic detection and expiry (Phase 10)

- **Status API** (`GET /api/pay/[id]/status`): public, reads no cookies, same-origin
  only, `no-store`. Exact response keys `status, expiresAt, confirmation`; never the
  merchant's data, the customer reference, the reference key or the payer's wallet
  (tested). 60/min per IP → 429 with `Retry-After`. A request can only make the server
  look at the chain sooner; the result comes from the chain and the stored invoice.
  Fail-soft: an RPC failure is logged and the stored status returned.
- **Rate limits are database-backed** (`rate_limits`), shared by every instance. Budgets
  that must not be exceeded use a sliding window, checked and incremented under a row
  lock; `Retry-After` is the calculated earliest retry. Every 429 now carries it.
- **One RPC budget** (35 `getSignaturesForAddress` per 10 s) for the status API and the
  reconciler, so customer traffic can't push us over the provider's limit or starve the
  reconciler (status API ≤ 20 per 10 s).
- **Reconciler endpoint** (`POST /api/internal/reconcile`): `Authorization: Bearer
  <CRON_SECRET>`, compared as SHA-256 digests with `timingSafeEqual`; anything else →
  401 `InvalidCredentials` and nothing runs. No session, no Origin check (not a browser
  endpoint). The development loop refuses to run with `APP_ENV=production` and never
  prints the secret.
- **Never expire without a successful chain check**; the expiry is a locked,
  re-checked, audited transition. Payments that land later are recorded as unmatched.
- **The browser is never the authority:** the checkout page only asks the server to
  re-render; the status it polls is display data.

## In-browser payment (Phase 8)

- **The browser is an initiator only.** It sends just the connected address to the
  Transaction Request endpoint (§ Phase 7b, unchanged: stored terms, limits, CORS) and
  hands the returned transaction to the wallet unmodified. No amount, mint, recipient
  or reference ever comes from the browser, and nothing it reports (a signature, "sent")
  changes an invoice; detection and verification are Phase 9/10's.
- **Checked before the wallet sees it:** the connected account must be the only signer
  (and therefore the fee payer) and the transaction still unsigned; anything else is
  refused (mutation-tested).
- **The customer's wallet signs** (`solana:signAndSendTransaction`); the server never
  holds or asks for keys. Customer messages are our own; wallet and server error text
  is never shown.
- **The cross-tab attempt note** (`localStorage`) is a per-browser convenience against
  accidental double payment. It holds no secrets and is validated on read (a forged
  note can at most hide the Pay button for 2 minutes or show an Explorer link for a
  well-formed signature). Duplicates from other devices are caught by Phase 9.
- The merchant's own payout wallet is refused as payer (`SelfPaymentNotAllowed`).

## Merchant dashboard and settings (Phase 11)

- **Dashboard figures come only from verified records**, scoped by the session's
  merchant (never by payout wallet, which two merchants may share; tested). USDC received
  counts FINALIZED payments only; unmatched money is never included. Payment rows show
  public on-chain data, never the invoice reference key.
- **Auto-refresh** re-renders the page from the database every 30 s while visible: no
  new endpoint, no Solana calls.
- **Profile** (`PATCH /api/merchant`): Origin check, merchant session, 20/min, strict
  schema (name, email only; a `payoutWallet` field is rejected, not ignored), audited
  with old and new values; the log records only which fields changed.
- **Payout wallet change** needs, besides the session, a **fresh signature by the
  signed-in wallet** (decision D5): `POST /api/merchant/payout-wallet/challenge` checks the
  address (format, on-curve, denylist, not the current one) and stores a `PAYOUT_CHANGE`
  challenge naming it; `POST /api/merchant/payout-wallet` consumes only a challenge of that
  purpose issued to the session's wallet (so nobody can use up another's), verifies the
  signature, re-checks the address, then switches the default under a row lock and
  audits `{from, to}`. 10/min each. A stolen session cookie alone can't redirect future
  payments. The signed text holds no user-written text (the business name could forge
  lines). The new wallet doesn't sign (D7: exchange or multisig addresses can't); the UI
  shows it in groups of four with a "checked every character" confirmation. Existing
  invoices keep their recipient (immutable terms).

## Transaction history (Phase 12)

- **Read-only, merchant-scoped.** Lists, search, detail pages and the export all filter
  by the session's merchant through the invoice, never by payout wallet or by ids in the
  URL: another merchant's payment id is "not found" (tested, including two merchants
  sharing a payout wallet, and a page cursor taken from another merchant's payment).
- **Exact search only:** a full base58 signature or an `INV-YYYY-NNNNN` number; anything
  else is rejected, never turned into a pattern or SQL.
- **CSV export** (`GET /api/payments/export`): merchant session, 10/min, validated
  filter and search (invalid → 400), at most 10,000 rows (newest first; truncation is
  reported in `X-Export-Truncated`), `attachment`, `no-store`. **Formula-injection safe:**
  every cell is quoted, and cells starting with `= + - @`, tab or CR get a leading `'`,
  so merchant-supplied text such as an order ID `=HYPERLINK(...)` opens as text
  (mutation-tested). No Origin check: a cross-site link can only make the merchant
  download their own file, which the other site can't read.

## Security hardening (Phase 13)

- **Least-privilege database role** (decisions E1-E3). The app connects as
  `solanapay_app` (`DATABASE_URL`): SELECT, INSERT and UPDATE on its tables; DELETE only
  on `auth_nonces`, `sessions` and `rate_limits` (the cleanup job); `audit_logs` is
  insert-only; no access to `_prisma_migrations`; no DDL. So a SQL injection bug or a
  leaked `DATABASE_URL` can't switch off the triggers that keep the audit log
  append-only and payment evidence immutable, TRUNCATE or DROP anything. Migrations run
  as the owner (`MIGRATE_DATABASE_URL`). The grants live in `scripts/db-app-role.sql`
  (`npm run db:role`, idempotent; the password comes from `APP_DB_PASSWORD`, never from
  the file). The whole test suite runs as this role; `tests/integration/db-privileges.test.ts`
  and `npm run db:check` prove 9 forbidden operations fail with 42501 (mutation-tested).
- **Security headers on every route** (`next.config.ts`, decision D4): a baseline
  Content-Security-Policy (`default-src 'self'`; scripts only from our origin; the
  browser may connect only to us and the configured RPC origin; `frame-ancestors
  'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a Permissions-Policy that turns off
  camera, microphone, geolocation, payment, USB and topics, and HSTS (two years) when
  `NEXT_PUBLIC_APP_URL` is HTTPS. No `X-Powered-By`. Checked by unit tests and the smoke
  test.
- **Payout wallet rules** (decisions D5, D6), at onboarding and on every change:
  - one merchant per payout wallet: a wallet that is another merchant's current default
    is refused (a former one may be reused). Re-checked at confirmation under a
    per-address advisory lock, so two merchants claiming one wallet at the same moment
    can't both succeed (race test, mutation-tested);
  - on-chain check: the address must be either not on-chain yet or a plain System
    account without data. Programs (including on-curve program IDs the format check
    can't catch), token, stake and nonce accounts are refused. **Fails closed:** if the
    RPC can't be reached the answer is 503 `RpcUnavailable`, never "accepted unchecked".
    The signed-in wallet itself isn't looked up (its sign-in signature proves it's a
    wallet), and the check isn't repeated at confirmation (an empty System account can
    only become something else with its own key's signature).
- **Different-account check** (payout change page): wallet apps can sign with their
  active account while the page believes another is connected. The page verifies the
  signature against the signed-in wallet before sending it and explains what to do; if
  the browser can't verify, it sends anyway. Usability only: the server still verifies.
- **Sessions:** a payout wallet change signs out all the merchant's other sessions
  (decision D8; the count is shown and audited).
- **Cleanup** after each reconciler run (decisions D1, D2): wallet challenges 1 day
  after expiry, sessions 7 days after expiry or sign-out (they hold IP and user agent),
  rate-limit windows after 1 hour; in batches of 1000, at most 5 per table per run.
  Invoices, payments, unmatched entries, wallets and the audit log are kept.
- **Client IP:** `clientIp()` accepts only a valid IP address and is used everywhere,
  including the public checkout page.
- **Onboarding** is rate-limited (10/min per user), since each attempt may query the RPC.

## Error responses

API errors have the shape `{"error": {"code": "...", "message": "..."}}` with codes
from `src/lib/http/api.ts` (`InvalidRequest`, `Unauthenticated`, `InvalidSignature`,
`ChallengeExpired`, `ForbiddenOrigin`, `RateLimited`, `DatabaseUnavailable`,
`InvalidAccount`, `SelfPaymentNotAllowed`, `InvoiceNotPayable`, `RpcUnavailable`,
`InvalidRecipient`, `TransactionFailed`, `TransactionNotFound`, `PaymentAlreadyProcessed`,
`InvalidCredentials`,
`InternalError`). Every response carries `x-request-id` and `cache-control: no-store`.

## Database-level protections

See [database.md](database.md): unique signatures and references, positive amounts,
state-consistency CHECKs, immutable payment evidence and invoice terms, and an
append-only audit log, all enforced against an app role that can't switch them off.

## Known gaps (tracked)

- **Client IP** comes from the first `X-Forwarded-For` entry. That is only
  trustworthy behind a proxy that overwrites the header (e.g. Vercel). Revisit for
  other hosting.
- **CSP keeps `'unsafe-inline'` for scripts** because Next.js inlines its bootstrap
  scripts. A nonce-based policy is on the Phase 17 roadmap. Everything else in the
  policy is strict (no external script hosts, no eval in production, no framing).
- **Public checkout rate limit returns HTTP 200:** after 60 views/min per IP the
  page shows "Too many requests", but Next.js pages can't set a 429 status. The
  limit is enforced; the payment-status API returns a proper 429 with `Retry-After`.
- **Wallets may ignore Solana Pay `reference`** in transfer links (observed with
  Phantom mobile's QR scanner): Transaction Requests are now the primary path over
  HTTPS (Phase 7b, verified with Phantom Android); payments without a reference go to
  the Unmatched payments review list (Phase 9). The in-browser payment (Phase 8) always
  carries the reference, also over plain HTTP.
- **Public RPC endpoints rate-limit bursts and sometimes stall:** on devnet the public
  endpoint returned HTTP 429 to a burst our own budget allowed (absorbed by the
  backoff), and the first call after a server start sometimes exceeds the 5 s timeout
  (the request fails safe and the next one works). Production must use a dedicated RPC
  provider (Phase 15).
- **Payout wallets shared before Phase 13** are not changed retroactively; the rule
  applies from the next change. (No such data in a fresh deployment.)

## Dependency audit (Phase 13, decision D7)

`npm audit --omit=dev` (production dependencies) on 2026-10-04: **0 vulnerabilities.**
Report-only: findings are judged one by one and never fixed with `npm audit fix`
(which can upgrade across major versions). Re-run before each deployment (Phase 15).

