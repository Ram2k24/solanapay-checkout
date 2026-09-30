"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { USDC_DECIMALS } from "@/lib/config/networks";
import { ApiRequestError, postJson } from "@/lib/http/client";
import { formatUnits } from "@/lib/money/format";
import { parseAmount } from "@/lib/money/parse";
import { INVOICE_EXPIRY_MINUTES, INVOICE_TEXT_LIMITS } from "@/lib/payments/policy";

const input = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none";
const PRESET_LABELS: Record<number, string> = { 15: "15 min", 30: "30 min", 60: "1 hour", 1440: "24 hours" };

function newIdempotencyKey() {
  return crypto.randomUUID();
}

// The browser only suggests; the server re-validates everything and decides all
// payment terms (network, token, recipient, reference).
export function CreateInvoiceForm({ maxAmountDisplay }: { maxAmountDisplay: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [expiryChoice, setExpiryChoice] = useState<string>(String(INVOICE_EXPIRY_MINUTES.default));
  const [customMinutes, setCustomMinutes] = useState("45");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  // One key per submission attempt: a double-click or network retry reuses it, so the
  // server returns the same invoice instead of creating a duplicate.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const preview = useMemo(() => {
    const parsed = parseAmount(amount.trim(), USDC_DECIMALS);
    return parsed.ok ? `${formatUnits(parsed.value, USDC_DECIMALS)} USDC = ${parsed.value.toLocaleString("en-US")} base units` : null;
  }, [amount]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const expiresInMinutes = expiryChoice === "custom" ? Number(customMinutes) : Number(expiryChoice);

    setPending(true);
    setError(null);
    try {
      const invoice = await postJson<{ id: string }>(
        "/api/invoices",
        {
          amount: amount.trim(),
          orderId: String(form.get("orderId") ?? ""),
          description: String(form.get("description") ?? ""),
          customerReference: String(form.get("customerReference") ?? ""),
          expiresInMinutes,
        },
        { "idempotency-key": idempotencyKey },
      );
      setIdempotencyKey(newIdempotencyKey());
      router.push(`/invoices/${invoice.id}`);
    } catch (e) {
      const err = e instanceof ApiRequestError ? e : new ApiRequestError("InternalError", "Something went wrong.");
      // A changed form is a new request: after a validation error, use a fresh key.
      if (err.code === "InvalidRequest" || err.code === "IdempotencyConflict") setIdempotencyKey(newIdempotencyKey());
      setError(err);
      setPending(false);
    }
  }

  const fieldError = (name: string) =>
    error?.fields[name] ? <span className="mt-1 block text-red-700">{error.fields[name]}</span> : null;

  return (
    <form onSubmit={onSubmit} className="mt-6 max-w-lg space-y-5" noValidate>
      <label className="block text-sm font-medium">
        Amount (USDC)
        <input
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${input} font-mono`}
          placeholder="10.00"
        />
        <span className="mt-1 block font-normal text-slate-500">
          {preview ?? `Up to ${USDC_DECIMALS} decimal places. Maximum ${maxAmountDisplay} USDC.`}
        </span>
        {fieldError("amount")}
      </label>
      <label className="block text-sm font-medium">
        Order ID <span className="font-normal text-slate-500">(optional)</span>
        <input name="orderId" maxLength={INVOICE_TEXT_LIMITS.orderId} className={`${input} font-mono`} placeholder="Your shop's order number, e.g. 10045" />
        <span className="mt-1 block font-normal text-slate-500">Leave blank to generate one automatically (ORD-year-00001, ORD-year-00002, …).</span>
        {fieldError("orderId")}
      </label>
      <label className="block text-sm font-medium">
        Description <span className="font-normal text-slate-500">(optional, shown to the customer)</span>
        <input name="description" maxLength={INVOICE_TEXT_LIMITS.description} className={input} placeholder="Laptop accessory purchase" />
        {fieldError("description")}
      </label>
      <label className="block text-sm font-medium">
        Customer reference <span className="font-normal text-slate-500">(optional, internal)</span>
        <input name="customerReference" maxLength={INVOICE_TEXT_LIMITS.customerReference} className={input} placeholder="Customer name or email" />
        {fieldError("customerReference")}
      </label>
      <fieldset>
        <legend className="text-sm font-medium">Expires after</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[...INVOICE_EXPIRY_MINUTES.presets.map(String), "custom"].map((value) => (
            <label key={value} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${expiryChoice === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 hover:bg-slate-50"}`}>
              <input type="radio" name="expiry" value={value} checked={expiryChoice === value} onChange={() => setExpiryChoice(value)} className="sr-only" />
              {value === "custom" ? "Custom" : PRESET_LABELS[Number(value)]}
            </label>
          ))}
        </div>
        {expiryChoice === "custom" && (
          <label className="mt-3 block text-sm">
            Minutes ({INVOICE_EXPIRY_MINUTES.min}–{INVOICE_EXPIRY_MINUTES.max})
            <input type="number" min={INVOICE_EXPIRY_MINUTES.min} max={INVOICE_EXPIRY_MINUTES.max} step={1} value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value)} className={`${input} w-32`} />
          </label>
        )}
        {fieldError("expiresInMinutes")}
      </fieldset>
      {error && Object.keys(error.fields).length === 0 && <p className="text-sm text-red-700" role="alert">{error.message}</p>}
      <button type="submit" disabled={pending} className="h-10 rounded-lg bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
        {pending ? "Creating invoice…" : "Create invoice"}
      </button>
    </form>
  );
}
