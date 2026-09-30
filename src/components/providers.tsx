"use client";

import { ClientProvider } from "@solana/react";
import { solanaClient } from "@/lib/solana/client";
import { SessionProvider } from "./session-provider";

// Client-side context for the whole app: the Solana client (wallets + RPC) and the session.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClientProvider client={solanaClient}>
      <SessionProvider>{children}</SessionProvider>
    </ClientProvider>
  );
}
