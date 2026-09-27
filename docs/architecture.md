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
