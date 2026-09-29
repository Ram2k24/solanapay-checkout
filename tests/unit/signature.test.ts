import { getBase64Encoder } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyWalletSignature } from "@/lib/auth/signature";
import { createTestWallet } from "../support/wallet";

const bytes = (text: string) => new TextEncoder().encode(text);
const fromBase64 = (b64: string) => new Uint8Array(getBase64Encoder().encode(b64));

describe("verifyWalletSignature", () => {
  let alice: Awaited<ReturnType<typeof createTestWallet>>;
  let mallory: Awaited<ReturnType<typeof createTestWallet>>;
  beforeAll(async () => {
    alice = await createTestWallet();
    mallory = await createTestWallet();
  });

  it("accepts a valid signature", async () => {
    const signature = fromBase64(await alice.sign("hello"));
    expect(await verifyWalletSignature(alice.address, bytes("hello"), signature)).toBe(true);
  });

  it("rejects a signature by a different wallet", async () => {
    const signature = fromBase64(await mallory.sign("hello"));
    expect(await verifyWalletSignature(alice.address, bytes("hello"), signature)).toBe(false);
  });

  it("rejects a tampered message", async () => {
    const signature = fromBase64(await alice.sign("hello"));
    expect(await verifyWalletSignature(alice.address, bytes("hello!"), signature)).toBe(false);
  });

  it("rejects a signature with the wrong length", async () => {
    expect(await verifyWalletSignature(alice.address, bytes("hello"), new Uint8Array(63))).toBe(false);
  });

  it("rejects an invalid address without throwing", async () => {
    const signature = fromBase64(await alice.sign("hello"));
    expect(await verifyWalletSignature("not-an-address", bytes("hello"), signature)).toBe(false);
  });
});
