"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, postJson } from "@/lib/http/client";

// "Try a demo payment" (Phase 16): asks the server for a fresh 0.01 USDC demo invoice,
// then opens its normal checkout page. Everything after that is the real payment flow.
export function DemoButton({ className }: { className: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const { id } = await postJson<{ id: string }>("/api/demo/invoice");
      router.push(`/pay/${id}`);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Couldn't start the demo. Please try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={start} disabled={pending} className={`${className} disabled:cursor-wait disabled:opacity-60`}>
        {pending ? "Creating demo invoice…" : "Try a demo payment"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
