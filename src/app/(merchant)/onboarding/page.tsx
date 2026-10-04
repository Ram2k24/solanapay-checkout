import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/merchant/onboarding-form";
import { getCurrentSession } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/merchant/current";
import { shortenAddress } from "@/lib/solana/address";

export const metadata = { title: "Set up merchant · SolanaPay Checkout" };

export default async function OnboardingPage() {
  const session = await getCurrentSession();
  if (!session) return null; // the layout shows the sign-in prompt
  if (await getCurrentMerchant()) redirect("/dashboard");

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Set up your merchant profile</h1>
      <p className="mt-2 max-w-lg text-sm text-slate-600">
        This appears on invoices and checkout pages. You can create invoices right after.
      </p>
      {/* Each wallet is its own account: easy to miss after switching accounts in the wallet (Phase 8.5). */}
      <p className="mt-4 max-w-lg rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        <span className="font-medium">Signed in as <span className="font-mono">{shortenAddress(session.walletAddress)}</span>.</span>{" "}
        Each wallet has its own merchant profile. If you already set one up with a different wallet, sign out and sign in
        with that wallet instead.
      </p>
      <OnboardingForm walletAddress={session.walletAddress} />
    </>
  );
}
