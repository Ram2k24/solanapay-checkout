import Link from "next/link";
import type { InvoiceDto } from "@/lib/payments/invoice-dto";
import { LocalTime } from "./local-time";
import { StatusBadge } from "./status-badge";

export function InvoiceTable({ invoices }: { invoices: InvoiceDto[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Invoice</th>
            <th className="px-4 py-3 font-medium">Order</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invoices.map((invoice) => (
            <tr key={invoice.id} className="hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-3 font-mono">
                <Link href={`/invoices/${invoice.id}`} className="text-slate-900 underline-offset-2 hover:underline">
                  {invoice.invoiceNumber}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-600">{invoice.orderId ?? "—"}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-mono">{invoice.amountDisplay} USDC</td>
              <td className="px-4 py-3"><StatusBadge status={invoice.effectiveStatus} /></td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600"><LocalTime iso={invoice.createdAt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
