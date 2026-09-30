import { describe, expect, it } from "vitest";
import { describeWalletError, isUserRejection } from "@/lib/wallet/errors";

describe("isUserRejection", () => {
  it.each([
    ["EIP-1193 style code", { code: 4001, message: "x" }],
    ["Wallet Standard code", { context: { __code: "WALLET_STANDARD_ERROR__USER__REQUEST_REJECTED" } }],
    ["message only", new Error("User rejected the request.")],
    ["declined", new Error("Request declined by user")],
  ])("detects %s", (_label, error) => {
    expect(isUserRejection(error)).toBe(true);
  });

  it.each([[new Error("Network error")], [null], ["rejected"], [42]])("ignores %s", (error) => {
    expect(isUserRejection(error)).toBe(false);
  });
});

describe("describeWalletError", () => {
  it("gives a friendly message and never echoes wallet internals", () => {
    expect(describeWalletError({ code: 4001 })).toBe("You cancelled the request in your wallet.");
    expect(describeWalletError(new Error("internal stack detail 0xdeadbeef"))).toBe(
      "Your wallet reported an error. Please try again.",
    );
  });
});
