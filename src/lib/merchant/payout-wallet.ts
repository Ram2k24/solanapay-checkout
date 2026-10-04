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
// What lives at the address on-chain is checked separately (payoutAccountProblem).
export function payoutWalletProblem(address: string): string | null {
  if (!isAddress(address)) return "Not a valid Solana address.";
  if (isOffCurveAddress(address)) return "This is a program or token account address, not a wallet.";
  if (NOT_A_WALLET.has(address)) return "This is a system program or token address, not a wallet.";
  return null;
}

// The on-chain account at a payout address (Phase 13, decision D6). A wallet is either
// not on-chain yet (it has never held SOL) or a plain System account with no data.
// Anything else, such as a program, a token account or a stake or nonce account, isn't
// a wallet whose USDC token account the merchant could control.
export type PayoutAccount = { owner: string; executable: boolean; space: bigint } | null;

export function payoutAccountProblem(account: PayoutAccount): string | null {
  if (account === null) return null;
  if (account.executable) return "This address is a program, not a wallet.";
  if (account.owner !== SYSTEM_PROGRAM_ADDRESS || account.space > 0n) {
    return "This address is a token, stake or other program account, not a wallet.";
  }
  return null;
}
