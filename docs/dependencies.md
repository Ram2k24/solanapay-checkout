# Dependencies

Every dependency is pinned to an exact version (`.npmrc`: `save-exact=true`).
Before each install we check the registry, and record the result here.

## Phase 2: verified 2026-09-27 (npm 11.19.0, Node 24.21.0)

`npm view <spec> version` / `npm view <spec> deprecated`:

| Package | Verified version | Deprecated |
|---|---|---|
| next | 16.3.6 | no |
| react | 19.3.0 | no |
| react-dom | 19.3.0 | no |
| typescript | 6.0.3 | no |
| @types/react | 19.3.0 | no |
| @types/react-dom | 19.3.0 | no |
| @types/node | 24.19.0 (from `^24`) | no |
| tailwindcss | 4.3.3 | no |
| @tailwindcss/postcss | 4.3.3 | no |
| zod | 4.6.5 | no |
| pino | 10.3.1 | no |
| pino-pretty | 13.1.3 | no |
| server-only | 0.0.1 | no |

## Decisions

- **TypeScript 6.0.3, not 7.0.x.** TS 7 (native compiler) ships without a
  stable programmatic API; Next.js 16.3 supports it via `tsc`, but other
  tooling may not until 7.1. Revisit later.
- **`@types/node` ^24.** Matches the Node 24 LTS runtime (`.nvmrc`).
- **npm stays at 11.x** (bundled with Node 24 LTS). Do not upgrade to npm 12.
- **`@solana/pay` is not used.** Its latest release (1.0.26) requires
  `@solana/kit ^6.9`, which conflicts with the current wallet stack
  (`@solana/kit-plugin-wallet` 0.20 requires Kit ^8.2). The minimal Solana Pay
  protocol code we need is implemented from the official spec in
  `src/lib/payments/solana-pay.ts` (Phase 7).
- **Planned Solana stack (Phases 5–8):** `@solana/kit` 8.3.x, `@solana/react`
  8.3.x, `@solana/kit-plugin-wallet` 0.20.x, `@solana-program/token` 0.17.x,
  `qrcode` 1.5.x. Versions are re-verified before installing.
