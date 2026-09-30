"use client";

import { useEffect, useState } from "react";
import { useIsBrowser } from "@/lib/react/use-is-browser";

function remaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`;
}

// Live "expires in 12:34" for a pending invoice. Display only: the server decides
// whether an invoice has expired.
export function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const isBrowser = useIsBrowser();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!isBrowser) return <span className="font-mono">…</span>;
  const ms = new Date(expiresAt).getTime() - now;
  return ms > 0 ? (
    <span className="font-mono">Expires in {remaining(ms)}</span>
  ) : (
    <span className="font-mono text-slate-500">Expired</span>
  );
}
