import type { InvoiceStatus } from "@/generated/prisma/enums";
import type { PollerState } from "@/lib/payments/status-poller";

// After a status change, how long the server-rendered page may lag behind the poller
// before the watcher reloads it (a refresh normally applies within a second).
export const STALE_PAGE_RELOAD_MS = 5_000;

// The checkout page's one-line live status. `pageStatus` is what the server-rendered
// page currently shows; when the poller knows better, the page is about to update.
export function describeWatch(status: InvoiceStatus, polling: PollerState, pageStatus: InvoiceStatus): string {
  if (status !== pageStatus) {
    if (status === "PAID" || status === "CONFIRMING") return "Payment detected. Updating this page…";
    return "The invoice status changed. Updating this page…";
  }
  if (polling === "stopped") return "Automatic updates have stopped. Reload the page to check again.";
  if (polling === "paused") return "Updates paused while this tab is in the background.";
  if (polling === "backoff") return "Having trouble reaching the server; retrying shortly…";
  if (status === "CONFIRMING") return "Checking for final confirmation automatically…";
  if (status === "EXPIRED") return "Checking once more for a payment made just before expiry…";
  return "Waiting for your payment. This page updates automatically.";
}
