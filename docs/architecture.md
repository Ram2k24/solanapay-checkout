# Architecture

Status: approved in Phase 0 (2026-09-27). Updated as phases land.

## Decisions

| Area | Decision | Reason |
|---|---|---|
| App shape | Single Next.js app (UI + API route handlers) | One deployable; no extra service for MVP scale |
| Database | PostgreSQL 17, Prisma ORM | Relational integrity for money; parameterized SQL |
| Solana SDK | `@solana/kit` | Official current SDK; `@solana/web3.js` v1 is legacy |
| Wallets | Wallet Standard via `@solana/react` / `@solana/kit-plugin-wallet` | Official replacement for wallet-adapter |
| Payment URLs | Solana Pay spec, implemented in `src/lib/payments/solana-pay.ts` (Phase 7) | `@solana/pay` 1.0.26 requires Kit ^6.9, which conflicts with the Kit 8 wallet stack; see dependencies.md |
| On-chain program | None for MVP | SPL Token `transferChecked` + Solana Pay reference is sufficient; a custom program adds audit and upgrade risk with no merchant benefit |
| Network | Devnet only; network set via config | Mainnet later without code changes |
| Money | Integer base units (`BIGINT`, TS `bigint`); USDC = 6 decimals | No floating-point rounding |
| Auth | Sign-In With Solana: nonce, wallet signature, httpOnly session cookie | Wallet connection alone is not authentication |
| Background work | A reconciler endpoint (`POST /api/internal/reconcile`, `CRON_SECRET`) called by an external scheduler; state in `invoice_checks` with leases | No timers inside Next.js: they break on serverless hosts, multiply across instances and duplicate on dev hot reload |

## Invoice state machine

    DRAFT ──▶ PENDING ──▶ CONFIRMING ──▶ PAID
                 │             │
                 ├──▶ EXPIRED  └──▶ FAILED
                 └──▶ FAILED

- CONFIRMING: a matching, verified transfer reached `confirmed` commitment.
- PAID: set only after the transaction is re-verified at `finalized` commitment.
- A payment confirmed before `expires_at` still becomes PAID even if finality
  arrives after expiry (the customer paid in time).
- Only the backend changes state. Every transition is audit-logged.

## Project structure

    src/
    ├── app/                  # Next.js App Router: folders are URLs
    │   ├── layout.tsx        # root layout (fonts, <html>/<body>)
    │   ├── (merchant)/       # signed-in area: dashboard, onboarding, invoices (shared layout)
    │   ├── pay/[id]/         # public customer checkout (no sign-in)
    │   ├── page.tsx          # landing page (/)
    │   └── api/
    │       ├── health/       # GET /api/health
    │       ├── auth/         # nonce, verify, logout, session
    │       ├── merchant/     # merchant profile
    │       └── invoices/     # create, list, get
    ├── components/           # shared UI: header, footer, banner, providers, checkout (QR),
    │   └── wallet/           #   wallet button and balances (client components)
    ├── instrumentation.ts    # runs once at server start
    ├── generated/prisma/ # Prisma Client (generated, git-ignored)
    └── lib/
        ├── auth/             # SIWS message, signature check, challenges, sessions
        ├── config/           # env validation (public + server-only), networks
        ├── db/               # Prisma client (server-only, with timeouts)
        ├── http/             # API errors, origin check, rate limit, route wrapper
        ├── dev/              # seed safety guard
        ├── log/              # pino logger
        ├── merchant/         # requireMerchant, payout wallet validation
        ├── money/            # integer-only amount parsing and formatting
        ├── payments/         # invoice rules: state machine, numbering, reference,
        │                     #   create/list, DTO, policy (expiry, limits)
        ├── solana/           # browser Solana client (wallet + RPC), address helpers
        └── wallet/           # wallet error handling
    tests/
    ├── support/              # test setup, test DB reset, throwaway wallets
    ├── unit/
    └── integration/          # route handlers against a real test database

## Configuration

- `src/lib/config/public-env.ts`: `NEXT_PUBLIC_*` variables. Inlined into browser
  JavaScript **at build time**; each is referenced literally so Next.js can inline it.
- `src/lib/config/server-env.ts`: server-only variables, guarded by `import "server-only"`
  (importing it from browser code fails the build).
- Validation errors list variable names and rules, never values.
- `instrumentation.ts` loads the config at startup; on failure the process exits
  with code 1 (fail fast rather than serve with bad config).
- Only networks in `ENABLED_NETWORKS` (currently `devnet`) are accepted.
- Configured USDC mints must equal Circle's official mints (`CIRCLE_USDC_MINT`).

## Logging

- pino writes one JSON object per line to stdout (ready for log aggregation).
- Every line carries `service`, `env` and `network`.
- Sensitive keys (password, secret, privateKey, seedPhrase, cookie,
  authorization, AUTH_SECRET, CRON_SECRET, DATABASE_URL) are redacted.
- In development, `npm run dev` pipes output through `pino-pretty`.

## Authentication

Sign-In With Solana with server-side sessions. See [security.md](security.md).

## Frontend

- Server components by default (landing page, dashboard); client components
  (`"use client"`) only where the browser is needed (wallet UI, session context).
- `src/lib/solana/client.ts`: `createClient().use(walletSigner({ chain })).use(solanaRpc(...))`
  from `@solana/kit`, provided to React via `ClientProvider` (`@solana/react`).
- `SessionProvider` exposes the server session and `signIn`/`signOut` to the UI.

## Invoices

See [payment-flow.md](payment-flow.md). Business rules live in `src/lib/payments/`;
API routes and pages are thin wrappers around them.
