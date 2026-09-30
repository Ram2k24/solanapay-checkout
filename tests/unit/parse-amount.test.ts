import { describe, expect, it } from "vitest";
import { parseAmount } from "@/lib/money/parse";

const USDC = 6;
const CAP = 10_000_000_000n; // 10,000 USDC in base units

describe("parseAmount", () => {
  it.each([
    ["10", 10_000_000n],
    ["10.00", 10_000_000n],
    ["10.5", 10_500_000n],
    ["0.000001", 1n], // smallest USDC unit
    ["0.1", 100_000n], // exact, unlike 0.1 as a float
    ["9999.999999", 9_999_999_999n],
    ["10000", 10_000_000_000n], // exactly the cap
  ])("accepts %s -> %s base units", (input, expected) => {
    expect(parseAmount(input, USDC, CAP)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["", "format"],
    [" 10", "format"],
    ["10 ", "format"],
    ["-1", "format"],
    ["+1", "format"],
    ["1e3", "format"],
    ["1,000", "format"],
    ["10,00", "format"],
    [".5", "format"],
    ["1.", "format"],
    ["0x10", "format"],
    ["NaN", "format"],
    ["١٠", "format"], // non-ASCII digits
    ["1.0000001", "too-many-decimals"],
    ["0", "not-positive"],
    ["0.000000", "not-positive"],
    ["10000.000001", "too-large"],
  ])("rejects %j (%s)", (input, reason) => {
    expect(parseAmount(input, USDC, CAP)).toEqual({ ok: false, reason });
  });

  it("stays exact beyond floating-point precision when no cap is given", () => {
    expect(parseAmount("900719925474099.3", 6)).toEqual({ ok: true, value: 900_719_925_474_099_300_000n });
  });
});
