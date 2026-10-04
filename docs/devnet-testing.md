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
| 8 | Wait past a short expiry | Shown under **Expired** at once; the row becomes `EXPIRED` after the reconciler's chain check (Phase 10) |
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

## 8. Automatic detection and expiry (Phase 10)

Run the reconciler next to the dev server: `npm run reconciler` (another tab). Each
line is one run: `claimed`, `checked`, `confirming`, `paid`, `expired`, `unmatched`,
`deferred` (RPC budget used up), `rpcErrors`.

| # | Action | Expected |
|---|---|---|
| 1 | Leave an invoice past `expires_at + 3 min` with the reconciler running | It becomes EXPIRED after one chain check; audit `invoice.expired` |
| 2 | Open a pending checkout page, DevTools → Network → filter `status` | A request every ~3 s, never two at once; none while the tab is hidden; one at once when it's visible again |
| 3 | Pay it from the phone (transaction request, §6) and don't touch the laptop | The page changes to "Payment confirmed" by itself (status poll or reconciler, whichever looks first) |
| 4 | Stop the RPC (e.g. wrong `SOLANA_RPC_URL`), wait past expiry | `rpcErrors` grows, the invoice stays PENDING; fixed URL → expired on the next run |

**Verified 2026-10-02/03** (live devnet): 17 overdue invoices expired (4 retried after
public-RPC HTTP 429s); INV-2026-00019 paid from the phone and recorded by the reconciler
5.3 s after landing, page updated with no clicks; production build polls every ~3 s
with a clean console. See payment-flow.md §7.

## 9. In-browser payment

Desktop Chrome with the Phantom extension in Testnet Mode (devnet). Use a **customer**
account, not the merchant's payout wallet (that one is refused as self-payment). Fund
it with devnet SOL (https://faucet.solana.com) and USDC (https://faucet.circle.com,
Solana Devnet). Keep `npm run dev` and `npm run reconciler` running.

| # | Scenario | How | Expected |
|---|---|---|---|
| 1 | Wallet rejection | Pay → Cancel in Phantom | Grey "You cancelled…", Pay available again, invoice Pending, nothing on-chain |
| 2 | Insufficient USDC | Invoice above the balance | Phantom's simulation blocks it; Cancel → "cancelled" |
| 2b | Forced failure | Same, "Confirm (unsafe)" | Amber wallet error; nothing broadcast, no fee |
| 3 | Insufficient SOL | Account with USDC, 0 SOL | Phantom: "not enough SOL"; amber wallet error; invoice Pending |
| 4 | Duplicate attempt | Same invoice in two tabs; Pay in one | Other tab: "waiting for approval…", then "already sent…", no Pay button; 1 payment |
| 5 | Offline / slow | DevTools Network: Offline, then Slow 3G | Offline: "We couldn't prepare the payment", no wallet popup. Slow: works, just slower |
| 6 | Reload during approval | Pay, reload while the popup is open | Phantom's popup survives the reload and can still pay; the page shows the approval note, not a Pay button, for up to 2 min |
| 7 | Close and reopen | Pay, close the tab, reopen the link | Paid (found by the reconciler) |
| 8 | Hidden tab | Pay, switch tabs for 30 s | Paid on return (reconciler or the immediate poll on return) |
| 9 | Reload a paid page | Reload twice | The same server-recorded payment every time |

**Verified 2026-10-03/04** (live devnet, Phantom extension, INV-2026-00023 to 00040 and
a second test merchant's INV-2026-00001/00002): all ten scenarios as expected. Payments
were detected 2.5-10 s after landing, by the status API or the reconciler, always
matched by reference (also over plain `http://localhost`). Findings that changed the
code:

- **Two tabs paid one invoice twice** (INV-28, INV-29; 3-4 s apart, before detection).
  Phase 9 recorded the second payment as `DUPLICATE_PAYMENT`, never double-PAID, but the
  money moved twice. Fixed with the browser-wide attempt note (payment-flow.md §5);
  re-tested on INV-30/31: 1 transaction, 1 payment.
- **A page that didn't update after its status changed** (INV-31: the refresh reached
  the server, no console error, but the tab kept the old view; not reproducible).
  Fixed with the 5 s stale-page reload, proven by forcing the refresh to hang (INV-37:
  reload 4.9 s after detection, then Paid).
- **A popup left open by a reloaded page can still pay** (INV-38, confirmed within 5 s);
  confirmed after the blockhash expired, nothing lands. This is why the approval note
  holds for 2 minutes.
- **The wrong Phantom account signed in to the dashboard** created a second merchant;
  the onboarding page now shows which wallet is signed in.

## 10. Dashboard and settings (Phase 11)

Signed in as the merchant, production build (`npm run build && npm start`).

| # | Action | Expected |
|---|---|---|
| 1 | Open `/dashboard`, wait 35 s without clicking | "Updated HH:MM:SS" moves by ~30 s; one `dashboard?_rsc` request (Network) |
| 2 | Switch to another tab for a minute, come back | No requests while hidden; one at once on return |
| 3 | Pay a new invoice from another window (browser wallet, §9) | Within ≤ 30 s, without reloading: USDC received and Paid go up, the payment tops Recent payments |
| 4 | Leave a pending invoice's page open while it's paid | It switches to Paid on its own; its "Updated" line disappears |
| 5 | Settings → Profile: change the email, Save | "Saved"; audit `merchant.updated` with old and new values |
| 6 | Settings → Change payout wallet → another of your addresses | The address in groups of four; Approve is disabled until the box is ticked; Phantom shows "confirm a payout wallet change", not a sign-in |
| 7 | Approve | "Payout wallet changed"; audit `merchant.payout_wallet_changed`; new invoices pay the new wallet, old ones keep theirs |
| 8 | Start another change, Cancel in Phantom | "You cancelled the request in your wallet."; nothing changes |
| 9 | Change it back to your main wallet | As 7 |

**Verified 2026-10-04** (live devnet, production build): dashboard figures matched the
database exactly (18.00 USDC, 38 / 0 / 17 / 21, 2 unmatched; Recent payments INV-38…34);
"Updated" moved 10:18:19 → 10:18:50 on its own; INV-2026-00039 and 00040 paid from `BdSt…`
(recorded 5.6 s and 2.8 s after landing) appeared without reloads, and INV-40's invoice page
switched to Paid by itself and stopped refreshing. Payout wallet changed 4dqH → JBLD → 4dqH
with Phantom (two audited changes; one cancelled challenge left unused). After each refresh
only the navigation links re-prefetch (row links have prefetch off).

## 11. Transaction history (Phase 12)

| # | Action | Expected |
|---|---|---|
| 1 | Open Transactions | Verified payments, newest first, 20 per page ("Older transactions →" only with more than 20) |
| 2 | Tabs Confirming / Finalized / Late | Only matching payments; an empty tab says "No transactions match." |
| 3 | Search a full signature, then `inv-2026-00038` (lower case) | Exactly one row each |
| 4 | Search `INV-2026` | "Enter a full transaction signature or an invoice number…", no rows |
| 5 | Details on a row | Every stored field; compare with Solana Explorer (signature, slot, sender, status, time) |
| 6 | Download CSV and open it in a spreadsheet | 18 columns, one row per payment, newest first, UTC times; an empty view shows no download link |

**Verified 2026-10-04** (production build): 19 verified payments listed on one page;
filters, both search kinds and the invalid-input hint as expected; INV-2026-00040's
detail page matched Solana Explorer field for field (signature, fee payer `BdSt…`, slot
507244096, finalized, 04:39:04 UTC); the CSV had 19 rows totalling 20 USDC (matching the
dashboard), old phone-QR and new browser payments together, none of the other merchant's.
A spreadsheet shows `1.00` as `1` (number format); the file holds `1.00`.

## 12. Security hardening (Phase 13)

1. **Headers:** `curl -sI http://localhost:3000/ | grep -iE "content-security-policy|x-frame-options|x-content-type|referrer-policy|permissions-policy|x-powered-by"`
   shows five headers and no `X-Powered-By`. Browse sign-in, pay, dashboard and export:
   the console shows no "violates the Content Security Policy".
2. **App role:** `npm run db:check` ends with all checks PASS, including the
   `app role: cannot …` lines.
3. **Program as payout wallet:** Settings → Change payout wallet →
   `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (the Token-2022 program) → "This
   address is a program, not a wallet."; the wallet app never opens.
4. **Another merchant's wallet:** with two merchants, enter the other merchant's
   current payout wallet → "already another merchant's payout wallet".
5. **Different account:** signed in as A, switch the wallet app to account B without
   reconnecting, approve a change → "Your wallet signed with a different account";
   nothing changes.
6. **Other sessions:** signed in on two browsers, change the payout wallet in one → the
   page reports one other session signed out; the other browser is asked to sign in.
