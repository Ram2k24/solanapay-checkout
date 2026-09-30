import { SYSTEM_PROGRAM_ADDRESS as SYSTEM_FROM_PACKAGE } from "@solana-program/system";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { describe, expect, it } from "vitest";
import { CIRCLE_USDC_MINT } from "@/lib/config/networks";
import { payoutWalletProblem, SYSTEM_PROGRAM_ADDRESS } from "@/lib/merchant/payout-wallet";
import { createTestWallet } from "../support/wallet";

describe("payoutWalletProblem", () => {
  it("accepts a normal wallet", async () => {
    expect(payoutWalletProblem((await createTestWallet()).address)).toBeNull();
  });

  it("uses the canonical System Program address", () => {
    expect(SYSTEM_PROGRAM_ADDRESS).toBe(SYSTEM_FROM_PACKAGE);
  });

  it.each([
    ["System Program", SYSTEM_PROGRAM_ADDRESS],
    ["Token Program", TOKEN_PROGRAM_ADDRESS],
    ["Associated Token Program", ASSOCIATED_TOKEN_PROGRAM_ADDRESS],
    ["USDC devnet mint", CIRCLE_USDC_MINT.devnet],
    ["USDC mainnet mint", CIRCLE_USDC_MINT.mainnet],
  ])("rejects the %s", (_label, address) => {
    expect(payoutWalletProblem(address)).toMatch(/not a wallet/);
  });

  it("rejects malformed addresses", () => {
    expect(payoutWalletProblem("not-an-address")).toBe("Not a valid Solana address.");
  });
});
