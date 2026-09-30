import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { isAddress, isOffCurveAddress } from "@solana/kit";
import { CIRCLE_USDC_MINT } from "@/lib/config/networks";

// System Program ID (32 zero bytes). Kept here rather than importing
// @solana-program/system, which is only an indirect dependency; a unit test checks
// it against that package's SYSTEM_PROGRAM_ADDRESS.
export const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";

// Well-known addresses that pass the format and on-curve checks but are not
// wallets anyone controls. USDC sent to a token account owned by one of these
// could never be withdrawn.
const NOT_A_WALLET = new Set<string>([
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  CIRCLE_USDC_MINT.devnet,
  CIRCLE_USDC_MINT.mainnet,
]);

// A payout wallet must be a normal wallet address (an Ed25519 public key "on the
// curve"), and not a well-known program or token-mint address.
// Program-derived addresses, such as token accounts, are off the curve and rejected.
// (A full check that no program lives at the address needs an RPC lookup: Phase 13.)
export function payoutWalletProblem(address: string): string | null {
  if (!isAddress(address)) return "Not a valid Solana address.";
  if (isOffCurveAddress(address)) return "This is a program or token account address, not a wallet.";
  if (NOT_A_WALLET.has(address)) return "This is a system program or token address, not a wallet.";
  return null;
}
