import Link from "next/link";
import type { RecentPaymentDto } from "@/lib/payments/payment-dto";
import { shortenAddress } from "@/lib/solana/address";
import { LocalTime } from "./local-time";

// Verified payments (dashboard "Recent payments"). Everything shown is public on-chain
// data plus the invoice it settled; Explorer links open the transaction itself.
export function PaymentTable({ payments }: { payments: RecentPaymentDto[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Time</th>
            <th className="px-4 py-3 font-medium">Invoice</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">From</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium"><span className="sr-only">Explorer</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {payments.map((payment) => (
            <tr key={payment.id} className="hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                <LocalTime iso={payment.blockTime ?? payment.verifiedAt} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono">
                <Link prefetch={false} href={`/invoices/${payment.invoiceId}`} className="text-slate-900 underline-offset-2 hover:underline">
                  {payment.invoiceNumber}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-mono">{payment.amountDisplay} USDC</td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-600" title={payment.senderWallet}>
                {shortenAddress(payment.senderWallet)}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {payment.commitment === "FINALIZED" ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Finalized</span>
                ) : (
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">Confirming</span>
                )}
                {payment.late && (
                  <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800" title="Paid after the invoice expired">
                    Late
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                <a href={payment.explorerUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                  Explorer
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
