# Devnet testing

Manual end-to-end checks with a real wallet on **Solana devnet**. Devnet tokens have
no value. Never use a seed phrase or private key anywhere in this process; faucets
and this app only need your **public** address.

Prerequisites: `docker compose up -d`, `npm run db:deploy`, `npm run dev`
(http://localhost:3000), and Chrome with a Wallet Standard wallet such as
[Phantom](https://phantom.com/download) or [Solflare](https://solflare.com/download).

## 1. Wallet setup

1. In Phantom: **Settings → Developer Settings → Testnet Mode → Solana Devnet**.
   (Menu names can change between wallet versions.)
2. Recommended: create a separate account in the wallet just for testing.

## 2. Fund the wallet

| Token | Faucet | Notes |
|---|---|---|
| Devnet SOL | https://faucet.solana.com (choose Devnet) | Pays transaction fees. Rate-limited. |
| Devnet USDC | https://faucet.circle.com (USDC, Solana Devnet) | Circle's official devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

## 3. Wallet connection and sign-in (Phase 5)

| # | Action | Expected |
|---|---|---|
| 1 | Click **Connect wallet** | Compatible wallets listed (or install links if none) |
| 2 | Choose Phantom, approve | Header shows shortened address, grey dot |
| 3 | Open the wallet panel | Full address, **Devnet**, SOL and USDC balances. Only Circle's USDC mint is counted. |
| 4 | **Sign in with wallet** | Phantom shows a "Sign In" request for `localhost:3000` with the SIWS message (`Chain ID: devnet`, nonce, expiry) |
| 5 | Confirm | Green dot, "Signed in as merchant"; server log `INFO: signed in` |
| 6 | **Open merchant dashboard** | "Signed in as" + your shortened address (checked server-side) |
| 7 | **Sign out** | Dashboard returns to "Sign in required" |
| 8 | Sign in again, **Cancel** in Phantom | "You cancelled the request in your wallet."; still signed out |
| 9 | Check the audit trail (below) | `auth.sign_in`, `auth.sign_out`; sessions `active 0, revoked 1` |

```bash
docker compose exec postgres psql -U solanapay -d solanapay \
  -c "select id, action, created_at from audit_logs order by id" \
  -c "select count(*) filter (where revoked_at is null and expires_at > now()) as active, count(*) filter (where revoked_at is not null) as revoked from sessions"
```

**Verified 2026-09-30** with Phantom (Chrome) on devnet: all 9 checks passed
(1.00 SOL, 20.00 USDC displayed; sign-in, sign-out and rejection behaved as expected).

Notes:
- Audit log IDs can have gaps: `npm run db:check` inserts and rolls back test rows,
  and PostgreSQL sequences never roll back. This is normal.
- Cancelled sign-ins and smoke tests leave unused challenges in `auth_nonces`;
  they expire after 5 minutes.

## 4. Payments

Invoice creation, Solana Pay QR codes, USDC payment and on-chain verification
are added in Phases 6–9; their devnet test steps will be added here.
