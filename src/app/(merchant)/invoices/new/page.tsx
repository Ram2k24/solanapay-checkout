import { redirect } from "next/navigation";
import { CreateInvoiceForm } from "@/components/merchant/create-invoice-form";
import { serverEnv } from "@/lib/config/server-env";
import { getCurrentSession } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/merchant/current";

export const metadata = { title: "Create invoice · SolanaPay Checkout" };

export default async function NewInvoicePage() {
  if (!(await getCurrentSession())) return null;
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/onboarding");

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create invoice</h1>
      <p className="mt-2 max-w-lg text-sm text-slate-600">
        Paid in USDC on Solana {serverEnv.network} to{" "}
        <span className="font-mono">{merchant.payoutWallet.slice(0, 4)}…{merchant.payoutWallet.slice(-4)}</span>.
      </p>
      <CreateInvoiceForm maxAmountDisplay={serverEnv.MAX_INVOICE_AMOUNT_USDC} />
    </>
  );
}
