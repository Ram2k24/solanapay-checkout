import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalTime } from "@/components/merchant/local-time";
import { LookupTransactionForm } from "@/components/merchant/lookup-transaction-form";
import { ResolveUnmatchedForm } from "@/components/merchant/resolve-unmatched-form";
import { getCurrentSession } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/merchant/current";
import { listUnmatchedPayments } from "@/lib/payments/unmatched";
import { UNMATCHED_REASONS } from "@/lib/payments/unmatched-labels";
import { shortenAddress } from "@/lib/solana/address";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { publicEnv } from "@/lib/config/public-env";

export const metadata = { title: "Unmatched payments · SolanaPay Checkout" };

// Real USDC that reached the merchant's wallet but couldn't settle an invoice
// automatically (a suspense account). Never marked paid automatically.
export default async function UnmatchedPaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  if (!(await getCurrentSession())) return null;
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/onboarding");

  const status = (await searchParams).status === "RESOLVED" ? "RESOLVED" : "OPEN";
  const items = await listUnmatchedPayments(merchant.id, status);
  const tab = (value: "OPEN" | "RESOLVED", label: string) => (
    <Link
      href={value === "OPEN" ? "/payments/unmatched" : "/payments/unmatched?status=RESOLVED"}
      aria-current={status === value ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm ${status === value ? "bg-slate-100 font-medium" : "text-slate-600 hover:bg-slate-50"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Unmatched payments</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-600">
        USDC that arrived in your wallet but couldn&apos;t be matched to an invoice automatically. Review each one,
        refund or match it yourself, then mark it resolved.
      </p>

      <div className="mt-6"><LookupTransactionForm /></div>

      <div className="mt-6 flex gap-1">{tab("OPEN", "Open")}{tab("RESOLVED", "Resolved")}</div>

      {items.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-600">
          {status === "OPEN" ? "Nothing to review." : "No resolved entries yet."}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200">
          {items.map((item) => (
            <li key={item.id} className="grid gap-3 p-4 text-sm sm:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <p className="font-medium">
                  {item.amountDisplay} USDC
                  <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                    {UNMATCHED_REASONS[item.reason].label}
                  </span>
                </p>
                <p className="mt-1 text-slate-600">{UNMATCHED_REASONS[item.reason].detail}</p>
                <p className="mt-1 text-xs text-slate-500">
                  From {item.senderWallet ? <span className="font-mono">{shortenAddress(item.senderWallet)}</span> : "unknown"}
                  {" · "}
                  {item.blockTime ? <LocalTime iso={item.blockTime} /> : "time unknown"}
                  {item.invoiceId && (
                    <>
                      {" · "}
                      <Link href={`/invoices/${item.invoiceId}`} className="underline">{item.invoiceNumber}</Link>
                    </>
                  )}
                  {" · "}
                  <a href={explorerTxUrl(item.signature, publicEnv.NEXT_PUBLIC_SOLANA_NETWORK)} target="_blank" rel="noreferrer" className="underline">
                    View transaction
                  </a>
                </p>
                {item.resolutionNote && (
                  <p className="mt-2 text-xs text-slate-700">
                    Resolved{item.resolvedAt && <> on <LocalTime iso={item.resolvedAt} /></>}: {item.resolutionNote}
                  </p>
                )}
              </div>
              {item.status === "OPEN" && <div className="sm:w-72"><ResolveUnmatchedForm id={item.id} /></div>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
