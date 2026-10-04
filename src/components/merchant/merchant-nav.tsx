"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Invoices", href: "/invoices" },
  { label: "Create invoice", href: "/invoices/new" },
  { label: "Unmatched payments", href: "/payments/unmatched" },
  { label: "Transactions", href: "/transactions" },
  { label: "Settings", href: "/settings" },
] as const;

// Merchant navigation: a sidebar on desktop, a scrollable row on phones.
// `unmatchedOpen`: unmatched payments awaiting review (computed on the server).
export function MerchantNav({ unmatchedOpen = 0 }: { unmatchedOpen?: number }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/invoices"
      ? pathname === "/invoices" || /^\/invoices\/(?!new)/.test(pathname)
      : href === "/transactions"
        ? pathname === "/transactions" || pathname.startsWith("/transactions/")
        : pathname === href;

  return (
    <nav aria-label="Merchant" className="flex gap-1 overflow-x-auto text-sm lg:flex-col">
      {ITEMS.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={`whitespace-nowrap rounded-lg px-3 py-2 ${isActive(item.href) ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}
        >
          {item.label}
          {item.href === "/payments/unmatched" && unmatchedOpen > 0 && (
            <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800" aria-label={`${unmatchedOpen} to review`}>
              {unmatchedOpen}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
