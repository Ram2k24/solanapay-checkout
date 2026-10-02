"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, postJson } from "@/lib/http/client";

type LookupResult =
  | { outcome: "invoice"; invoiceNumber: string; status: string }
  | { outcome: "unmatched"; created: boolean; entry: { amountDisplay: string } };

function describe(result: LookupResult): string {
  if (result.outcome === "invoice") return `This transaction belongs to ${result.invoiceNumber}; that invoice is now ${result.status.toLowerCase()}.`;
  return result.created
    ? `Recorded as an unmatched payment of ${result.entry.amountDisplay} USDC (listed below).`
    : "This transaction is already in your unmatched payments.";
}

// Verify a transaction by its signature. The server fetches it from the blockchain and
// checks that it paid your wallet; the signature itself proves nothing.
export function LookupTransactionForm() {
  const router = useRouter();
  const [signature, setSignature] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await postJson<LookupResult>("/api/payments/lookup", { signature: signature.trim() });
      setMessage({ text: describe(result), error: false });
      setSignature("");
      router.refresh();
    } catch (e) {
      const err = e instanceof ApiRequestError ? e : null;
      setMessage({ text: err?.fields.signature ?? err?.message ?? "Something went wrong.", error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-slate-200 p-4">
      <label className="block text-sm font-medium" htmlFor="lookup-signature">Look up a transaction</label>
      <p className="mt-1 text-xs text-slate-500">
        Paste a transaction signature, e.g. one a customer sent you. Only transactions that paid USDC to your payout wallet are recorded.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="lookup-signature"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="Transaction signature"
          className="block w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-slate-900 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || signature.trim() === ""}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {pending ? "Checking…" : "Look up"}
        </button>
      </div>
      {message && <p role="status" className={`mt-2 text-sm ${message.error ? "text-red-700" : "text-slate-700"}`}>{message.text}</p>}
    </form>
  );
}
