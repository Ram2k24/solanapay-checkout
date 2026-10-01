"use client";

import { useState } from "react";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard can be unavailable (permissions, insecure context); the link is still visible.
        }
      }}
      className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
