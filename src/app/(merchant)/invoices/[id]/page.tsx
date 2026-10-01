import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { CopyButton } from "@/components/checkout/copy-button";
import { PaymentQr } from "@/components/checkout/payment-qr";
import { ExpiryCountdown } from "@/components/merchant/expiry-countdown";
import { LocalTime } from "@/components/merchant/local-time";
import { StatusBadge } from "@/components/merchant/status-badge";
import { getCurrentSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { publicEnv } from "@/lib/config/public-env";
import { getCurrentMerchant } from "@/lib/merchant/current";
import { toInvoiceDto } from "@/lib/payments/invoice-dto";
import { encodeTransferRequest } from "@/lib/payments/solana-pay";

export const metadata = { title: "Invoice · SolanaPay Checkout" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentSession())) return null;
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/onboarding");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  // Scoped to this merchant: another merchant's invoice is simply "not found".
  const row = await db.invoice.findFirst({ where: { id, merchantId: merchant.id } });
  if (!row) notFound();
  const invoice = toInvoiceDto(row);
  // Built from the stored row only (see docs/payment-flow.md, stored-invoice invariant).
  const checkoutUrl = `${publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/pay/${row.id}`;
  const paymentUrl = invoice.effectiveStatus === "PENDING" ? encodeTransferRequest(row, merchant.name) : null;

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
        <h2 className="font-medium">Payment link</h2>
        {paymentUrl ? (
          <div className="mt-4 flex flex-col gap-6 sm:flex-row">
            <PaymentQr url={paymentUrl} size={200} />
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
                <p className="text-slate-500">Solana Pay link (what the QR code contains)</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-700">{paymentUrl}</p>
                <div className="mt-2"><CopyButton text={paymentUrl} label="Copy Solana Pay link" /></div>
              </div>
              <p className="text-xs text-slate-500">
                Customers can scan the QR code with a Solana Pay wallet, or open the checkout page. Payment detection
                and on-chain verification are added in a later milestone; until then this invoice stays Pending.
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
