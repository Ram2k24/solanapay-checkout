# Troubleshooting

## Environment

**`docker: unknown command: docker compose`**
Ubuntu's `docker.io` package doesn't include Compose. Install it:
`sudo apt install docker-compose-v2`.

**`nvm: command not found` right after installing nvm**
The current shell hasn't loaded it yet: `source ~/.bashrc` (or open a new terminal).

**Secrets in `.env` are empty again**
`cp .env.example .env` overwrites silently. Always use `cp -n` (no clobber).
Regenerate with:
`sed -i -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" -e "s|^CRON_SECRET=.*|CRON_SECRET=$(openssl rand -hex 32)|" .env`

## Next.js

**`⨯ Another next dev server is already running.`**
Only one dev server per project folder. Stop the old one (Ctrl+C in its terminal,
or `kill <PID>` using the PID shown in the message).

**`⚠ Port 3000 is in use ... using available port 3001`**
Something else is on port 3000 (often an old dev server). Find it with
`ss -ltnp | grep ':3000 '`.

**Server exits at startup with `Invalid server environment configuration`**
Working as designed: a variable in `.env` is missing or invalid. The message
names the variable and the rule; compare with `.env.example`.

**Changed a `NEXT_PUBLIC_*` value but nothing changed**
Public variables are inlined at build time. Restart `npm run dev`, or re-run
`npm run build` for production.

**`curl http://localhost:3000/...` prints nothing**
No server is listening (`curl -s` hides connection errors). Start `npm run dev`
in another terminal first; check with `ss -ltn | grep ':3000 '`.

## Database / Prisma

**Prisma prints "Update available 7.10.0 -> 8.0.0-rc..."**
Ignore it. We intentionally stay on Prisma 7 stable. Don't run the suggested
`npm i ...@latest` commands.

**`npm warn install-scripts ... prisma ... @prisma/engines`**
Expected once on a fresh machine if `allowScripts` is missing. Our `package.json`
records both as denied; see docs/dependencies.md.

**`/api/health` returns 503 `"database":"unavailable"`**
Postgres isn't reachable. Check `docker compose ps` and start it with
`docker compose start postgres`. The app reconnects automatically; the error
details are in the server log.

**`Can't reach database server at localhost:5432` from a Prisma command**
Same cause: start Postgres first (`docker compose up -d`).

**Migration drift / "The migration was modified after it was applied"**
Never edit a migration that has already been applied. Create a new one with
`npx prisma migrate dev --name <change>`.

**`Property 'session' does not exist on type 'PrismaClient'` after a migration**
Prisma 7's `migrate dev` does not regenerate the client. Run `npx prisma generate`.

## Tests

**`TEST_DATABASE_URL is not set`**
Add it to `.env` (copy the line from `.env.example`), then `npm run db:test:setup`.

**Tests fail with missing tables/columns after pulling new migrations**
Re-run `npm run db:test:setup` to migrate the test database.

**`Refusing: the test database name must end in _test`**
Safety check: tests empty every table, so they refuse to run against other databases.

## Wallet

**"No compatible Solana wallet found"**
No Wallet Standard wallet supporting the configured network and message signing
is installed in this browser. Install Phantom or Solflare and reload.

**Wallet shows mainnet / balances look wrong**
Switch the wallet to devnet (Phantom: Settings → Developer Settings → Testnet Mode →
Solana Devnet) and reconnect.

**Balance shows "Unavailable, retry"**
The public devnet RPC (`api.devnet.solana.com`) is rate-limiting. Retry after a few
seconds; for heavier use set `NEXT_PUBLIC_SOLANA_RPC_URL` to a provider endpoint.

**`/api/auth/session` is requested twice per page load in development**
React Strict Mode runs effects twice in development only. Production runs it once.

**Minified React error #418 (hydration mismatch)**
Server HTML differed from the first browser render. Wallet state only exists in the
browser, so wallet UI must render a placeholder until mounted (see `useIsBrowser` in
`src/components/wallet/wallet-button.tsx`).

**After a reboot: `Can't reach database server at 127.0.0.1:5432`**
Start Postgres with `docker compose up -d`. To start it automatically at boot, enable
the Docker service: `sudo systemctl enable docker`.

## Migrations (Phase 6 lessons)

**`prisma migrate dev --create-only` ran twice and created an extra migration**
Each run creates a new migration file. If the extra one only contains
`-- This is an empty migration.` and isn't applied (`npm run db:status`), delete its
folder. Never delete a migration that has been applied.

**Prisma asks "Are you sure you want to create this migration? (y/N)"**
Shown when a migration adds a unique constraint on existing columns. Answer `y`
if the columns are new or known to be duplicate-free.

**`invoice payment terms are immutable`**
The database blocks changes to an invoice's amount, recipient, mint, reference,
network etc. after creation (by design). Create a new invoice instead.

**TypeScript errors in `.next/types/validator.ts` after moving/removing a page**
Stale generated types. Stop the dev server and delete `.next/` (it is regenerated).

## Seed

**`Seed refused: ...`**
Working as designed: the seed only runs with `APP_ENV=development` against a local,
non-test database.

**`This module cannot be imported from a Client Component module` from the seed**
Run it through `npm run db:seed` (it passes `--conditions=react-server` to tsx).

## Wallet payments (Phase 7)

**Phantom says "Not enough SOL" when paying a USDC invoice**
Every Solana transaction pays a small fee in SOL, even for USDC payments. Fund the
paying wallet with devnet SOL (https://faucet.solana.com). Also check the wallet is
in Testnet Mode → Solana Devnet.

**The wallet shows "1", not "$1", or "Unknown Token"**
Solana Pay amounts are in token units (1 USDC). On devnet tokens have no price, and
Circle's devnet USDC mint has no name/logo metadata in Phantom, so it appears as
"Unknown Token 4zMMC…DncDU". On mainnet it shows as USDC.

**Paid by scanning the QR, but the invoice stays Pending**
Expected until payment detection exists (Phases 9–10). Also note that Phantom mobile
was observed to omit the Solana Pay reference; see payment-flow.md.

**"Open in wallet" does nothing on a computer**
Browser extensions generally don't handle `solana:` links; the button is for phones.
