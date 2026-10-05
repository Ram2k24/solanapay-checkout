# Deployment (devnet MVP)

Live: **https://solanapay-checkout.vercel.app** (Solana devnet, test USDC only).

| Part | Service (free tier) | Notes |
|---|---|---|
| App | Vercel Hobby, region `iad1` (Washington, D.C.) | Node 24 (`engines`), production environment only |
| Database | Neon, Postgres 17, AWS us-east-1 | the app connects as `solanapay_app` through Neon's pooler |
| Solana RPC (server) | Helius, devnet endpoint | API key server-side only (`SOLANA_RPC_URL`) |
| Solana RPC (browser) | public devnet | balance display only; no key in the browser |
| Scheduler | cron-job.org, every 2 min | plus `.github/workflows/reconcile.yml` (every 5 min, backup and failure alerts) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | every push and pull request |

Decisions G1-G6 and G4b (Phase 15). Every service started empty: no development data
was copied.

## Where each secret lives

| Secret | Lives in | Never in |
|---|---|---|
| Neon owner URL (migrations) | your machine: `.env.neon` (git-ignored, mode 600) | Vercel, git, chat |
| `DATABASE_URL` (app role, pooled, `sslmode=verify-full`) | Vercel (Production) | git, the browser |
| Helius API key (`SOLANA_RPC_URL`) | Vercel; your machine: `.env.helius` | `NEXT_PUBLIC_*`, git |
| `AUTH_SECRET` | Vercel | anywhere else |
| `CRON_SECRET` | Vercel, GitHub Actions secret, cron-job.org job header | git, logs |

`.env.vercel` (git-ignored) is the generated file that was imported into Vercel. Keep it
private or delete it once imported; re-running `scripts/vercel-env.sh` keeps the same
`AUTH_SECRET` and `CRON_SECRET` only while it exists.

Never paste a secret into a chat, an issue or a screenshot. If one leaks, rotate it at
its source (Neon: reset the role password; Helius: new key; `AUTH_SECRET` or
`CRON_SECRET`: new value in every place listed above, then redeploy).

## Setting it up from scratch

1. **GitHub.** Push the repository; CI runs on the first push.
2. **Neon.** Create a project (Postgres 17, same region as Vercel's functions). Put the
   owner's **direct** connection string (pooling off) into `.env.neon` with an app-role
   password:

        printf 'NEON_OWNER_DIRECT_URL=\nAPP_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env.neon && chmod 600 .env.neon
        nano .env.neon      # paste after NEON_OWNER_DIRECT_URL= (Ctrl+Shift+V)

   Then, from your machine:

        ./scripts/db-remote.sh deploy   # migrations, as the owner
        ./scripts/db-remote.sh role     # solanapay_app, its grants, statement_timeout
        ./scripts/db-remote.sh check    # 57 database checks, rolled back
        ./scripts/db-remote.sh app      # as the app, through the pooler: statement_timeout 10s, TRUNCATE refused

   If `app` shows `statement_timeout: '0'`, the pooler is still reusing sessions opened
   before `role`: restart the compute in Neon's console and check again.
3. **Helius.** Create an API key; put the **devnet** URL into `.env.helius`
   (`HELIUS_DEVNET_RPC_URL=https://devnet.helius-rpc.com/?api-key=…`).
4. **Vercel variables.**

        ./scripts/vercel-env.sh https://<project>.vercel.app

   It refuses a non-devnet RPC and writes `.env.vercel` (12 variables; the owner URL is
   deliberately not among them).
5. **Vercel.** Import the GitHub repository (framework: Next.js, defaults). Under
   Settings → Environment Variables use **Import .env** with `.env.vercel` (Production).
   Don't copy values from a terminal editor: long lines get cut off on screen.
   Deploy. Every push to `main` redeploys.
6. **Check.**

        SMOKE_URL=https://<project>.vercel.app npm run smoke

   Every check must pass, including HSTS.
7. **Scheduler.** cron-job.org job: `POST https://<project>.vercel.app/api/internal/reconcile`,
   header `Authorization: Bearer <CRON_SECRET>`, every 2 minutes, failure notifications on.
   A test run answers HTTP 200 with counts only (no ids, wallets or signatures). Also add
   `CRON_SECRET` as a GitHub Actions repository secret for the backup workflow.

## Changing things later

- **New migration:** `./scripts/db-remote.sh deploy` **before** pushing code that needs it
  (Vercel deploys on push). If the migration adds a table the app must delete from, add
  it to `scripts/db-app-role.sql` and run `./scripts/db-remote.sh role`.
- **New variable:** add it in Vercel (Production) and redeploy; `NEXT_PUBLIC_*` values
  are inlined at build time.
- **Another domain:** re-run `vercel-env.sh` with the new URL, update
  `NEXT_PUBLIC_APP_URL` in Vercel, redeploy, update the cron job and `reconcile.yml`.
  Sign-in messages and origin checks use this URL.
- **Before each deployment:** `npm audit --omit=dev` (report only).

## Known limits of this deployment

- **Free tiers.** Vercel Hobby (personal, non-commercial use), Neon Free (compute scales
  to zero: the first request after idle time is slower), Helius Free (10 requests/s,
  1M credits/month). Fine for a devnet demo; not for real money (Phase 17).
- **Logs** are Vercel's runtime logs (short retention on Hobby); no error tracking or
  uptime monitoring yet (Phase 17). cron-job.org and the GitHub workflow notify on
  failed runs.
- **Preview deployments** don't work by design: the variables exist for Production only
  and the app URL is fixed at build time.
- **GitHub's schedule** proved unreliable for this repository (one run in several
  hours), which is why cron-job.org drives the reconciler.
