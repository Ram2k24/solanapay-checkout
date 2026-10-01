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

## Error responses

API errors have the shape `{"error": {"code": "...", "message": "..."}}` with codes
from `src/lib/http/api.ts` (`InvalidRequest`, `Unauthenticated`, `InvalidSignature`,
`ChallengeExpired`, `ForbiddenOrigin`, `RateLimited`, `DatabaseUnavailable`,
`InternalError`). Every response carries `x-request-id` and `cache-control: no-store`.

## Database-level protections

See [database.md](database.md): unique signatures and references, positive amounts,
state-consistency CHECKs, and an append-only audit log.

## Known gaps (tracked)

- **Client IP** comes from the first `X-Forwarded-For` entry. That is only
  trustworthy behind a proxy that overwrites the header (e.g. Vercel). Revisit for
  other hosting.
- **TRUNCATE** on `audit_logs` is not blocked by the trigger. Fix: run the app with
  a least-privilege database role without TRUNCATE (planned, Phase 13).
- **Cleanup** of expired nonces, sessions and rate-limit rows (planned, Phase 10 scheduler).
- **Security headers** (CSP, HSTS, …) (planned, Phase 13).
- **Public checkout rate limit returns HTTP 200:** after 60 views/min per IP the
  page shows "Too many requests", but Next.js pages can't set a 429 status. The
  limit is enforced; the payment-status API (Phase 10) returns a proper 429.
- **Wallets may ignore Solana Pay `reference`** (observed with Phantom mobile's QR
  scanner): addressed by Transaction Requests (Phase 7b) and the Unmatched payments
  review list (Phase 9).
- **Payout wallet program check:** the denylist covers well-known programs and USDC
  mints; checking via RPC that no program is deployed at the address is planned
  (Phase 13).
