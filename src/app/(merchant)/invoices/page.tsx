import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { InvoiceTable } from "@/components/merchant/invoice-table";
import { getCurrentSession } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/merchant/current";
import { toInvoiceDto } from "@/lib/payments/invoice-dto";
import { LIST_STATUSES, listInvoices } from "@/lib/payments/list-invoices";

export const metadata = { title: "Invoices · SolanaPay Checkout" };

const querySchema = z.object({ status: z.enum(LIST_STATUSES).optional().catch(undefined), cursor: z.uuid().optional().catch(undefined) });
const TABS = [undefined, ...LIST_STATUSES] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await getCurrentSession())) return null;
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/onboarding");

  const { status, cursor } = querySchema.parse(await searchParams);
  const { invoices, nextCursor } = await listInvoices(merchant.id, { status, cursor, limit: 20 });
  const tabHref = (s?: string) => (s ? `/invoices?status=${s}` : "/invoices");

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
        <Link href="/invoices/new" className="inline-flex h-9 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">
          Create invoice
        </Link>
      </div>

      <nav aria-label="Filter by status" className="mt-6 flex gap-1 overflow-x-auto text-sm">
        {TABS.map((s) => (
          <Link key={s ?? "all"} href={tabHref(s)} aria-current={status === s ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 capitalize ${status === s ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {s ? s.toLowerCase() : "All"}
          </Link>
        ))}
      </nav>

      <div className="mt-4">
        {invoices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
            <p className="font-medium">{status || cursor ? "No invoices here" : "No invoices yet"}</p>
            <p className="mt-1 text-sm text-slate-600">Create an invoice to request a USDC payment.</p>
          </div>
        ) : (
          <InvoiceTable invoices={invoices.map((i) => toInvoiceDto(i))} />
        )}
      </div>

      <div className="mt-4 flex justify-between text-sm">
        {cursor ? <Link href={tabHref(status)} className="underline">First page</Link> : <span />}
        {nextCursor && (
          <Link href={`/invoices?${new URLSearchParams({ ...(status ? { status } : {}), cursor: nextCursor })}`} className="underline">
            Older invoices →
          </Link>
        )}
      </div>
    </>
  );
}
