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

## 4. Merchant profile and invoices (Phase 6)

| # | Action | Expected |
|---|---|---|
| 1 | Signed in, open `/dashboard` without a profile | Redirect to **/onboarding** |
| 2 | Create profile (payout wallet = your wallet) | Dashboard with zero counters |
| 3 | Create invoice: 10.00, order ID, 30 min | Detail page `INV-YYYY-00001`, Pending, countdown, server-set mint/recipient/reference |
| 4 | Amount `0` or `1.0000001` | Field error, no invoice created, no number used |
| 5 | Order ID left blank | Automatic `ORD-YYYY-00001` |
| 6 | Order ID `ORD-2026-00099` | "reserved for automatic order IDs" |
| 7 | Double-click Create | Exactly one invoice |
| 8 | Wait past a short expiry | Shown under **Expired** (row still `PENDING` until Phase 10) |
| 9 | `npm run db:seed -- --wallet <addr>` twice | 4 demo invoices, then `exists` ×4 |

**Verified 2026-09-30** with Phantom (Chrome): all checks passed; seed idempotent;
`APP_ENV=production` seed refused.

## 5. Payment link and QR (Phase 7)

| # | Action | Expected |
|---|---|---|
| 1 | Create invoice, open its detail page | QR, checkout link, Solana Pay link (`solana:<wallet>?amount=…&spl-token=4zMMC…&reference=…`) |
| 2 | Open the checkout link in an Incognito window | Public page: amount, merchant, invoice/order, shortened recipient, countdown, QR, Open in wallet; no customer reference |
| 3 | Scan the QR with a phone wallet on devnet | Payment request for the invoice amount to the merchant wallet (needs devnet SOL for the fee) |
| 4 | Invoice with 5-minute expiry, reload after expiry | Expired badge; no QR, no payment link or actions; no customer reference (checked in raw HTML) |

**Verified 2026-10-01** (Phantom on Chrome and Android):
- Checks 1, 2 and 4 passed. The raw HTML of the expired page contains no `solana:` link,
  no QR, no "Open in wallet" and not the customer reference marker.
- Check 3: Phantom mobile showed "1" (devnet USDC appears as "Unknown Token" because
  Circle's devnet mint has no wallet metadata; there's no USD value on devnet) and
  sent 1 USDC, **but without the reference** (see payment-flow.md, field finding).
  The invoice correctly stays Pending: detection/verification come in Phases 9–10.

## 6. Payments

Transaction Requests (Phase 7b), in-browser USDC payment (Phase 8) and on-chain
verification (Phase 9) add their devnet test steps here.
