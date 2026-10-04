import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AutoRefresh } from "@/components/merchant/auto-refresh";
import { PaymentTable } from "@/components/merchant/payment-table";
import { getCurrentSession } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/merchant/current";
import { listPayments, PAYMENT_FILTERS } from "@/lib/payments/list-payments";
import { toRecentPaymentDto } from "@/lib/payments/payment-dto";
import { parsePaymentSearch } from "@/lib/payments/payment-search";
import { transactionsHref } from "@/lib/payments/transactions-url";

export const metadata = { title: "Transactions · SolanaPay Checkout" };

// Transaction history (Phase 12): the merchant's verified incoming USDC payments.
// Money that couldn't settle an invoice stays under Unmatched payments (decision D1).
const querySchema = z.object({
  filter: z.enum(PAYMENT_FILTERS).optional().catch(undefined),
  q: z.string().max(120).optional().catch(undefined),
  cursor: z.uuid().optional().catch(undefined),
});
const TABS = [
  { filter: undefined, label: "All" },
  { filter: "CONFIRMING", label: "Confirming" },
  { filter: "FINALIZED", label: "Finalized" },
  { filter: "LATE", label: "Late" },
] as const;
const PAGE_SIZE = 20;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await getCurrentSession())) return null;
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/onboarding");

  const { filter, q, cursor } = querySchema.parse(await searchParams);
  const search = parsePaymentSearch(q);
  const { payments, nextCursor } =
    search === "invalid" ? { payments: [], nextCursor: null } : await listPayments(merchant.id, { filter, search, cursor, limit: PAGE_SIZE });
  const query = search && search !== "invalid" ? q?.trim() : undefined;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        {/* Only the first page changes as payments arrive (decision D6). */}
        {!cursor && <AutoRefresh renderedAt={new Date().toISOString()} />}
      </div>
      <p className="mt-2 max-w-2xl text-sm text-slate-600">
        USDC payments verified on Solana that settled your invoices. Money that couldn&apos;t be matched to an invoice
        is listed under <Link href="/payments/unmatched" className="underline">Unmatched payments</Link>.
      </p>

      <form action="/transactions" className="mt-6 flex max-w-xl gap-2" role="search">
        {filter && <input type="hidden" name="filter" value={filter} />}
        <label className="sr-only" htmlFor="q">Transaction signature or invoice number</label>
        <input
          id="q"
          name="q"
          defaultValue={q ?? ""}
          maxLength={120}
          spellCheck={false}
          autoComplete="off"
          placeholder="Transaction signature or invoice number"
          className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 font-mono text-sm focus:border-slate-900 focus:outline-none"
        />
        <button type="submit" className="h-9 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">Search</button>
        {q && <Link href={transactionsHref({ filter })} className="flex h-9 items-center px-2 text-sm text-slate-600 underline">Clear</Link>}
      </form>
      {search === "invalid" && (
        <p className="mt-2 text-sm text-amber-800" role="alert">
          Enter a full transaction signature or an invoice number such as INV-2026-00038.
        </p>
      )}

      <nav aria-label="Filter transactions" className="mt-4 flex gap-1 overflow-x-auto text-sm">
        {TABS.map((tab) => (
          <Link
            key={tab.label}
            href={transactionsHref({ filter: tab.filter, q: query })}
            aria-current={filter === tab.filter ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 ${filter === tab.filter ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-4">
        {payments.length ? (
          <PaymentTable payments={payments.map((p) => toRecentPaymentDto(p))} />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-600">
            {search || filter || cursor ? "No transactions match." : "No payments yet. They appear here once verified on Solana."}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-between text-sm">
        {cursor ? <Link href={transactionsHref({ filter, q: query })} className="underline">First page</Link> : <span />}
        {nextCursor && (
          <Link href={transactionsHref({ filter, q: query, cursor: nextCursor })} className="underline">
            Older transactions →
          </Link>
        )}
      </div>
    </>
  );
}
