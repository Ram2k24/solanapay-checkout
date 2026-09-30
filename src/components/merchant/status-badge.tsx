import type { InvoiceStatus } from "@/generated/prisma/enums";

const STYLES: Record<InvoiceStatus, string> = {
  DRAFT: "bg-slate-50 text-slate-600 ring-slate-200",
  PENDING: "bg-amber-50 text-amber-800 ring-amber-200",
  CONFIRMING: "bg-sky-50 text-sky-800 ring-sky-200",
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  EXPIRED: "bg-slate-100 text-slate-600 ring-slate-200",
  FAILED: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ${STYLES[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}
