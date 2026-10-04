# Testing

Five suites, from fastest to slowest. All of them are read-only towards Solana: no
test holds a funded key or sends a real transaction.

| Command | What | Needs |
|---|---|---|
| `npm test` | Unit and integration tests (Vitest), as the least-privilege database role | Docker Postgres, `*_test` database |
| `npm run db:check` | 57 database rules (constraints, triggers, app-role denials), rolled back | Docker Postgres |
| `npm run smoke` | Starts the production build and checks key routes and security headers | a build (`npm run build`) |
| `npm run test:e2e` | Browser tests (Playwright, Chromium) against a production build | Chromium (`npx playwright install chromium`), `*_test` database |
| `npm run test:devnet` | Live devnet: real payments fetched and verified by signature | network access to `SOLANA_RPC_URL` |

`npm test` and `npm run test:e2e` share the `*_test` database: run them one after the
other, not at the same time.

## Unit and integration (`npm test`)

`tests/unit` covers pure logic (amount parsing, the invoice state machine, Solana Pay
URLs, transaction requests, payment verification on real devnet transactions saved in
`tests/fixtures/solana`, rate limits, CSV export, security headers). `tests/integration`
calls the real route handlers and library functions against the `*_test` database, with
the Solana RPC mocked by those saved transactions. The code under test connects as
`solanapay_app` (Phase 13.5); only the reset between tests uses the owner.

## Browser tests (`npm run test:e2e`)

`playwright.config.ts` starts two servers: a production build of the app in
`.next-e2e` on port 3200, and a mock Solana RPC on 127.0.0.1:3299
(`tests/e2e/support/mock-rpc.ts`).

- **Wallet:** `tests/e2e/support/test-wallet.ts` registers a Wallet Standard wallet the
  way Phantom does. Its key pair is created per test in the test process and never
  reaches the browser or the disk; the page asks the test process to sign. It can also
  imitate "Cancel" and a wallet that claims to have sent a transaction it never sent.
- **Chain:** the mock RPC answers as devnet (its genesis hash), verifies the fee payer's
  signature on `sendTransaction`, applies the USDC transfer to token balances, and serves
  the transaction back in the same JSON shape as real devnet transactions. The app's
  verification code runs unchanged; it is tested against real devnet transactions by the
  other suites. Unknown RPC methods fail the test.
- **Database checks** use `pg` as the owner (`TEST_MIGRATE_DATABASE_URL`).
- Failures keep a screenshot and a trace: `npx playwright show-trace test-results/…/trace.zip`.

Test-only code never enters the app: `tests/unit/test-only-code.test.ts` fails if any
file under `src/` imports from `tests/`.

## Live devnet (`npm run test:devnet`)

`tests/devnet/live-payments.test.ts` fetches real payments made during development
(INV-2026-00017, -00023, -00041, -00043, and Phantom's payment without a reference) by
signature through the app's own RPC code, and verifies them with the app's own
verification code, also against changed invoice terms. It checks first that
`SOLANA_RPC_URL` really serves devnet. If devnet ever prunes these transactions, the
suite says so; replace them with newer payments.

## Coverage of the specification (§19)

| Requirement | Where |
|---|---|
| **Unit:** invoice creation, amount validation | `unit/parse-amount`, `unit/invoice-helpers`, `integration/invoices` |
| **Unit:** expiration, state transitions | `unit/invoice-state`, `integration/expire-invoice`, `integration/reconciler` |
| **Unit:** payment verification logic | `unit/verify-payment` (real devnet transactions) |
| **Unit:** idempotency | `integration/invoices` (idempotency keys), `integration/check-payment`, `integration/phase10-concurrency` |
| **Integration:** API, database, verification | `tests/integration/*` (every route), `npm run db:check`, `integration/db-privileges` |
| **E2E:** merchant login | `e2e/merchant-signin` (sign-in, cancel, sign-out, protected pages) |
| **E2E:** create invoice | `e2e/invoices` (terms stored by the server, invalid amounts) |
| **E2E:** checkout | `e2e/invoices` (customer page, expired, unknown), `e2e/payment` |
| **E2E:** payment state | `e2e/payment` (PAID only after verification; unbroadcast, cancelled, insufficient funds) |
| **E2E:** dashboard | `e2e/invoices` (counts), `e2e/payment` (paid figures, transaction history) |

**Blockchain cases**

| Case | Unit (real transactions) | Integration (database) | E2E | Live devnet |
|---|---|---|---|---|
| Valid payment | settles INV-2026-00017 | CONFIRMING, then PAID; straight to PAID | pays to PAID | 4 real payments settle |
| Wrong amount | invoice amount, instruction amount, net credit differ | AMOUNT_MISMATCH → unmatched, invoice stays PENDING | | amount + 1 doesn't settle |
| Wrong token | different mint, Token-2022, wrong decimals | another mint records nothing | | another mint isn't a payment |
| Wrong recipient | different wallet, auxiliary token account | another owner's account records nothing | | another wallet isn't a payment |
| Expired invoice | late flag | late payment settles flagged; EXPIRED → INVOICE_NOT_PAYABLE | expired checkout can't pay | late flag on real payments |
| Duplicate transaction | | idempotent re-check; 10 concurrent checks → 1 payment; unique signature (`db:check`) | | |
| Already-paid invoice | | second payment → DUPLICATE_PAYMENT, never paid twice | paid checkout offers no Pay button | |
| Invalid reference | another invoice's reference; no reference | NO_REFERENCE, UNKNOWN_REFERENCE → unmatched | | another reference doesn't settle; payment without reference settles nothing |

**Practice:** when adding a test, break the rule it protects in the app once (a
"mutation check", using a backup copy of the file) and watch the test fail, then
restore the file. A test that still passes protects nothing.
