import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/merchant/auto-refresh";
import { InvoiceTable } from "@/components/merchant/invoice-table";
import { PaymentTable } from "@/components/merchant/payment-table";
import { getCurrentSession } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/merchant/current";
import { toInvoiceDto } from "@/lib/payments/invoice-dto";
import { getInvoiceSummary, getPaymentTotals } from "@/lib/payments/invoice-summary";
import { USDC_DECIMALS } from "@/lib/config/networks";
import { db } from "@/lib/db/client";
import { formatUnits } from "@/lib/money/format";
import { listInvoices } from "@/lib/payments/list-invoices";
import { listRecentPayments } from "@/lib/payments/list-payments";
import { toRecentPaymentDto } from "@/lib/payments/payment-dto";

export const metadata = { title: "Dashboard · SolanaPay Checkout" };

export default async function DashboardPage() {
  if (!(await getCurrentSession())) return null; // the layout shows the sign-in prompt
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/onboarding");

  const [summary, recent, payments, totals, unmatchedOpen] = await Promise.all([
    getInvoiceSummary(merchant.id),
    listInvoices(merchant.id, { limit: 5 }),
    listRecentPayments(merchant.id, 5),
    getPaymentTotals(merchant.id),
    db.unmatchedPayment.count({ where: { merchantId: merchant.id, status: "OPEN" } }),
  ]);
  const tiles: { label: string; value: string | number; note?: string }[] = [
    { label: "USDC received", value: formatUnits(totals.received, USDC_DECIMALS) },
    {
      label: "Confirming",
      value: summary.CONFIRMING,
      note: totals.confirming > 0n ? `${formatUnits(totals.confirming, USDC_DECIMALS)} USDC awaiting finality` : undefined,
    },
    { label: "Total invoices", value: summary.TOTAL },
    { label: "Pending", value: summary.PENDING },
    { label: "Paid", value: summary.PAID },
    { label: "Expired", value: summary.EXPIRED },
    { label: "Unmatched to review", value: unmatchedOpen },
  ];

  return (
    <>
      <p className="text-sm text-slate-500">{merchant.name}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <AutoRefresh renderedAt={new Date().toISOString()} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map(({ label, value, note }) => (
          <div key={label} className="rounded-xl border border-slate-200 p-4">
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
            {note && <dd className="mt-1 text-xs text-slate-500">{note}</dd>}
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        USDC received counts finalized, verified payments only; Confirming ones are counted once Solana finalizes
        them. Unmatched payments are listed under{" "}
        <Link href="/payments/unmatched" className="underline">Unmatched payments</Link> until you resolve them.
      </p>

      <h2 className="mt-8 font-medium">Recent payments</h2>
      <div className="mt-3">
        {payments.length ? (
          <PaymentTable payments={payments.map((p) => toRecentPaymentDto(p))} />
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
            No payments yet. They appear here once verified on Solana.
          </p>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="font-medium">Recent invoices</h2>
        <Link href="/invoices" className="text-sm underline">View all</Link>
      </div>
      <div className="mt-3">
        {recent.invoices.length ? (
          <InvoiceTable invoices={recent.invoices.map((i) => toInvoiceDto(i))} />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
            <p className="font-medium">No invoices yet</p>
            <Link href="/invoices/new" className="mt-3 inline-flex h-9 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white">
              Create your first invoice
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
