import { describe, expect, it } from "vitest";
import { describePayReadiness, payReadiness, type ConnectedWalletLike } from "@/lib/wallet/pay-readiness";

const CHAIN = "solana:devnet";
const sendingSigner = { address: "x", signAndSendTransactions: async () => [] };
const signOnlySigner = { address: "x", modifyAndSignTransactions: async () => [] };

function wallet(overrides: Partial<ConnectedWalletLike> = {}): ConnectedWalletLike {
  return {
    account: { chains: [CHAIN, "solana:mainnet"] },
    signer: sendingSigner,
    supportedTransactionVersions: new Set(["legacy", 0]),
    ...overrides,
  };
}

describe("payReadiness", () => {
  it("is ready: our network, a sending signer, v0 supported", () => {
    expect(payReadiness(wallet(), CHAIN)).toBe("ready");
  });

  it("wrong network wins over a missing signer (the plugin gives no signer off-chain)", () => {
    expect(payReadiness(wallet({ account: { chains: ["solana:mainnet"] }, signer: null }), CHAIN)).toBe("wrong-network");
  });

  it("read-only: no signer", () => {
    expect(payReadiness(wallet({ signer: null, supportedTransactionVersions: new Set() }), CHAIN)).toBe("read-only");
  });

  it("no-send: the wallet can only sign, not sign-and-send (D1)", () => {
    expect(payReadiness(wallet({ signer: signOnlySigner }), CHAIN)).toBe("no-send");
  });

  it("no-v0: a wallet that only reports legacy transactions", () => {
    expect(payReadiness(wallet({ supportedTransactionVersions: new Set(["legacy"]) }), CHAIN)).toBe("no-v0");
  });

  it("checks for the version 0 number, not the string", () => {
    expect(payReadiness(wallet({ supportedTransactionVersions: new Set(["0"]) }), CHAIN)).toBe("no-v0");
  });
});

describe("describePayReadiness", () => {
  it("names the network to switch to", () => {
    expect(describePayReadiness("wrong-network", "devnet")).toContain("Switch your wallet to devnet");
  });

  it("points every unusable wallet to the QR code", () => {
    for (const r of ["read-only", "no-send", "no-v0"] as const) {
      expect(describePayReadiness(r, "devnet")).toMatch(/QR code/);
    }
  });
});
