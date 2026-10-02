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

## 6. Transaction Requests on a phone (Phase 7b)

Transaction requests need an HTTPS app URL, and a phone can't reach `localhost`, so
phone tests use a **temporary** Cloudflare quick tunnel (no account needed; testing
only; a new random URL on every start; it stops when the process stops).

1. Download `cloudflared-linux-amd64` from the official GitHub releases into a
   scratch folder **outside the repo** and verify its SHA-256 against the release
   notes before running it (`sha256sum -c`). Never commit it.
2. Create the test invoice **first**, with the normal setup (signed in on
   `http://localhost:3000`), then stop the dev server.
3. Start the tunnel (keeps the exposure window short):
   `./cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3000` and note the
   `https://….trycloudflare.com` URL.
4. Restart the dev server with the tunnel URL as the app URL, **without editing
   `.env`**: `NEXT_PUBLIC_APP_URL=https://….trycloudflare.com npm run dev`
   (`process.env` takes precedence over `.env` in Next.js).
5. On the laptop, open the checkout page at **`http://localhost:3000/pay/<id>`**. The
   QR now contains the transaction request on the tunnel URL. Don't browse the app
   through the tunnel hostname: the Next.js dev server blocks its dev assets for
   hostnames not listed in `allowedDevOrigins`, and we deliberately don't add one.
   Merchant pages will look signed out while the app URL is HTTPS (the session
   cookie name changes to `__Host-sp_session`); that's expected.
6. While the tunnel runs, **the dev server is reachable from the internet** at that URL.
   Stop the tunnel as soon as the test is done.
7. Afterwards: stop cloudflared, restart the dev server normally (`npm run dev`),
   delete the binary.

| # | Action | Expected |
|---|---|---|
| 1 | `localhost:3000/pay/<id>` with the tunnel app URL | QR encodes `solana:https://…/api/pay/<id>/transaction`; "Wallet doesn't support this QR code?" offers the basic link |
| 2 | Scan with Phantom (devnet) | Merchant name, SP icon, domain; −amount of devnet USDC ("Unknown" token), small SOL fee |
| 3 | Approve | `getSignaturesForAddress(reference)` finds the transaction; invoice stays Pending until Phase 9 |
| 4 | Invoice with < 2 minutes left | Wallet shows an error (the server returns 409 `InvoiceNotPayable`) |
| 5 | App URL http (normal local dev) | QR is the transfer request, with a note that HTTPS enables transaction requests |

**Verified 2026-10-01** in the real app (dev server + quick tunnel, Phantom on Android,
invoice INV-2026-00017, 1 USDC):
- Checks 1, 2 and 5 passed: the checkout page served the transaction request with the
  fallback section; Phantom showed "Laptop Store", the SP icon, the tunnel domain, −1
  "Unknown" (devnet USDC), "This domain is new", and a fee < 0.00001 SOL.
- Check 3 passed: transaction
  `39m866ogKRdHeuqrePGz7TwXrr3u1bcUsc5eaH2QrxtEUnPyDHR9pycmCCEfj1zd65HqzE2sRKCpJnga8emL9YE3`
  (finalized ~5 s after our server served it) was found by the invoice's stored
  reference and matches the stored amount, decimals, mint and recipient. The invoice
  stays Pending (verification is Phase 9).
- **First attempt didn't land:** a scan whose transaction was served at 17:29:15 UTC
  was approved but never reached the chain (no transaction for the reference, balance
  unchanged). A rescan approved within seconds landed. Consistent with the wallet
  keeping our blockhash (valid ~60–90 s) and the approval coming too late, but the
  cause is **unconfirmed**. The checkout page should ask customers to approve promptly
  and rescan if a payment doesn't go through.
- Check 4 (< 2 minutes left) is covered by integration tests; not tried on the phone.

The earlier prototype (throwaway spike) result is in payment-flow.md §4b.

## 7. Payment verification (Phase 9)

| # | Action | Expected |
|---|---|---|
| 1 | Pay an invoice (phone, §6), then **Check for payment** on its page | Paid (or Confirming, then Paid on a later check): amount, sender, block time, slot, signature, Explorer link |
| 2 | Check again | Nothing changes (idempotent) |
| 3 | **Unmatched payments → Look up a transaction** with a payment that has no reference | Recorded as "No reference"; open count in the navigation |
| 4 | Look up a transaction that doesn't pay your wallet | "This transaction doesn't send USDC to your payout wallet."; nothing recorded |
| 5 | **Mark resolved** with a note | Moves to Resolved with the note; final |
| 6 | Customer page of the paid invoice | "Payment confirmed" with signature and Explorer link; no QR, no payer wallet |
| 7 | Dashboard | USDC received = sum of finalized payments; Unmatched to review = open count |

**Verified 2026-10-02** (live devnet RPC): INV-2026-00017 → Paid (`39m866og…`, not late);
`5txudqhx…` → No reference → resolved; customer page and dashboard as expected.

## 8. In-browser payment

Phase 8 adds its devnet test steps here.
