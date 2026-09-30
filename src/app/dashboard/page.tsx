import { SiteHeader } from "@/components/site-header";
import { NetworkBanner } from "@/components/network-banner";
import { getCurrentSession } from "@/lib/auth/session";
import { shortenAddress } from "@/lib/solana/address";

export const metadata = { title: "Dashboard · SolanaPay Checkout" };

// First protected page. The session is checked on the server on every request;
// nothing here is decided by browser-side state.
export default async function DashboardPage() {
  const session = await getCurrentSession();

  return (
    <>
      <NetworkBanner />
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Merchant dashboard</h1>
        {session ? (
          <div className="mt-6 rounded-xl border border-slate-200 p-6">
            <p className="text-sm text-slate-500">Signed in as</p>
            <p className="mt-1 font-mono">{shortenAddress(session.walletAddress)}</p>
            <p className="mt-4 text-sm text-slate-600">
              Your merchant profile, invoices and payments will appear here.
            </p>
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-6">
            <p className="font-medium">Sign in required</p>
            <p className="mt-2 text-sm text-slate-600">
              Use <span className="font-medium">Connect wallet</span> at the top right, then{" "}
              <span className="font-medium">Sign in with wallet</span>. Signing in proves you own the wallet; it
              never moves funds.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
