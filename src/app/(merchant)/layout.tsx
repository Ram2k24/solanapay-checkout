import { NetworkBanner } from "@/components/network-banner";
import { SiteHeader } from "@/components/site-header";
import { MerchantNav } from "@/components/merchant/merchant-nav";
import { getCurrentSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { getCurrentMerchant } from "@/lib/merchant/current";

// Layout for all merchant pages. Access is decided here, on the server, from the
// session cookie; signed-out visitors see only the sign-in prompt.
export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  const merchant = session ? await getCurrentMerchant() : null;
  const unmatchedOpen = merchant ? await db.unmatchedPayment.count({ where: { merchantId: merchant.id, status: "OPEN" } }) : 0;

  return (
    <>
      <NetworkBanner />
      <SiteHeader />
      {session ? (
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[200px_1fr] lg:gap-10">
          {/* min-w-0: lets the nav row scroll inside the column instead of widening the page. */}
          <aside className="min-w-0">
            <MerchantNav unmatchedOpen={unmatchedOpen} />
          </aside>
          <main className="min-w-0">{children}</main>
        </div>
      ) : (
        <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="rounded-xl border border-dashed border-slate-300 p-6">
            <p className="font-medium">Sign in required</p>
            <p className="mt-2 text-sm text-slate-600">
              Use <span className="font-medium">Connect wallet</span> at the top right, then{" "}
              <span className="font-medium">Sign in with wallet</span>. Signing in proves you own the wallet; it never
              moves funds.
            </p>
          </div>
        </main>
      )}
    </>
  );
}
