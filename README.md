# SolanaPay Checkout

> USDC checkout for merchants, powered by Solana Pay.

**Status:** early development. Phase 1 (development environment) is complete.
Devnet only. Do not send real funds.

## Overview
Merchants create invoices and share a Solana Pay QR code or link; customers pay
in USDC from their own wallet; the backend independently verifies the payment on-chain.

## Features
_Planned. Listed here as they are implemented and tested._

## Architecture
See [docs/architecture.md](docs/architecture.md).

## Technology Stack
Next.js · TypeScript · PostgreSQL · Prisma · @solana/kit · Wallet Standard · Solana Pay

## Local Development

Prerequisites: Node.js 24 LTS (`nvm use`), Docker with Compose plugin.

    cp -n .env.example .env           # -n: never overwrite an existing .env
                                      # then set AUTH_SECRET and CRON_SECRET
    docker compose up -d              # start PostgreSQL
    ./scripts/verify-env.sh           # check the environment

## Environment Variables
See [.env.example](.env.example). `NEXT_PUBLIC_*` values are visible in the
browser; all others are server-only.

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
