"use client";

import { address } from "@solana/kit";
import { useClient, useRequest } from "@solana/react";
import { useMemo } from "react";
import { USDC_DECIMALS } from "@/lib/config/networks";
import { formatUnits } from "@/lib/money/format";
import { USDC_MINT, type SolanaClient } from "@/lib/solana/client";

const SOL_DECIMALS = 9; // 1 SOL = 1,000,000,000 lamports

// SOL and USDC balances of `owner`, read from the configured RPC.
// Only Circle's official USDC mint is counted; look-alike tokens are ignored.
export function Balances({ owner }: { owner: string }) {
  const client = useClient<SolanaClient>();

  const sol = useRequest(useMemo(() => client.rpc.getBalance(address(owner)), [client, owner]));
  const usdc = useRequest(
    useMemo(
      () => client.rpc.getTokenAccountsByOwner(address(owner), { mint: address(USDC_MINT) }, { encoding: "jsonParsed" }),
      [client, owner],
    ),
  );

  const usdcTotal = usdc.data?.value.reduce(
    (sum, account) => sum + BigInt(account.account.data.parsed.info.tokenAmount.amount),
    0n,
  );

  return (
    <dl className="space-y-2 text-sm">
      <Row label="SOL" value={sol.data ? formatUnits(sol.data.value, SOL_DECIMALS) : undefined} failed={!!sol.error} retry={sol.refresh} />
      <Row label="USDC" value={usdcTotal !== undefined ? formatUnits(usdcTotal, USDC_DECIMALS) : undefined} failed={!!usdc.error} retry={usdc.refresh} />
    </dl>
  );
}

function Row({ label, value, failed, retry }: { label: string; value: string | undefined; failed: boolean; retry: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono">
        {failed ? (
          <button type="button" onClick={() => retry()} className="text-xs text-amber-700 underline">
            Unavailable, retry
          </button>
        ) : value === undefined ? (
          <span className="inline-block h-4 w-16 animate-pulse rounded bg-slate-100" aria-label="Loading" />
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
