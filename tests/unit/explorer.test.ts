import { describe, expect, it } from "vitest";
import { explorerTxUrl } from "@/lib/solana/explorer";

const SIG = "39m866ogKRdHeuqrePGz7TwXrr3u1bcUsc5eaH2QrxtEUnPyDHR9pycmCCEfj1zd65HqzE2sRKCpJnga8emL9YE3";

describe("explorerTxUrl", () => {
  it("selects the devnet cluster", () => {
    expect(explorerTxUrl(SIG, "DEVNET", "https://explorer.solana.com")).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
  });

  it("uses Explorer's default for mainnet", () => {
    expect(explorerTxUrl(SIG, "MAINNET", "https://explorer.solana.com")).toBe(`https://explorer.solana.com/tx/${SIG}`);
  });
});
