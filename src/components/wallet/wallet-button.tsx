"use client";

import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useSignMessage,
  useWallets,
  useWalletStatus,
} from "@solana/kit-plugin-wallet/react";
import { useClient } from "@solana/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiRequestError, useSession } from "@/components/session-provider";
import { publicEnv } from "@/lib/config/public-env";
import { shortenAddress } from "@/lib/solana/address";
import { SOLANA_CHAIN, type SolanaClient } from "@/lib/solana/client";
import { describeWalletError } from "@/lib/wallet/errors";
import { Balances } from "./balances";

// false during server rendering and hydration, true once running in the browser.
// Wallet state only exists in the browser, so rendering it earlier would make the
// server HTML differ from the first browser render (a React hydration mismatch).
const noopSubscribe = () => () => {};
function useIsBrowser(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

const pill =
  "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60";

// Header wallet control: connect/disconnect, balances, and Sign-In With Solana.
// Connecting a wallet only shares its public address; signing in proves ownership.
export function WalletButton() {
  const client = useClient<SolanaClient>();
  const status = useWalletStatus(client);
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const connect = useConnect(client);
  const disconnect = useDisconnect(client);
  const signMessage = useSignMessage(client);
  const { session, signIn, signOut } = useSession();
  const isBrowser = useIsBrowser();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"signing-in" | "signing-out" | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close the panel on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isBrowser || status === "pending" || status === "reconnecting") {
    return <span className="inline-block h-9 w-32 animate-pulse rounded-lg bg-slate-100" aria-label="Loading wallet" />;
  }

  const account = connected?.account;
  const wrongNetwork = account ? !account.chains.includes(SOLANA_CHAIN) : false;
  const signedIn = session.status === "signed-in";
  const signedInWithOtherWallet = signedIn && account && session.walletAddress !== account.address;

  async function handleSignIn() {
    if (!account) return;
    setAuthError(null);
    setBusy("signing-in");
    try {
      await signIn(account.address, signMessage.dispatchAsync);
    } catch (error) {
      setAuthError(error instanceof ApiRequestError ? error.message : describeWalletError(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleSignOut() {
    setAuthError(null);
    setBusy("signing-out");
    try {
      await signOut();
    } catch (error) {
      setAuthError(error instanceof ApiRequestError ? error.message : "Could not sign out. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" className={pill} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog">
        {account ? (
          <>
            <span aria-hidden className={`size-2 rounded-full ${signedIn && !signedInWithOtherWallet ? "bg-emerald-500" : "bg-slate-300"}`} />
            <span className="font-mono">{shortenAddress(account.address)}</span>
          </>
        ) : status === "connecting" ? (
          "Connecting…"
        ) : (
          "Connect wallet"
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Wallet" className="absolute right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-lg">
          {!account ? (
            <WalletList
              wallets={wallets}
              connecting={status === "connecting"}
              error={connect.error ? describeWalletError(connect.error) : null}
              onConnect={(wallet) => connect.dispatch(wallet)}
            />
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-500">{connected.wallet.name}</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-700">{account.address}</p>
              </div>

              {wrongNetwork && (
                <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
                  This account doesn&apos;t support Solana {publicEnv.NEXT_PUBLIC_SOLANA_NETWORK}. Switch your wallet to{" "}
                  {publicEnv.NEXT_PUBLIC_SOLANA_NETWORK} and reconnect.
                </p>
              )}

              <div className="rounded-lg border border-slate-100 p-3">
                <div className="mb-2 flex justify-between text-xs text-slate-500">
                  <span>Balances</span>
                  <span className="capitalize">{publicEnv.NEXT_PUBLIC_SOLANA_NETWORK}</span>
                </div>
                <Balances owner={account.address} />
              </div>

              <div className="space-y-2">
                {signedInWithOtherWallet ? (
                  <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
                    You are signed in as {shortenAddress(session.walletAddress)}, not this wallet. Sign out to switch.
                  </p>
                ) : signedIn ? (
                  <p className="text-emerald-700">Signed in as merchant</p>
                ) : (
                  <button
                    type="button"
                    onClick={handleSignIn}
                    disabled={busy !== null || session.status === "loading"}
                    className="h-10 w-full rounded-lg bg-slate-900 font-medium text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    {busy === "signing-in" ? "Approve in your wallet…" : "Sign in with wallet"}
                  </button>
                )}
                {signedIn && (
                  <button type="button" onClick={handleSignOut} disabled={busy !== null} className={`${pill} w-full justify-center`}>
                    {busy === "signing-out" ? "Signing out…" : "Sign out"}
                  </button>
                )}
                {authError && <p className="text-red-700" role="alert">{authError}</p>}
              </div>

              <button
                type="button"
                onClick={() => {
                  disconnect.dispatch();
                  setOpen(false);
                }}
                className="w-full text-center text-xs text-slate-500 underline hover:text-slate-700"
              >
                Disconnect wallet
              </button>
              <p className="text-xs text-slate-400">
                Signing in never moves funds. SolanaPay Checkout will never ask for your seed phrase.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Wallets = ReturnType<typeof useWallets>;

function WalletList({
  wallets,
  connecting,
  error,
  onConnect,
}: {
  wallets: Wallets;
  connecting: boolean;
  error: string | null;
  onConnect: (wallet: Wallets[number]) => void;
}) {
  if (wallets.length === 0) {
    return (
      <div className="space-y-2">
        <p className="font-medium">No compatible Solana wallet found</p>
        <p className="text-slate-600">
          Install a wallet that supports Solana {publicEnv.NEXT_PUBLIC_SOLANA_NETWORK}, such as{" "}
          <a className="underline" href="https://phantom.com/download" target="_blank" rel="noreferrer">Phantom</a> or{" "}
          <a className="underline" href="https://solflare.com/download" target="_blank" rel="noreferrer">Solflare</a>, then reload this page.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="font-medium">Connect a wallet</p>
      <ul className="space-y-1">
        {wallets.map((wallet) => (
          <li key={wallet.name}>
            <button
              type="button"
              disabled={connecting}
              onClick={() => onConnect(wallet)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50 disabled:opacity-60"
            >
              {/* Wallet icons are data: URIs supplied by the wallet extension. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={wallet.icon} alt="" className="size-6 rounded" />
              {wallet.name}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-red-700" role="alert">{error}</p>}
      <p className="text-xs text-slate-400">Connecting only shares your public address.</p>
    </div>
  );
}
