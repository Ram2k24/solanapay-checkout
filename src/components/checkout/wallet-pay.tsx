"use client";

import { isTransactionSendingSigner } from "@solana/kit";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  useWalletStatus,
} from "@solana/kit-plugin-wallet/react";
import { useClient } from "@solana/react";
import { useEffect, useRef, useState } from "react";
import { Balances } from "@/components/wallet/balances";
import { WalletList } from "@/components/wallet/wallet-button";
import { publicEnv } from "@/lib/config/public-env";
import { useIsBrowser } from "@/lib/react/use-is-browser";
import { shortenAddress } from "@/lib/solana/address";
import { SOLANA_CHAIN, type SolanaClient } from "@/lib/solana/client";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { describeWalletError } from "@/lib/wallet/errors";
import { describePayReadiness, payReadiness } from "@/lib/wallet/pay-readiness";
import { describePayFailure, payWithWallet, type WalletPayFailure } from "@/lib/wallet/pay-with-wallet";

// "Or pay with a browser wallet" on the checkout page (Phase 8), shown only while the
// invoice is payable and only when a Wallet Standard wallet is present (decision D2).
// The props are for display; the payment terms are never taken from this component:
// the server builds the transaction from the stored invoice, and the invoice is marked
// paid only by on-chain verification. This component never changes the invoice status
// shown on the page; the status watcher re-renders the page when the server's changes.
export function WalletPay({
  invoiceId,
  amountDisplay,
  currency,
  merchantName,
}: {
  invoiceId: string;
  amountDisplay: string;
  currency: string;
  merchantName: string;
}) {
  const client = useClient<SolanaClient>();
  const status = useWalletStatus(client);
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const connect = useConnect(client);
  const disconnect = useDisconnect(client);
  const isBrowser = useIsBrowser();

  // Nothing until the wallet state is known, and nothing at all without a wallet
  // (most phones): the QR code stays the main way to pay.
  if (!isBrowser || status === "pending" || status === "reconnecting") return null;
  if (!connected && wallets.length === 0) return null;

  const network = publicEnv.NEXT_PUBLIC_SOLANA_NETWORK;
  const readiness = connected ? payReadiness(connected, SOLANA_CHAIN) : null;
  const signer = connected?.signer && isTransactionSendingSigner(connected.signer) ? connected.signer : null;

  return (
    <section aria-label="Pay with a browser wallet" className="w-full max-w-sm border-t border-slate-100 pt-4 text-sm">
      <p className="mb-3 text-center font-medium">Or pay with a browser wallet</p>
      {!connected ? (
        <WalletList
          wallets={wallets}
          connecting={status === "connecting"}
          error={connect.error ? describeWalletError(connect.error) : null}
          onConnect={(wallet) => connect.dispatch(wallet)}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-500">{connected.wallet.name}</p>
              <p className="font-mono">{shortenAddress(connected.account.address)}</p>
            </div>
            <button type="button" onClick={() => disconnect.dispatch()} className="text-xs text-slate-500 underline hover:text-slate-700">
              Disconnect
            </button>
          </div>

          {/* Informational only (decision D4): the wallet's own check decides whether funds suffice. */}
          <div className="rounded-lg border border-slate-100 p-3">
            <div className="mb-2 flex justify-between text-xs text-slate-500">
              <span>Your balances</span>
              <span className="capitalize">{network}</span>
            </div>
            <Balances owner={connected.account.address} />
          </div>

          {readiness === "ready" && signer ? (
            // Keyed by account: switching accounts starts a fresh payment attempt.
            <PayButton
              key={connected.account.address}
              invoiceId={invoiceId}
              signer={signer}
              network={network}
              label={`Pay ${amountDisplay} ${currency}`}
              summary={`You'll pay ${amountDisplay} ${currency} to ${merchantName}.`}
            />
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900" role="alert">
              {describePayReadiness(readiness === "ready" || !readiness ? "no-send" : readiness, network)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

type Step =
  | { name: "idle" }
  | { name: "preparing" } // asking our server for the transaction
  | { name: "approving" } // waiting for the customer in the wallet
  | { name: "sent"; signature: string }
  | { name: "failed"; failure: WalletPayFailure };

function PayButton({
  invoiceId,
  signer,
  network,
  label,
  summary,
}: {
  invoiceId: string;
  signer: Parameters<typeof payWithWallet>[1];
  network: string;
  label: string;
  summary: string;
}) {
  const [step, setStep] = useState<Step>({ name: "idle" });
  const inFlight = useRef(false); // blocks a second click before React re-renders
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []); // leaving the page cancels the request

  async function pay() {
    if (inFlight.current) return;
    inFlight.current = true;
    abort.current = new AbortController();
    setStep({ name: "preparing" });
    try {
      const signature = await payWithWallet(invoiceId, signer, {
        signal: abort.current.signal,
        onApproving: () => setStep({ name: "approving" }),
      });
      setStep({ name: "sent", signature }); // final for this page view: no second payment from here
    } catch (error) {
      if (abort.current.signal.aborted) return;
      setStep({ name: "failed", failure: describePayFailure(error) });
      inFlight.current = false;
    }
  }

  if (step.name === "sent") {
    return (
      <div className="rounded-lg bg-slate-50 p-3 text-slate-700" role="status">
        <p className="font-medium">Payment sent. Waiting for confirmation on Solana…</p>
        <p className="mt-1 text-xs">
          This page updates by itself once the payment is verified. If nothing changes within a minute, check your
          wallet&apos;s activity before paying again.
        </p>
        <a href={explorerTxUrl(step.signature, network)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">
          View transaction on Solana Explorer
        </a>
      </div>
    );
  }

  const busy = step.name === "preparing" || step.name === "approving";
  return (
    <div className="space-y-2">
      <p className="text-slate-700">{summary}</p>
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="h-11 w-full rounded-lg bg-slate-900 font-medium text-white hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
      >
        {step.name === "preparing" ? "Preparing payment…" : step.name === "approving" ? "Approve in your wallet…" : label}
      </button>
      {step.name === "failed" && (
        <p className={`rounded-lg p-3 ${step.failure.kind === "cancelled" ? "bg-slate-50 text-slate-700" : "bg-amber-50 text-amber-900"}`} role="alert">
          {step.failure.message}
        </p>
      )}
    </div>
  );
}
