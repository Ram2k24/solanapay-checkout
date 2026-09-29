# Architecture

Status: approved in Phase 0 (2026-09-27). Updated as phases land.

## Decisions

| Area | Decision | Reason |
|---|---|---|
| App shape | Single Next.js app (UI + API route handlers) | One deployable; no extra service for MVP scale |
| Database | PostgreSQL 17, Prisma ORM | Relational integrity for money; parameterized SQL |
| Solana SDK | `@solana/kit` | Official current SDK; `@solana/web3.js` v1 is legacy |
| Wallets | Wallet Standard via `@solana/react` / `@solana/kit-plugin-wallet` | Official replacement for wallet-adapter |
| Payment URLs | `@solana/pay` (Kit-based) | Official Solana Pay transfer-request SDK |
| On-chain program | None for MVP | SPL Token `transferChecked` + Solana Pay reference is sufficient; a custom program adds audit and upgrade risk with no merchant benefit |
| Network | Devnet only; network set via config | Mainnet later without code changes |
| Money | Integer base units (`BIGINT`, TS `bigint`); USDC = 6 decimals | No floating-point rounding |
| Auth | Sign-In With Solana: nonce, wallet signature, httpOnly session cookie | Wallet connection alone is not authentication |

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
    │   ├── page.tsx          # landing page (/)
    │   └── api/health/       # GET /api/health
    ├── components/           # shared UI (header, footer, network banner)
    ├── instrumentation.ts    # runs once at server start
    ├── generated/prisma/ # Prisma Client (generated, git-ignored)
    └── lib/
        ├── config/           # env validation (public + server-only), networks
        ├── db/               # Prisma client (server-only, with timeouts)
        └── log/              # pino logger

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
