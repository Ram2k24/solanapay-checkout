"use client";

import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  useWalletStatus,
} from "@solana/kit-plugin-wallet/react";
import { useClient } from "@solana/react";
import { Balances } from "@/components/wallet/balances";
import { WalletList } from "@/components/wallet/wallet-button";
import { publicEnv } from "@/lib/config/public-env";
import { useIsBrowser } from "@/lib/react/use-is-browser";
import { shortenAddress } from "@/lib/solana/address";
import { SOLANA_CHAIN, type SolanaClient } from "@/lib/solana/client";
import { describeWalletError } from "@/lib/wallet/errors";
import { describePayReadiness, payReadiness } from "@/lib/wallet/pay-readiness";

// "Or pay with a browser wallet" on the checkout page (Phase 8), shown only while the
// invoice is payable and only when a Wallet Standard wallet is present (decision D2).
// The props are for display; the payment terms are never taken from this component:
// the server builds the transaction from the stored invoice, and the invoice is marked
// paid only by on-chain verification.
export function WalletPay({ amountDisplay, currency, merchantName }: { amountDisplay: string; currency: string; merchantName: string }) {
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
        <Connected
          walletName={connected.wallet.name}
          address={connected.account.address}
          readiness={payReadiness(connected, SOLANA_CHAIN)}
          network={network}
          summary={`You'll pay ${amountDisplay} ${currency} to ${merchantName}.`}
          onDisconnect={() => disconnect.dispatch()}
        />
      )}
    </section>
  );
}

function Connected({
  walletName,
  address,
  readiness,
  network,
  summary,
  onDisconnect,
}: {
  walletName: string;
  address: string;
  readiness: ReturnType<typeof payReadiness>;
  network: string;
  summary: string;
  onDisconnect: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500">{walletName}</p>
          <p className="font-mono">{shortenAddress(address)}</p>
        </div>
        <button type="button" onClick={onDisconnect} className="text-xs text-slate-500 underline hover:text-slate-700">
          Disconnect
        </button>
      </div>

      {/* Informational only (decision D4): the wallet's own check decides whether funds suffice. */}
      <div className="rounded-lg border border-slate-100 p-3">
        <div className="mb-2 flex justify-between text-xs text-slate-500">
          <span>Your balances</span>
          <span className="capitalize">{network}</span>
        </div>
        <Balances owner={address} />
      </div>

      {readiness === "ready" ? (
        <p className="text-slate-700">{summary}</p>
      ) : (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-900" role="alert">
          {describePayReadiness(readiness, network)}
        </p>
      )}
    </div>
  );
}
