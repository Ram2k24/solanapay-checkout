"use client";

import { useIsBrowser } from "@/lib/react/use-is-browser";

// Shows a timestamp in the viewer's time zone. The server (and hydration) renders
// UTC, then the browser switches to local time, avoiding a hydration mismatch.
export function LocalTime({ iso }: { iso: string }) {
  const isBrowser = useIsBrowser();
  const date = new Date(iso);
  const text = isBrowser
    ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : `${iso.slice(0, 16).replace("T", " ")} UTC`;
  return <time dateTime={iso}>{text}</time>;
}
