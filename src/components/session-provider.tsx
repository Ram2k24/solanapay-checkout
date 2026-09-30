"use client";

import { getBase64Decoder, type ReadonlyUint8Array, type SignatureBytes } from "@solana/kit";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { postJson } from "@/lib/http/client";

export { ApiRequestError } from "@/lib/http/client";

// Browser-side view of the server session (the cookie itself is HttpOnly and
// never visible here). Sign-in = get challenge -> wallet signs -> server verifies.

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; walletAddress: string; expiresAt: string };

type SignMessage = (message: ReadonlyUint8Array) => Promise<SignatureBytes>;

type SessionContextValue = {
  session: SessionState;
  signIn: (walletAddress: string, signMessage: SignMessage) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const data = (await response.json()) as { authenticated: boolean; walletAddress?: string; expiresAt?: string };
      setSession(
        data.authenticated && data.walletAddress && data.expiresAt
          ? { status: "signed-in", walletAddress: data.walletAddress, expiresAt: data.expiresAt }
          : { status: "signed-out" },
      );
    } catch {
      setSession({ status: "signed-out" });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (walletAddress: string, signMessage: SignMessage) => {
      const challenge = await postJson<{ nonce: string; message: string }>("/api/auth/nonce", { walletAddress });
      const signature = await signMessage(new TextEncoder().encode(challenge.message));
      await postJson("/api/auth/verify", { nonce: challenge.nonce, signature: getBase64Decoder().decode(signature) });
      await refresh();
      router.refresh(); // re-render server components (e.g. the dashboard) with the new session
    },
    [refresh, router],
  );

  const signOut = useCallback(async () => {
    await postJson("/api/auth/logout");
    await refresh();
    router.refresh();
  }, [refresh, router]);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside <SessionProvider>");
  return context;
}
