# SolanaPay Checkout

> USDC checkout for merchants, powered by Solana Pay.

**Status:** early development. Phases 1–7b and 9 complete (environment, app skeleton, database, wallet sign-in, invoices, Solana Pay QR, transaction requests, on-chain payment verification). Phase 8 (in-browser payment) is next.
Devnet only. Do not send real funds.

## Overview
Merchants create invoices and share a Solana Pay QR code or link; customers pay
in USDC from their own wallet; the backend independently verifies the payment on-chain.

## Features
Implemented so far:
- Landing page (responsive, network-aware devnet banner)
- Validated configuration: the server refuses to start on missing/invalid
  environment variables, and USDC mints must match Circle's official addresses
- Structured JSON logging with secret redaction
- `GET /api/health`: reports app and database status (503 when the database is down)
- Sign-In With Solana backend: one-time challenges, Ed25519 signature verification,
  database-backed sessions, CSRF protection, rate limiting (see [docs/security.md](docs/security.md))
- Wallet connection via Wallet Standard (Phantom, Solflare, …): connect/disconnect,
  shortened address, devnet SOL and USDC balances (Circle's mint only), sign-in/out,
  wallet-rejection and network-mismatch handling
- Merchant onboarding (business name, email, validated payout wallet)
- Invoices: create (USDC amount, optional order ID or automatic `ORD-YYYY-NNNNN`,
  description, expiry), list with status filters and pagination, detail page;
  per-merchant numbering `INV-YYYY-NNNNN`; idempotent creation; payment terms fixed
  by the server and immutable after creation (see [docs/payment-flow.md](docs/payment-flow.md))
- Merchant dashboard with invoice counts and recent invoices
- Solana Pay QR code for each invoice (spec-tested), and a public checkout page
  (`/pay/[id]`) with QR, "Open in wallet" and expired state
- Solana Pay Transaction Requests (`/api/pay/[id]/transaction`): over HTTPS the QR asks
  our server for an unsigned USDC transaction built from the stored invoice, so the
  payment reference is always included; the plain transfer link remains as a fallback
  (see [docs/payment-flow.md](docs/payment-flow.md))
- On-chain payment verification: the server finds the payment by its Solana Pay
  reference and checks recipient, mint, exact amount, reference, network (genesis hash)
  and finality against the stored invoice; Confirming → Paid; late payments flagged
- Unmatched payments (suspense list): real USDC that can't settle an invoice (no or
  unknown reference, wrong amount, paid twice, closed invoice) is recorded for review,
  never auto-paid; merchants look up transactions by signature and resolve entries
- Payment details on the invoice page, "Payment confirmed" on the customer page, USDC
  received on the dashboard
- Not yet: automatic detection (polling) and expiry updates (Phase 10); until then the
  merchant clicks Check for payment
- PostgreSQL schema for merchants, invoices, payments and an append-only audit log,
  with database-level constraints (see [docs/database.md](docs/database.md))

Planned features are listed in the [Roadmap](#roadmap) and only move here once
implemented and tested.

## Architecture
See [docs/architecture.md](docs/architecture.md).

## Technology Stack
Next.js 16 · TypeScript · PostgreSQL 17 · Prisma 7 · @solana/kit · Wallet Standard · Solana Pay

## Local Development

Prerequisites: Node.js 24 LTS (`nvm use`), Docker with Compose plugin.

    nvm use                           # Node 24 (from .nvmrc)
    npm ci                            # install exact versions from package-lock.json
    cp -n .env.example .env           # -n: never overwrite an existing .env
                                      # then set AUTH_SECRET and CRON_SECRET
    docker compose up -d              # start PostgreSQL
    npm run db:deploy                 # apply database migrations
    ./scripts/verify-env.sh           # check the environment
    npm run dev                       # http://localhost:3000

| Script | Purpose |
|---|---|
| `npm run dev` | Development server (logs pretty-printed via pino-pretty) |
| `npm run build` | Production build (includes type checking) |
| `npm run start` | Serve the production build |
| `npm run typecheck` | TypeScript strict check only |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run db:test:setup` | Create and migrate the test database |
| `npm run db:seed -- --wallet <addr>` | Development-only demo merchant and invoices (idempotent) |
| `npm run smoke` | Smoke-test the production build (starts and stops its own server) |

Health check: `curl http://localhost:3000/api/health`

## Environment Variables
See [.env.example](.env.example). `NEXT_PUBLIC_*` values are visible in the
browser and are **inlined at build time** (changing them requires a rebuild);
all others are server-only and read at startup. All values are validated with
Zod in `src/lib/config/`.

## Database Setup
Schema and migrations are managed with Prisma 7. See [docs/database.md](docs/database.md).

    npm run db:deploy     # apply migrations
    npm run db:status     # check migration state
    npm run db:check      # run the 43 database constraint checks (rolled back)

## Devnet Setup
See [docs/devnet-testing.md](docs/devnet-testing.md): wallet setup, devnet SOL/USDC faucets,
and the manual test checklist.

## Testing
Tests use a separate database (`TEST_DATABASE_URL`, name must end in `_test`).

    npm run db:test:setup   # once, and after new migrations
    npm test                # 294 tests: auth, merchants, invoices, Solana Pay, transaction requests, payment verification (real devnet fixtures, concurrency)
    npm run db:check        # database constraint tests

Full E2E and blockchain test suites: Phase 14.

## Deployment
_Phase 15._

## Security
Never share seed phrases or private keys. The application never requests,
stores, or uses private keys. See [docs/security.md](docs/security.md).

## Roadmap
_Phase 17._

## Screenshots
_Coming soon._

## Demo
_Coming soon._

## Solana Transaction
A devnet USDC payment made through a Solana Pay transaction request and verified by the
backend (INV-2026-00017, 1 USDC, finalized):
[`39m866og…`](https://explorer.solana.com/tx/39m866ogKRdHeuqrePGz7TwXrr3u1bcUsc5eaH2QrxtEUnPyDHR9pycmCCEfj1zd65HqzE2sRKCpJnga8emL9YE3?cluster=devnet)

## License
_To be decided._
