import "server-only";
import { rpcCall } from "@/lib/payments/check-payment";
import { assertExpectedCluster, getAccountSummary } from "@/lib/solana/server-rpc";
import { payoutAccountProblem } from "./payout-wallet";

// Looks up the account at a new payout address (Phase 13, decision D6). Fails closed:
// if the network can't be reached the change is refused (RpcUnavailable, 503), never
// accepted unchecked.
//
// Checked when the wallet is chosen (onboarding, payout challenge), not again at the
// confirmation: an empty System account can only be turned into a program or data
// account with its own key's signature, so nobody else can change what it is meanwhile.
export async function onChainPayoutProblem(address: string): Promise<string | null> {
  const account = await rpcCall(async () => {
    await assertExpectedCluster();
    return getAccountSummary(address);
  });
  return payoutAccountProblem(account);
}
