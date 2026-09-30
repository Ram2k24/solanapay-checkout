import { publicEnv } from "@/lib/config/public-env";

// Shown on every page while running on a test network.
export function NetworkBanner() {
  const network = publicEnv.NEXT_PUBLIC_SOLANA_NETWORK;
  if (network === "mainnet") return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
      <span className="font-medium capitalize">{network}</span> preview: payments use test USDC with no real value.
      Set your wallet to {network} and never send real funds.
    </div>
  );
}
