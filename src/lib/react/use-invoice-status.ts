"use client";

import { useEffect, useRef, useState } from "react";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { createStatusPoller, readStatusResponse, type PollerState } from "@/lib/payments/status-poller";

// Live invoice status for the checkout page, which also follows in-browser payments
// (Phase 8). A thin React wrapper around the framework-free poller:
// all timing rules live in status-poller.ts. The status is for display and for
// deciding when to re-render server output; it is never evidence of payment.
export function useInvoiceStatus(
  invoiceId: string,
  options: {
    initialStatus: InvoiceStatus;
    expiresAt: string;
    onChange?: (status: InvoiceStatus, previous: InvoiceStatus) => void;
  },
): { status: InvoiceStatus; polling: PollerState } {
  const [status, setStatus] = useState(options.initialStatus);
  const [polling, setPolling] = useState<PollerState>("active");
  const onChange = useRef(options.onChange);
  useEffect(() => {
    onChange.current = options.onChange;
  });

  // One poller per invoice. After mount the poller owns the status, so a new
  // `initialStatus` (e.g. from a server re-render it triggered) doesn't restart it.
  const { initialStatus, expiresAt } = options;
  useEffect(() => {
    const poller = createStatusPoller({
      // Same-origin; the status endpoint reads no cookies, so none are sent.
      fetchStatus: async (signal) =>
        readStatusResponse(
          await fetch(`/api/pay/${encodeURIComponent(invoiceId)}/status`, { signal, cache: "no-store", credentials: "omit" }),
        ),
      initialStatus,
      expiresAt,
      onStatus: (next, previous) => {
        setStatus(next);
        onChange.current?.(next, previous);
      },
      onState: setPolling,
      isHidden: () => document.visibilityState === "hidden",
    });
    const onVisibility = () => poller.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    poller.start();
    setPolling(poller.state);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      poller.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialStatus is only the starting point
  }, [invoiceId, expiresAt]);

  return { status, polling };
}
