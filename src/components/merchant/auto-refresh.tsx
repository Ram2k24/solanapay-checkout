"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { useIsBrowser } from "@/lib/react/use-is-browser";
import { createAutoRefresh } from "@/lib/merchant/auto-refresh";

// "Updated 12:04:31 · Refresh" on the dashboard; re-renders it every 30 s while visible.
// `renderedAt` is the server's render time, so the line only moves when fresh data has
// actually arrived.
export function AutoRefresh({ renderedAt }: { renderedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  useEffect(() => {
    busy.current = pending;
  }, [pending]);
  const controls = useRef<ReturnType<typeof createAutoRefresh> | null>(null);
  const isBrowser = useIsBrowser();

  useEffect(() => {
    const auto = createAutoRefresh({
      refresh: () => startTransition(() => router.refresh()),
      isBusy: () => busy.current,
      isHidden: () => document.visibilityState === "hidden",
    });
    controls.current = auto;
    const onVisibility = () => auto.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    auto.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      auto.stop();
    };
  }, [router]);

  const time = new Date(renderedAt);
  return (
    <p className="flex items-center gap-2 text-xs text-slate-500" aria-live="polite">
      <span>
        {pending ? "Updating…" : <>Updated <time dateTime={renderedAt}>{isBrowser ? time.toLocaleTimeString() : `${renderedAt.slice(11, 19)} UTC`}</time></>}
      </span>
      <span aria-hidden>·</span>
      <button type="button" onClick={() => controls.current?.refreshNow()} disabled={pending} className="underline hover:text-slate-700 disabled:opacity-50">
        Refresh
      </button>
    </p>
  );
}
