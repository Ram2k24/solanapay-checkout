import { SYSTEM_PROGRAM_ADDRESS as SYSTEM_FROM_PACKAGE } from "@solana-program/system";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { describe, expect, it } from "vitest";
import { CIRCLE_USDC_MINT } from "@/lib/config/networks";
import { payoutAccountProblem, payoutWalletProblem, SYSTEM_PROGRAM_ADDRESS } from "@/lib/merchant/payout-wallet";
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

describe("payoutAccountProblem (Phase 13, decision D6)", () => {
  const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
  const wallet = { owner: SYSTEM_PROGRAM_ADDRESS, executable: false, space: 0n };

  it("accepts a wallet not on-chain yet, or a plain System account", () => {
    expect(payoutAccountProblem(null)).toBeNull();
    expect(payoutAccountProblem(wallet)).toBeNull();
  });

  it("rejects a program", () => {
    expect(payoutAccountProblem({ owner: "BPFLoaderUpgradeab1e11111111111111111111111", executable: true, space: 36n })).toMatch(/program, not a wallet/);
  });

  it.each([
    ["a token account", { ...wallet, owner: TOKEN_PROGRAM_ADDRESS, space: 165n }],
    ["a stake account", { ...wallet, owner: STAKE_PROGRAM, space: 200n }],
    ["a System-owned account holding data (a nonce account)", { ...wallet, space: 80n }],
    ["an empty account owned by another program", { ...wallet, owner: TOKEN_PROGRAM_ADDRESS }],
  ])("rejects %s", (_label, account) => {
    expect(payoutAccountProblem(account)).toMatch(/not a wallet/);
  });
});
