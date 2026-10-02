"use client";

import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import type { PollerState } from "@/lib/payments/status-poller";
import { useInvoiceStatus } from "@/lib/react/use-invoice-status";

function describe(status: InvoiceStatus, polling: PollerState): string {
  if (polling === "stopped") return "Automatic updates have stopped. Reload the page to check again.";
  if (polling === "paused") return "Updates paused while this tab is in the background.";
  if (polling === "backoff") return "Having trouble reaching the server; retrying shortly…";
  if (status === "CONFIRMING") return "Checking for final confirmation automatically…";
  if (status === "EXPIRED") return "Checking once more for a payment made just before expiry…";
  return "Waiting for your payment. This page updates automatically.";
}

// Keeps the public checkout page current while the customer pays. When the invoice's
// status changes, it asks the server to re-render the page (router.refresh()): the
// payment details shown always come from the server, never from this component.
export function StatusWatcher({ invoiceId, initialStatus, expiresAt }: { invoiceId: string; initialStatus: InvoiceStatus; expiresAt: string }) {
  const router = useRouter();
  const { status, polling } = useInvoiceStatus(invoiceId, {
    initialStatus,
    expiresAt,
    onChange: () => router.refresh(),
  });

  return (
    <p role="status" aria-live="polite" className="mt-4 text-center text-xs text-slate-500">
      {describe(status, polling)}
    </p>
  );
}
