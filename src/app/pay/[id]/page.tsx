import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/checkout/copy-button";
import { PaymentQr } from "@/components/checkout/payment-qr";
import { StatusWatcher } from "@/components/checkout/status-watcher";
import { ExpiryCountdown } from "@/components/merchant/expiry-countdown";
import { LocalTime } from "@/components/merchant/local-time";
import { StatusBadge } from "@/components/merchant/status-badge";
import { NetworkBanner } from "@/components/network-banner";
import { ApiError } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { getPublicCheckout } from "@/lib/payments/checkout";
import { POLLING } from "@/lib/payments/status-poller";

// Public: payment links are shared with customers, so no sign-in. Kept out of search engines.
export const metadata: Metadata = { title: "Pay invoice · SolanaPay Checkout", robots: { index: false, follow: false } };

const STATUS_MESSAGES = {
  EXPIRED: "This invoice has expired. Ask the merchant for a new payment link.",
  CONFIRMING: "Payment received. Waiting for final confirmation on Solana…",
  PAID: "This invoice has been paid. Thank you!",
  FAILED: "This invoice can no longer be paid. Please contact the merchant.",
  DRAFT: "This invoice is not ready for payment yet.",
} as const;

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await enforceRateLimit(`pay:view:${ip}`, 60, 60);
  } catch (error) {
    if (error instanceof ApiError && error.code === "RateLimited") return <TooManyRequests />;
    throw error;
  }

  const { id } = await params;
  const checkout = await getPublicCheckout(id);
  if (!checkout) notFound();
  // Watch for changes while the invoice can still change for the customer: PENDING,
  // CONFIRMING, or shown as EXPIRED within 5 minutes (a last-second payment may still land).
  const watch =
    checkout.status === "PENDING" ||
    checkout.status === "CONFIRMING" ||
    (checkout.status === "EXPIRED" && Date.now() < new Date(checkout.expiresAt).getTime() + POLLING.postExpiryWindowMs);

  return (
    <>
      <NetworkBanner />
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span aria-hidden className="grid size-6 place-items-center rounded bg-slate-900 text-[10px] text-white">SP</span>
            SolanaPay Checkout
          </Link>
          <span className="rounded-full border border-slate-200 px-2.5 py-0.5 font-mono text-xs capitalize text-slate-700">
            {checkout.network.toLowerCase()}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-8">
        <div className="rounded-2xl border border-slate-200 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">Pay {checkout.merchantName}</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight">
                {checkout.amountDisplay} <span className="text-xl font-medium text-slate-500">{checkout.currency}</span>
              </p>
              {checkout.description && <p className="mt-2 text-slate-700">{checkout.description}</p>}
            </div>
            <StatusBadge status={checkout.status} />
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
            <div><dt className="text-slate-500">Invoice</dt><dd className="font-mono">{checkout.invoiceNumber}</dd></div>
            <div><dt className="text-slate-500">Order</dt><dd className="font-mono">{checkout.orderId ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Paid to</dt><dd className="font-mono">{checkout.recipientShort}</dd></div>
            <div><dt className="text-slate-500">Network</dt><dd className="capitalize">Solana {checkout.network.toLowerCase()}</dd></div>
          </dl>

          {checkout.payment ? (
            <div className="mt-6 flex flex-col items-center gap-4 border-t border-slate-100 pt-6">
              <p className="text-sm font-medium"><ExpiryCountdown expiresAt={checkout.expiresAt} /></p>
              <PaymentQr url={checkout.payment.primary} />
              <p className="max-w-sm text-center text-sm text-slate-600">
                Scan with a Solana Pay wallet such as Phantom or Solflare. Make sure your wallet is set to{" "}
                <span className="font-medium capitalize">{checkout.network.toLowerCase()}</span>. Approve the
                payment promptly; if it doesn&apos;t go through, scan again.
              </p>
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
                <a href={checkout.payment.primary} className="inline-flex h-11 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800">
                  Open in wallet
                </a>
                <CopyButton text={checkout.payment.primary} label="Copy payment link" />
              </div>
              {checkout.payment.kind === "transaction-request" && (
                <details className="w-full max-w-sm text-sm text-slate-600">
                  <summary className="cursor-pointer text-center">Wallet doesn&apos;t support this QR code?</summary>
                  <p className="mt-2">
                    Use the basic payment link instead. Some wallets send these payments without the invoice
                    reference, so the merchant may need to match your payment manually.
                  </p>
                  <div className="mt-2 flex justify-center gap-2">
                    <a href={checkout.payment.transfer} className="inline-flex h-9 items-center rounded-lg border border-slate-300 px-3 font-medium hover:bg-slate-50">
                      Open basic link
                    </a>
                    <CopyButton text={checkout.payment.transfer} label="Copy basic link" />
                  </div>
                </details>
              )}
            </div>
          ) : checkout.confirmation ? (
            <div className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
              <p className="font-medium">
                {checkout.confirmation.finalized ? "Payment confirmed" : "Payment received, waiting for final confirmation on Solana…"}
              </p>
              <dl className="mt-3 space-y-2">
                <div><dt className="text-emerald-800">Amount</dt><dd>{checkout.confirmation.amountDisplay} {checkout.currency}</dd></div>
                <div><dt className="text-emerald-800">Network</dt><dd className="capitalize">Solana {checkout.network.toLowerCase()}</dd></div>
                {checkout.confirmation.blockTime && (
                  <div><dt className="text-emerald-800">Time</dt><dd><LocalTime iso={checkout.confirmation.blockTime} /></dd></div>
                )}
                <div>
                  <dt className="text-emerald-800">Transaction</dt>
                  <dd className="break-all font-mono text-xs">{checkout.confirmation.signature}</dd>
                </div>
              </dl>
              <a href={checkout.confirmation.explorerUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block underline">
                View on Solana Explorer
              </a>
            </div>
          ) : (
            <p className="mt-6 rounded-lg bg-slate-50 p-4 text-sm text-slate-700" role="status">
              {STATUS_MESSAGES[checkout.status as keyof typeof STATUS_MESSAGES]}
            </p>
          )}
          {watch && <StatusWatcher invoiceId={id} initialStatus={checkout.status} expiresAt={checkout.expiresAt} />}
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">
          Never share your seed phrase or private key. This page will never ask for them.
        </p>
      </main>
    </>
  );
}

function TooManyRequests() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="font-medium">Too many requests</p>
      <p className="mt-2 text-sm text-slate-600">Please wait a minute and reload the page.</p>
    </main>
  );
}
