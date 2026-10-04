"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, sendJson } from "@/lib/http/client";

const input = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none";

// Settings: business name and email (PATCH /api/merchant). The payout wallet has its own
// signed flow (PayoutWalletForm).
export function ProfileForm({ name, email }: { name: string; email: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<ApiRequestError | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("saving");
    setError(null);
    try {
      await sendJson("PATCH", "/api/merchant", { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") });
      setState("saved");
      router.refresh(); // header and checkout pages show the new name
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError("InternalError", "Something went wrong."));
      setState("idle");
    }
  }

  return (
    <form onSubmit={onSubmit} onChange={() => state === "saved" && setState("idle")} className="max-w-lg space-y-5" noValidate>
      <label className="block text-sm font-medium">
        Business name
        <input name="name" required maxLength={120} defaultValue={name} className={input} />
        {error?.fields.name && <span className="mt-1 block text-red-700">{error.fields.name}</span>}
      </label>
      <label className="block text-sm font-medium">
        Email <span className="font-normal text-slate-500">(optional)</span>
        <input name="email" type="email" maxLength={254} defaultValue={email ?? ""} className={input} placeholder="payments@example.com" />
        {error?.fields.email && <span className="mt-1 block text-red-700">{error.fields.email}</span>}
      </label>
      {error && Object.keys(error.fields).length === 0 && <p className="text-sm text-red-700" role="alert">{error.message}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "saving"} className="h-10 rounded-lg bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && <span className="text-sm text-emerald-700" role="status">Saved</span>}
      </div>
    </form>
  );
}
