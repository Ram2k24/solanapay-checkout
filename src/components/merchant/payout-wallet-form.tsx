"use client";

import { getBase64Decoder } from "@solana/kit";
import { useConnectedWallet, useSignMessage } from "@solana/kit-plugin-wallet/react";
import { useClient } from "@solana/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, postJson } from "@/lib/http/client";
import { groupAddress, shortenAddress } from "@/lib/solana/address";
import type { SolanaClient } from "@/lib/solana/client";
import { describeWalletError } from "@/lib/wallet/errors";
import { checkSigner } from "@/lib/wallet/signer-check";

const input = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-slate-900 focus:outline-none";

type Step =
  | { name: "view" }
  | { name: "enter" }
  | { name: "confirm"; address: string } // the merchant checks the full address
  | { name: "signing"; address: string }
  | { name: "done"; address: string; otherSessionsRevoked: number };

// Settings: change the payout wallet (Phase 11.4, decisions D5 and D7). The server issues
// a one-time confirmation naming the new wallet; the wallet the merchant signed in with
// signs it. Future invoices are paid to the new wallet; existing invoices keep theirs.
export function PayoutWalletForm({ current, signedInWallet }: { current: string; signedInWallet: string }) {
  const router = useRouter();
  const client = useClient<SolanaClient>();
  const connected = useConnectedWallet(client);
  const signMessage = useSignMessage(client);
  const [step, setStep] = useState<Step>({ name: "view" });
  const [checked, setChecked] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onContinue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = String(new FormData(event.currentTarget).get("payoutWallet") ?? "").trim();
    setFieldError(address ? null : "Enter the new wallet address.");
    if (!address) return;
    setChecked(false);
    setError(null);
    setStep({ name: "confirm", address });
  }

  async function onApprove(address: string) {
    // The server only accepts a signature from the signed-in wallet; check before asking.
    if (connected?.account.address !== signedInWallet) {
      setError(`Connect the wallet you signed in with (${shortenAddress(signedInWallet)}), then try again.`);
      return;
    }
    setError(null);
    setStep({ name: "signing", address });
    try {
      const challenge = await postJson<{ nonce: string; message: string }>("/api/merchant/payout-wallet/challenge", { payoutWallet: address });
      const message = new TextEncoder().encode(challenge.message);
      const signature = await signMessage.dispatchAsync(message);
      if ((await checkSigner(signedInWallet, message, signature)) === "other-account") {
        setError(
          `Your wallet signed with a different account, not ${shortenAddress(signedInWallet)}. Switch your wallet app to that ` +
            "account, disconnect and reconnect it here, then try again. Nothing was changed.",
        );
        setStep({ name: "confirm", address });
        return;
      }
      const result = await postJson<{ otherSessionsRevoked: number }>("/api/merchant/payout-wallet", {
        nonce: challenge.nonce,
        signature: getBase64Decoder().decode(signature),
      });
      setStep({ name: "done", address, otherSessionsRevoked: result.otherSessionsRevoked });
      router.refresh();
    } catch (e) {
      if (e instanceof ApiRequestError && e.fields.payoutWallet) {
        setFieldError(e.fields.payoutWallet);
        setStep({ name: "enter" });
        return;
      }
      setError(e instanceof ApiRequestError ? e.message : describeWalletError(e));
      setStep({ name: "confirm", address });
    }
  }

  return (
    <div className="max-w-lg space-y-4 text-sm">
      <div>
        <p className="font-medium">Current payout wallet</p>
        <p className="mt-1 break-all font-mono text-slate-700">{current}</p>
        <p className="mt-1 text-slate-500">USDC payments for new invoices are sent directly to this wallet.</p>
      </div>

      {step.name === "view" && (
        <button type="button" onClick={() => setStep({ name: "enter" })} className="h-9 rounded-lg border border-slate-300 px-4 font-medium hover:bg-slate-50">
          Change payout wallet
        </button>
      )}

      {step.name === "enter" && (
        <form onSubmit={onContinue} className="space-y-3" noValidate>
          <label className="block font-medium">
            New payout wallet
            <input name="payoutWallet" className={input} spellCheck={false} autoComplete="off" />
            {fieldError && <span className="mt-1 block font-normal text-red-700">{fieldError}</span>}
          </label>
          <div className="flex gap-2">
            <button type="submit" className="h-9 rounded-lg bg-slate-900 px-4 font-medium text-white hover:bg-slate-800">Continue</button>
            <button type="button" onClick={() => setStep({ name: "view" })} className="h-9 rounded-lg px-4 text-slate-600 hover:bg-slate-50">Cancel</button>
          </div>
        </form>
      )}

      {(step.name === "confirm" || step.name === "signing") && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <p className="font-medium">Check the new payout wallet, character by character</p>
          <p className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-base" aria-label={`New payout wallet ${step.address}`}>
            {groupAddress(step.address).map((group, i) => <span key={i}>{group}</span>)}
          </p>
          <p>
            Future invoices will be paid to this wallet; existing invoices keep the current one. Payments sent to a
            wrong address can&apos;t be recovered.
          </p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
            I have checked every character of this address.
          </label>
          {error && <p className="text-red-700" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onApprove(step.address)}
              disabled={!checked || step.name === "signing"}
              className="h-9 rounded-lg bg-slate-900 px-4 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {step.name === "signing" ? "Approve in your wallet…" : "Approve in your wallet"}
            </button>
            <button type="button" onClick={() => setStep({ name: "view" })} disabled={step.name === "signing"} className="h-9 rounded-lg px-4 text-amber-900 hover:bg-amber-100">
              Cancel
            </button>
          </div>
          <p className="text-xs">Signing confirms the change; it never moves funds or costs a fee.</p>
        </div>
      )}

      {step.name === "done" && (
        <p className="rounded-lg bg-emerald-50 p-3 text-emerald-900" role="status">
          Payout wallet changed to <span className="font-mono">{shortenAddress(step.address)}</span>. New invoices will be paid there.
          {step.otherSessionsRevoked > 0 &&
            ` For your security, ${step.otherSessionsRevoked === 1 ? "1 other session was" : `${step.otherSessionsRevoked} other sessions were`} signed out.`}
        </p>
      )}
    </div>
  );
}
