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

## Phase 3: verified 2026-09-29

| Package | Version | Type | Deprecated |
|---|---|---|---|
| prisma | 7.10.0 | dev | no |
| @prisma/client | 7.10.0 | runtime | no |
| @prisma/adapter-pg | 7.10.0 | runtime | no |
| pg | 8.23.0 | runtime | no |

**Overrides** (`package.json` → `overrides`): the Prisma 7.10.0 CLI depends on
`mysql2` 3.15.3 (GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3) and `deepmerge-ts`
7.1.5 (GHSA-ggr8-5vv4-36mx). Both are CLI-only (not in the app's runtime bundle)
and not reachable in our usage, but we override them to the patched `mysql2`
3.24.4 and `deepmerge-ts` 8.0.2 (tested: validate, generate, migrate, drift check).
`npm audit`: 0 vulnerabilities. **Remove the overrides** when a Prisma release
ships patched versions.

**Install scripts** (`package.json` → `allowScripts`): npm 11 blocks dependency
install scripts by default. `prisma` (preinstall) and `@prisma/engines`
(postinstall) are explicitly denied; generate and migrate work without them
locally. Re-verify on the deployment platform (Phase 15).

## Phase 4: verified 2026-09-29

| Package | Version | Type | Deprecated |
|---|---|---|---|
| @solana/kit | 8.3.0 | runtime | no |
| vitest | 5.0.2 | dev | no |
| vite | 8.3.1 | (via vitest) | no |

`@solana/kit` 8.4.0 was released after 8.3.x was approved; staying on 8.3.0
(compatible with `@solana/react` 8.3 and `@solana/kit-plugin-wallet` 0.20).
`npm audit`: 0 vulnerabilities.

## Phase 5: verified 2026-09-30

| Package | Version | Deprecated |
|---|---|---|
| @solana/react | 8.3.0 | no |
| @solana/kit-plugin-wallet | 0.20.0 | no |
| @solana/kit-plugin-rpc | 0.19.0 | no |
| @solana-program/token | 0.17.0 | no |

Peers satisfied: `@solana/kit` 8.3.0, `react` 19.3.0. A single `@solana/kit@8.3.0`
is used across the tree (`npm ls @solana/kit --all`). `npm audit`: 0 vulnerabilities.
`@solana/react` 8.4.0 exists; staying on 8.3.0 to match Kit 8.3.0.

## Decisions

- **TypeScript 6.0.3, not 7.0.x.** TS 7 (native compiler) ships without a
  stable programmatic API; Next.js 16.3 supports it via `tsc`, but other
  tooling may not until 7.1. Revisit later.
- **`@types/node` ^24.** Matches the Node 24 LTS runtime (`.nvmrc`).
- **Prisma 7.10.0, not 8.0.** npm's `latest` tag points to 8.0 release candidates;
  Prisma's update notice can be ignored.
- **No `dotenv`.** Prisma 7 doesn't load `.env`; `prisma.config.ts` uses Node's
  built-in `process.loadEnvFile()` (existing environment variables win).
- **npm stays at 11.x** (bundled with Node 24 LTS). Do not upgrade to npm 12.
- **`@solana/pay` is not used.** Its latest release (1.0.26) requires
  `@solana/kit ^6.9`, which conflicts with the current wallet stack
  (`@solana/kit-plugin-wallet` 0.20 requires Kit ^8.2). The minimal Solana Pay
  protocol code we need is implemented from the official spec in
  `src/lib/payments/solana-pay.ts` (Phase 7).
- **Planned Solana stack (Phases 5–8):** `@solana/kit` 8.3.x, `@solana/react`
  8.3.x, `@solana/kit-plugin-wallet` 0.20.x, `@solana-program/token` 0.17.x,
  `qrcode` 1.5.x. Versions are re-verified before installing.
