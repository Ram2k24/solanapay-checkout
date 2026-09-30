"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, postJson } from "@/lib/http/client";

const input = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none";

export function OnboardingForm({ walletAddress }: { walletAddress: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await postJson("/api/merchant", {
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        payoutWallet: String(form.get("payoutWallet") ?? ""),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError("InternalError", "Something went wrong."));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 max-w-lg space-y-5" noValidate>
      <label className="block text-sm font-medium">
        Business name
        <input name="name" required maxLength={120} className={input} placeholder="Acme Store" />
        {error?.fields.name && <span className="mt-1 block text-red-700">{error.fields.name}</span>}
      </label>
      <label className="block text-sm font-medium">
        Email <span className="font-normal text-slate-500">(optional)</span>
        <input name="email" type="email" maxLength={254} className={input} placeholder="payments@example.com" />
        {error?.fields.email && <span className="mt-1 block text-red-700">{error.fields.email}</span>}
      </label>
      <label className="block text-sm font-medium">
        Payout wallet
        <input name="payoutWallet" defaultValue={walletAddress} className={`${input} font-mono`} spellCheck={false} />
        <span className="mt-1 block font-normal text-slate-500">
          USDC payments are sent directly to this wallet. Defaults to the wallet you signed in with.
        </span>
        {error?.fields.payoutWallet && <span className="mt-1 block text-red-700">{error.fields.payoutWallet}</span>}
      </label>
      {error && Object.keys(error.fields).length === 0 && <p className="text-sm text-red-700" role="alert">{error.message}</p>}
      <button type="submit" disabled={pending} className="h-10 rounded-lg bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
        {pending ? "Creating…" : "Create merchant profile"}
      </button>
    </form>
  );
}
