import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/merchant/onboarding-form";
import { getCurrentSession } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/merchant/current";

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
      <OnboardingForm walletAddress={session.walletAddress} />
    </>
  );
}
