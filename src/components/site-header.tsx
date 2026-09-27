import Link from "next/link";
import { publicEnv } from "@/lib/config/public-env";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span aria-hidden className="grid size-7 place-items-center rounded-md bg-slate-900 text-xs text-white">
            SP
          </span>
          SolanaPay Checkout
        </Link>
        <nav className="flex items-center gap-6 text-sm text-slate-600">
          <a href="#how-it-works" className="hidden hover:text-slate-900 sm:inline">How it works</a>
          <a href="#verification" className="hidden hover:text-slate-900 sm:inline">Verification</a>
          <a href="#technology" className="hidden hover:text-slate-900 sm:inline">Technology</a>
          <span className="rounded-full border border-slate-200 px-2.5 py-0.5 font-mono text-xs capitalize text-slate-700">
            {publicEnv.NEXT_PUBLIC_SOLANA_NETWORK}
          </span>
        </nav>
      </div>
    </header>
  );
}
