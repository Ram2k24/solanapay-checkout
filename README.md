# SolanaPay Checkout

> USDC checkout for merchants, powered by Solana Pay.

**Status:** early development. Phases 1–2 complete (environment, Next.js app skeleton).
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
- `GET /api/health` liveness endpoint

Planned features are listed in the [Roadmap](#roadmap) and only move here once
implemented and tested.

## Architecture
See [docs/architecture.md](docs/architecture.md).

## Technology Stack
Next.js · TypeScript · PostgreSQL · Prisma · @solana/kit · Wallet Standard · Solana Pay

## Local Development

Prerequisites: Node.js 24 LTS (`nvm use`), Docker with Compose plugin.

    nvm use                           # Node 24 (from .nvmrc)
    npm ci                            # install exact versions from package-lock.json
    cp -n .env.example .env           # -n: never overwrite an existing .env
                                      # then set AUTH_SECRET and CRON_SECRET
    docker compose up -d              # start PostgreSQL
    ./scripts/verify-env.sh           # check the environment
    npm run dev                       # http://localhost:3000

| Script | Purpose |
|---|---|
| `npm run dev` | Development server (logs pretty-printed via pino-pretty) |
| `npm run build` | Production build (includes type checking) |
| `npm run start` | Serve the production build |
| `npm run typecheck` | TypeScript strict check only |

Health check: `curl http://localhost:3000/api/health`

## Environment Variables
See [.env.example](.env.example). `NEXT_PUBLIC_*` values are visible in the
browser and are **inlined at build time** (changing them requires a rebuild);
all others are server-only and read at startup. All values are validated with
Zod in `src/lib/config/`.

## Database Setup
_Phase 3._

## Devnet Setup
_Phase 8._

## Testing
_Phase 14._

## Deployment
_Phase 15._

## Security
Never share seed phrases or private keys. The application never requests,
stores, or uses customer private keys. Details: _Phase 13_.

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
