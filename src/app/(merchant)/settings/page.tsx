import { redirect } from "next/navigation";
import { PayoutWalletForm } from "@/components/merchant/payout-wallet-form";
import { ProfileForm } from "@/components/merchant/profile-form";
import { getCurrentSession } from "@/lib/auth/session";
import { publicEnv } from "@/lib/config/public-env";
import { getCurrentMerchant } from "@/lib/merchant/current";

export const metadata = { title: "Settings · SolanaPay Checkout" };

// Merchant settings (Phase 11.4, §7J): profile, payout wallet, and what the deployment
// decides. Notification and webhook preferences come when something can send them.
export default async function SettingsPage() {
  if (!(await getCurrentSession())) return null; // the layout shows the sign-in prompt
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/onboarding");

  return (
    <>
      <p className="text-sm text-slate-500">{merchant.name}</p>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="mt-8 border-t border-slate-100 pt-6">
        <h2 className="mb-4 font-medium">Profile</h2>
        <ProfileForm name={merchant.name} email={merchant.email} />
      </section>

      <section className="mt-8 border-t border-slate-100 pt-6">
        <h2 className="mb-4 font-medium">Payout wallet</h2>
        <PayoutWalletForm current={merchant.payoutWallet} signedInWallet={merchant.session.walletAddress} />
      </section>

      <section className="mt-8 border-t border-slate-100 pt-6">
        <h2 className="mb-1 font-medium">Network and currency</h2>
        <p className="mb-4 text-sm text-slate-500">Set by the deployment, the same for every merchant.</p>
        <dl className="grid max-w-lg grid-cols-2 gap-3 text-sm">
          <div><dt className="text-slate-500">Currency</dt><dd>USDC</dd></div>
          <div><dt className="text-slate-500">Network</dt><dd className="capitalize">Solana {publicEnv.NEXT_PUBLIC_SOLANA_NETWORK}</dd></div>
        </dl>
      </section>
    </>
  );
}
