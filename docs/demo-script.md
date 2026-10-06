# Demo videos — scripts

Colosseum asks for two videos, each **at most 3 minutes**: a pitch and a technical
walkthrough. Both scripts below run about 2:45, leaving a little margin. Everything
shown is the live devnet deployment, https://solanapay-checkout.vercel.app.

## Before recording

- **Wallets (Phantom, devnet):** a merchant account (signed in on the site), a customer
  account with a little devnet SOL and at least 1 test USDC
  ([faucet.circle.com](https://faucet.circle.com), Solana devnet), and Phantom on your
  phone set to devnet.
- **Never on screen:** the Vercel, Neon, Helius, GitHub settings or cron-job.org pages,
  `.env*` files, terminals with secrets. Close those tabs before recording.
- **Screen:** 1920×1080, browser zoom 110–125 %, notifications off. On Linux, OBS Studio
  or SimpleScreenRecorder works; record the phone with its screen recorder.
- **Fresh state:** create the merchant invoice for scene T5 just before recording, so its
  15–30 minute expiry doesn't run out mid-take.

---

## Video 1 — Pitch (≈ 2:45)

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | You (camera) or the landing page | "Hi, I'm Ram Mahato. I've worked on payment systems and cloud infrastructure, and now I build on Solana. This is SolanaPay Checkout: accept USDC with a QR code, paid straight to your wallet, verified on-chain." |
| 0:15–0:45 | Landing page, slowly scrolling | "Small merchants who want stablecoins today either share a wallet address and check transfers by hand — no link to the order, and a screenshot is not proof — or hand their money to a custodial processor. We wanted the middle: real invoices, proof from the chain, and the money never leaving the merchant's control." |
| 0:45–1:30 | Click **Try a demo payment** → checkout → pay with Phantom → **Payment confirmed** | "Here's the whole experience. A customer opens an invoice, pays with their own wallet, and within seconds the page confirms it. That confirmation doesn't come from the browser: our server found the transaction on Solana and checked the recipient, the token, the exact amount and the invoice's unique reference." |
| 1:30–2:00 | Merchant dashboard → Transactions → Explorer link | "The merchant signs in with their wallet, no password, creates invoices, and sees every verified payment with a link to Solana Explorer. Nothing is custodial: the app never holds funds or keys." |
| 2:00–2:20 | pitch.md "Target users" or a simple slide | "It's for small online and in-person businesses whose customers already hold USDC on Solana, and who want to accept it without a middleman." |
| 2:20–2:35 | Validation | "We haven't put it in front of merchants yet: the next step is a few small shops using the live devnet version, so we learn what they actually need before mainnet." |
| 2:35–2:45 | Roadmap | "Next: API keys, webhooks and e-commerce plugins so any shop can integrate it, then mainnet readiness. It's live on devnet today — try the demo." |

---

## Video 2 — Technical walkthrough (≈ 2:50)

| Time | On screen | Say |
|---|---|---|
| T1 0:00–0:20 | Architecture diagram (docs/pitch.md on GitHub) | "Next.js on Vercel, Postgres on Neon, Solana devnet through Helius. No custom smart contract: payments are standard SPL Token transfers, verified off-chain against public chain data — a smaller attack surface and the same funds flow as any wallet transfer." |
| T2 0:20–0:50 | Invoice page: QR, payment reference | "Each invoice gets a unique reference key. Over HTTPS the QR is a Solana Pay **Transaction Request**: the wallet asks our server for the transaction, and we build it only from the stored invoice — merchant's USDC account, exact amount, the reference as an extra account. We chose Transaction Requests because we saw Phantom's transfer links drop the reference; transfer links remain a fallback." |
| T3 0:50–1:25 | Phone: scan the QR in Phantom → approve → laptop page turns Paid | "The customer approves on their phone. The checkout page polls our status endpoint; the server calls getSignaturesForAddress on the reference, loads the transaction and checks recipient, Circle's USDC mint, the exact amount in base units, the reference and success. Confirmed shows Confirming; finalized marks it Paid. One signature can settle only one invoice — enforced by the database." |
| T4 1:25–1:45 | Explorer for that transaction | "Here it is on Explorer: the transfer into the merchant's token account and our reference key in the instruction." |
| T5 1:45–2:15 | Dashboard, Transactions, an unmatched or late example if you have one | "Payments that don't fit — wrong amount, a second payment, no reference — are never dropped or auto-accepted: they go to a review list. A scheduler every two minutes catches payments made after the page was closed and expires unpaid invoices, always checking the chain first." |
| T6 2:15–2:40 | README / GitHub Actions run | "Security: no keys anywhere, the browser is never the payment authority, the database enforces immutable terms and an append-only audit log, and the app connects as a role that can't disable those rules. It's tested with 595 unit and integration tests, browser tests with a Wallet Standard test wallet, and a live suite that re-verifies our real devnet payments — all in CI." |
| T7 2:40–2:50 | Landing page | "Code and docs are on GitHub; the demo is live. Thanks!" |

Check the numbers you say against the README on recording day; they grow as tests are added.
