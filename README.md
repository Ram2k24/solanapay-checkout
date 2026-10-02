# SolanaPay Checkout

> USDC checkout for merchants, powered by Solana Pay.

**Status:** early development. Phases 1–7b complete (environment, app skeleton, database, wallet sign-in, invoices, Solana Pay QR, transaction requests).
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
- Not yet: payment detection and on-chain verification (Phases 9–10), so invoices stay
  Pending after payment
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
    npm test                # 237 tests: auth, merchants, invoices (incl. concurrency), Solana Pay, checkout, transaction requests
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
_A verified devnet payment signature will be linked here._

## License
_To be decided._
