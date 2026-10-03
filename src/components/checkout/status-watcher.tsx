"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { useInvoiceStatus } from "@/lib/react/use-invoice-status";
import { describeWatch, STALE_PAGE_RELOAD_MS } from "./status-watch-text";

// Keeps the public checkout page current while the customer pays. When the invoice's
// status changes, it asks the server to re-render the page (router.refresh()): the
// payment details shown always come from the server, never from this component.
//
// `initialStatus` is the status the server-rendered page shows; a refresh that applies
// updates it (or removes this component). If the poller's status still differs after
// STALE_PAGE_RELOAD_MS, the refresh didn't apply (seen once on devnet in Phase 8.5,
// without any error), so the page is reloaded once. Both sides compute the status the
// same way from the same row, so a fresh page agrees with the poller and can't loop.
export function StatusWatcher({ invoiceId, initialStatus, expiresAt }: { invoiceId: string; initialStatus: InvoiceStatus; expiresAt: string }) {
  const router = useRouter();
  const { status, polling } = useInvoiceStatus(invoiceId, {
    initialStatus,
    expiresAt,
    onChange: () => router.refresh(),
  });

  useEffect(() => {
    if (status === initialStatus) return;
    const timer = setTimeout(() => window.location.reload(), STALE_PAGE_RELOAD_MS);
    return () => clearTimeout(timer);
  }, [status, initialStatus]);

  return (
    <p role="status" aria-live="polite" className="mt-4 text-center text-xs text-slate-500">
      {describeWatch(status, polling, initialStatus)}
    </p>
  );
}
