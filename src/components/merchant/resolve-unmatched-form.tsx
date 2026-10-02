"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, postJson } from "@/lib/http/client";

// Marks an unmatched payment as handled, with a note. Resolving is final.
export function ResolveUnmatchedForm({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm underline">
        Mark resolved
      </button>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/payments/unmatched/${id}/resolve`, { note });
      router.refresh();
    } catch (e) {
      const err = e instanceof ApiRequestError ? e : null;
      setError(err?.fields.note ?? err?.message ?? "Something went wrong.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label className="block text-xs text-slate-600">
        How was it handled? (e.g. &quot;Refunded to sender&quot;, &quot;Matched to order 123 manually&quot;)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          autoFocus
          className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-900 focus:outline-none"
        />
      </label>
      <p className="text-xs text-slate-500">Resolving is final and recorded in the audit log.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={pending || note.trim() === ""} className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "Saving…" : "Resolve"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-lg border border-slate-300 px-3 text-xs font-medium">
          Cancel
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </form>
  );
}
