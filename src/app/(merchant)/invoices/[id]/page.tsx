import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { CopyButton } from "@/components/checkout/copy-button";
import { PaymentQr } from "@/components/checkout/payment-qr";
import { AutoRefresh } from "@/components/merchant/auto-refresh";
import { CheckPaymentButton } from "@/components/merchant/check-payment-button";
import { ExpiryCountdown } from "@/components/merchant/expiry-countdown";
import { LocalTime } from "@/components/merchant/local-time";
import { StatusBadge } from "@/components/merchant/status-badge";
import { getCurrentSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { publicEnv } from "@/lib/config/public-env";
import { getCurrentMerchant } from "@/lib/merchant/current";
import { toInvoiceDto } from "@/lib/payments/invoice-dto";
import { toPaymentDto, toUnmatchedPaymentDto } from "@/lib/payments/payment-dto";
import { paymentLinks } from "@/lib/payments/solana-pay";
import { UNMATCHED_REASONS } from "@/lib/payments/unmatched-labels";
import { shortenAddress } from "@/lib/solana/address";
import { explorerTxUrl } from "@/lib/solana/explorer";

export const metadata = { title: "Invoice · SolanaPay Checkout" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentSession())) return null;
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/onboarding");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  // Scoped to this merchant: another merchant's invoice is simply "not found".
  const row = await db.invoice.findFirst({
    where: { id, merchantId: merchant.id },
    include: { payment: true, unmatchedPayments: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) notFound();
  const invoice = toInvoiceDto(row);
  // Built from the stored row only (see docs/payment-flow.md, stored-invoice invariant).
  const checkoutUrl = `${publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/pay/${row.id}`;
  const links =
    invoice.effectiveStatus === "PENDING" ? paymentLinks(row, merchant.name, publicEnv.NEXT_PUBLIC_APP_URL) : null;
  // Recorded only by backend verification (Phase 9); never from browser input.
  const payment = row.payment ? toPaymentDto(row.payment) : null;
  const unmatched = row.unmatchedPayments.map((u) => toUnmatchedPaymentDto(u));
  // Keep the page current while the invoice can still change: payable, confirming, or
  // shown as expired while the stored row is still PENDING (grace period: the reconciler
  // checks the chain before expiring it, and a last-second payment may settle it).
  const mayChange = row.status === "PENDING" || row.status === "CONFIRMING";

  const details: [string, React.ReactNode][] = [
    ["Order ID", invoice.orderId ?? "—"],
    ["Customer reference", invoice.customerReference ?? "—"],
    ["Network", <span key="n" className="capitalize">{invoice.network.toLowerCase()}</span>],
    ["Recipient wallet", <span key="r" className="break-all font-mono text-xs">{invoice.recipientWallet}</span>],
    ["USDC mint", <span key="m" className="break-all font-mono text-xs">{invoice.tokenMint}</span>],
    ["Payment reference", <span key="ref" className="break-all font-mono text-xs">{invoice.reference}</span>],
    ["Amount (base units)", <span key="a" className="font-mono">{invoice.amount}</span>],
    ["Created", <LocalTime key="c" iso={invoice.createdAt} />],
    ["Expires", <LocalTime key="e" iso={invoice.expiresAt} />],
  ];

  return (
    <>
      <Link href="/invoices" className="text-sm text-slate-600 hover:text-slate-900">← Invoices</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-slate-500">{invoice.invoiceNumber}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {invoice.amountDisplay} <span className="text-lg font-medium text-slate-500">USDC</span>
          </h1>
          {invoice.description && <p className="mt-1 text-slate-600">{invoice.description}</p>}
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <StatusBadge status={invoice.effectiveStatus} />
          {invoice.effectiveStatus === "PENDING" && <ExpiryCountdown expiresAt={invoice.expiresAt} />}
          {mayChange && <AutoRefresh renderedAt={new Date().toISOString()} />}
        </div>
      </div>

      <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
        {details.map(([label, value], index) => (
          // With an odd number of fields, the last one spans both columns (no empty cell).
          <div key={label} className={`bg-white p-4 ${details.length % 2 === 1 && index === details.length - 1 ? "sm:col-span-2" : ""}`}>
            <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
            <dd className="mt-1 text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-6 rounded-xl border border-slate-200 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">Payment</h2>
            <p className="mt-1 text-sm text-slate-600">
              {payment
                ? payment.commitment === "FINALIZED"
                  ? "Verified on-chain and finalized."
                  : "Verified on-chain; waiting for finalization."
                : "No verified payment yet. The server checks the blockchain itself; nothing the customer's browser says counts."}
            </p>
          </div>
          {invoice.status !== "PAID" && <CheckPaymentButton invoiceId={invoice.id} />}
        </div>

        {payment && (
          <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Amount</dt>
              <dd className="font-medium">
                {payment.amountDisplay} USDC
                {payment.late && (
                  <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                    Paid late
                  </span>
                )}
              </dd>
            </div>
            <div><dt className="text-slate-500">From</dt><dd className="font-mono">{shortenAddress(payment.senderWallet)}</dd></div>
            <div><dt className="text-slate-500">Block time</dt><dd>{payment.blockTime ? <LocalTime iso={payment.blockTime} /> : "—"}</dd></div>
            <div><dt className="text-slate-500">Slot</dt><dd className="font-mono">{payment.slot}</dd></div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Transaction</dt>
              <dd className="mt-1 break-all font-mono text-xs">{payment.signature}</dd>
              <dd className="mt-2">
                <a href={explorerTxUrl(payment.signature, invoice.network)} target="_blank" rel="noreferrer" className="text-sm underline">
                  View on Solana Explorer
                </a>
              </dd>
            </div>
            {payment.late && (
              <p className="text-xs text-amber-800 sm:col-span-2">
                This payment landed after the invoice expired. It was accepted (the funds arrived), and flagged for your review.
              </p>
            )}
          </dl>
        )}

        {unmatched.length > 0 && (
          <div className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Other payments for this invoice need review</p>
            <ul className="mt-2 space-y-1">
              {unmatched.map((u) => (
                <li key={u.id}>
                  {UNMATCHED_REASONS[u.reason].label}: {u.amountDisplay} USDC ({u.status.toLowerCase()}){" "}
                  <a href={explorerTxUrl(u.signature, invoice.network)} target="_blank" rel="noreferrer" className="underline">
                    transaction
                  </a>
                </li>
              ))}
            </ul>
            <Link href="/payments/unmatched" className="mt-2 inline-block underline">Open unmatched payments</Link>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 p-6">
        <h2 className="font-medium">Payment link</h2>
        {links ? (
          <div className="mt-4 flex flex-col gap-6 sm:flex-row">
            <PaymentQr url={links.primary} size={200} />
            <div className="min-w-0 flex-1 space-y-4 text-sm">
              <div>
                <p className="text-slate-500">Customer checkout page</p>
                <p className="mt-1 break-all font-mono text-xs">{checkoutUrl}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <CopyButton text={checkoutUrl} label="Copy checkout link" />
                  <a href={checkoutUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg border border-slate-300 px-3 font-medium hover:bg-slate-50">
                    Open checkout
                  </a>
                </div>
              </div>
              <div>
                <p className="text-slate-500">
                  {links.kind === "transaction-request"
                    ? "Solana Pay transaction request (what the QR code contains)"
                    : "Solana Pay transfer link (what the QR code contains)"}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-slate-700">{links.primary}</p>
                <div className="mt-2"><CopyButton text={links.primary} label="Copy Solana Pay link" /></div>
              </div>
              {links.kind === "transaction-request" ? (
                <div>
                  <p className="text-slate-500">Basic transfer link (fallback for wallets without transaction requests)</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-700">{links.transfer}</p>
                  <div className="mt-2"><CopyButton text={links.transfer} label="Copy basic link" /></div>
                </div>
              ) : (
                <p className="text-xs text-amber-700">
                  The app URL is not HTTPS, so the QR code uses a basic transfer link. Some wallets drop the payment
                  reference from these links. Transaction requests need HTTPS (see docs/devnet-testing.md).
                </p>
              )}
              <p className="text-xs text-slate-500">
                Customers can scan the QR code with a Solana Pay wallet, or open the checkout page. Payments are
                detected automatically: within seconds while the checkout page is open, otherwise within a few minutes.
                Check for payment above looks right away.
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            This invoice is {invoice.effectiveStatus.toLowerCase()}, so no payment link is shown.
          </p>
        )}
      </section>
    </>
  );
}
