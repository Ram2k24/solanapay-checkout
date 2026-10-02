"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, postJson } from "@/lib/http/client";

type VerifyResponse = { status: string; recorded: { signature: string; outcome: string }[] };

function describe(result: VerifyResponse): string {
  const outcomes = result.recorded.map((r) => r.outcome);
  if (result.status === "PAID") return "Payment verified on-chain and finalized. The invoice is paid.";
  if (result.status === "CONFIRMING") return "Payment found and confirmed. Waiting for finalization (usually under a minute); check again shortly.";
  if (outcomes.some((o) => o.startsWith("unmatched-"))) {
    return "A payment was found, but it can't settle this invoice. It's listed under Unmatched payments.";
  }
  return "No payment found for this invoice yet.";
}

// Asks the server to look for this invoice's payment on-chain now. The browser sends
// only the invoice ID; the server verifies everything and decides the status.
export function CheckPaymentButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function check() {
    setPending(true);
    setMessage(null);
    try {
      const result = await postJson<VerifyResponse>(`/api/invoices/${invoiceId}/verify`);
      setMessage({ text: describe(result), error: false });
      router.refresh(); // re-render the server components with the new status and payment
    } catch (e) {
      setMessage({ text: e instanceof ApiRequestError ? e.message : "Something went wrong.", error: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={check}
        disabled={pending}
        className="inline-flex h-9 items-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? "Checking on-chain…" : "Check for payment"}
      </button>
      {message && (
        <p role="status" className={`text-sm ${message.error ? "text-red-700" : "text-slate-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
