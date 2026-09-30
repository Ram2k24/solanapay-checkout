import { describe, expect, it } from "vitest";
import { formatUnits } from "@/lib/money/format";
import { shortenAddress } from "@/lib/solana/address";

describe("formatUnits", () => {
  it.each([
    [10_000_000n, 6, "10.00"], // 10 USDC
    [1_234_567n, 6, "1.234567"],
    [1n, 6, "0.000001"], // smallest USDC unit
    [0n, 6, "0.00"],
    [1_500_000_000n, 9, "1.50"], // 1.5 SOL in lamports
    [1_234_567_000_000n, 6, "1,234,567.00"],
    [-2_500_000n, 6, "-2.50"],
  ])("formatUnits(%s, %s) = %s", (amount, decimals, expected) => {
    expect(formatUnits(amount, decimals)).toBe(expected);
  });

  it("is exact for amounts beyond floating-point precision", () => {
    // 2^53 + 1 base units: a JavaScript number would silently round this.
    expect(formatUnits(9_007_199_254_740_993n, 6)).toBe("9,007,199,254.740993");
  });
});

describe("shortenAddress", () => {
  it("keeps the first and last four characters", () => {
    expect(shortenAddress("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe("7xKX…gAsU");
  });
  it("leaves short strings unchanged", () => {
    expect(shortenAddress("abc")).toBe("abc");
  });
});
