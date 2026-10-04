import { getBase64Encoder } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { checkSigner } from "@/lib/wallet/signer-check";
import { createTestWallet } from "../support/wallet";

const bytes = (text: string) => new TextEncoder().encode(text);
const fromBase64 = (b64: string) => new Uint8Array(getBase64Encoder().encode(b64));

describe("checkSigner (Phase 13.3: which account did the wallet sign with?)", () => {
  let merchant: Awaited<ReturnType<typeof createTestWallet>>;
  let otherAccount: Awaited<ReturnType<typeof createTestWallet>>;
  beforeAll(async () => {
    merchant = await createTestWallet();
    otherAccount = await createTestWallet();
  });

  it("matches a signature by the signed-in wallet", async () => {
    const signature = fromBase64(await merchant.sign("change payout"));
    expect(await checkSigner(merchant.address, bytes("change payout"), signature)).toBe("match");
  });

  it("detects a signature by another account in the same wallet app", async () => {
    const signature = fromBase64(await otherAccount.sign("change payout"));
    expect(await checkSigner(merchant.address, bytes("change payout"), signature)).toBe("other-account");
  });

  it("is unsure (and so lets the server decide) for a malformed signature", async () => {
    expect(await checkSigner(merchant.address, bytes("change payout"), new Uint8Array(63))).toBe("unknown");
  });

  it("is unsure when the browser can't verify Ed25519", async () => {
    const signature = fromBase64(await otherAccount.sign("change payout"));
    const noEd25519 = async () => {
      throw new DOMException("Unrecognized name.", "NotSupportedError");
    };
    expect(await checkSigner(merchant.address, bytes("change payout"), signature, noEd25519)).toBe("unknown");
  });
});
