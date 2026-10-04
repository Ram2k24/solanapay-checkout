import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { CopyButton } from "@/components/checkout/copy-button";
import { LocalTime } from "@/components/merchant/local-time";
import { getCurrentSession } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/merchant/current";
import { getPayment } from "@/lib/payments/list-payments";
import { toPaymentDetailDto } from "@/lib/payments/payment-dto";

export const metadata = { title: "Transaction · SolanaPay Checkout" };

const mono = "break-all font-mono text-xs";

// One verified payment with every stored field (§7I, decision D3). Scoped to the
// signed-in merchant: another merchant's payment id is simply "not found".
export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentSession())) return null;
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/onboarding");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const row = await getPayment(merchant.id, id);
  if (!row) notFound();
  const payment = toPaymentDetailDto(row);

  const fields: [string, React.ReactNode][] = [
    ["Invoice", <Link key="i" href={`/invoices/${payment.invoiceId}`} className="font-mono underline">{payment.invoiceNumber}</Link>],
    ["Order ID", <span key="o" className="font-mono">{payment.orderId ?? "—"}</span>],
    ["Amount", <span key="a">{payment.amountDisplay} USDC <span className="font-mono text-xs text-slate-500">({payment.amount} base units)</span></span>],
    ["Status", payment.commitment === "FINALIZED" ? "Finalized" : "Confirming (waiting for finality)"],
    ["Paid late", payment.late ? "Yes: after the invoice expired" : "No"],
    ["Network", <span key="n" className="capitalize">Solana {payment.network.toLowerCase()}</span>],
    ["From (sender wallet)", <span key="s" className={mono}>{payment.senderWallet}</span>],
    ["To (recipient wallet)", <span key="r" className={mono}>{payment.recipientWallet}</span>],
    ["Recipient token account", <span key="t" className={mono}>{payment.recipientTokenAccount}</span>],
    ["Token mint (USDC)", <span key="m" className={mono}>{payment.tokenMint}</span>],
    ["Payment reference", <span key="ref" className={mono}>{payment.reference}</span>],
    ["Slot", <span key="sl" className="font-mono">{payment.slot}</span>],
    ["Block time", payment.blockTime ? <LocalTime key="b" iso={payment.blockTime} /> : "—"],
    ["Verified", <LocalTime key="v" iso={payment.verifiedAt} />],
    ["Finalized", payment.finalizedAt ? <LocalTime key="f" iso={payment.finalizedAt} /> : "Not yet"],
    ["Recorded", <LocalTime key="c" iso={payment.createdAt} />],
    ["Internal ID", <span key="id" className={mono}>{payment.id}</span>],
  ];

  return (
    <>
      <Link href="/transactions" className="text-sm text-slate-600 hover:text-slate-900">← Transactions</Link>
      <p className="mt-3 text-sm text-slate-500">Transaction</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        {payment.amountDisplay} <span className="text-lg font-medium text-slate-500">USDC</span>
      </h1>

      <div className="mt-6 rounded-xl border border-slate-200 p-4">
        <p className="text-xs uppercase tracking-wider text-slate-500">Signature</p>
        <p className="mt-1 break-all font-mono text-sm">{payment.signature}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton text={payment.signature} label="Copy signature" />
          <a href={payment.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">
            View on Solana Explorer
          </a>
        </div>
      </div>

      <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
        {fields.map(([label, value], index) => (
          // With an odd number of fields, the last one spans both columns (no empty cell).
          <div key={label} className={`bg-white p-4 ${fields.length % 2 === 1 && index === fields.length - 1 ? "sm:col-span-2" : ""}`}>
            <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
            <dd className="mt-1 text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        Verified by the server against the stored invoice: recipient, USDC mint, exact amount, reference and network.
      </p>
    </>
  );
}
