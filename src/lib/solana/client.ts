import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";
import { publicEnv } from "@/lib/config/public-env";
import { CIRCLE_USDC_MINT } from "@/lib/config/networks";

// Browser-side Solana client: Wallet Standard discovery/connection + read-only RPC.
// Pattern from https://solana.com/docs/frontend/react-hooks

export const SOLANA_CHAIN = `solana:${publicEnv.NEXT_PUBLIC_SOLANA_NETWORK}` as const;

// USDC mint for balance display. Public and fixed per network (validated against
// the server config at startup); payments never take a mint from the browser.
export const USDC_MINT = publicEnv.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet" ? CIRCLE_USDC_MINT.mainnet : CIRCLE_USDC_MINT.devnet;

export const solanaClient = createClient()
  .use(
    walletSigner({
      chain: SOLANA_CHAIN,
      // Only list wallets that can sign messages (required for Sign-In With Solana).
      // The plugin already limits discovery to wallets that support SOLANA_CHAIN.
      filter: (wallet) => wallet.features.includes("solana:signMessage"),
    }),
  )
  .use(solanaRpc({ rpcUrl: publicEnv.NEXT_PUBLIC_SOLANA_RPC_URL }));

export type SolanaClient = Awaited<typeof solanaClient>;
