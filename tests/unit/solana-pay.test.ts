import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { buildTransferRequestUrl, encodeTransferRequest, formatTransferAmount } from "@/lib/payments/solana-pay";

// Examples copied verbatim from the Solana Pay specification (SPEC.md, "Examples").
const SPEC_RECIPIENT = "mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN";
const MAINNET_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("buildTransferRequestUrl reproduces the spec examples", () => {
  it("0.01 USDC", () => {
    expect(buildTransferRequestUrl({ recipient: SPEC_RECIPIENT, amount: "0.01", splToken: MAINNET_USDC })).toBe(
      "solana:mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN?amount=0.01&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
  });

  it("1 SOL with label and message (the spec example without its memo, which we don't use)", () => {
    expect(
      buildTransferRequestUrl({ recipient: SPEC_RECIPIENT, amount: "1", label: "Michael", message: "Thanks for all the fish" }),
    ).toBe("solana:mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN?amount=1&label=Michael&message=Thanks%20for%20all%20the%20fish");
  });

  it("label only (wallet prompts for the amount)", () => {
    expect(buildTransferRequestUrl({ recipient: SPEC_RECIPIENT, label: "Michael" })).toBe(
      "solana:mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN?label=Michael",
    );
  });
});

describe("formatTransferAmount", () => {
  it.each([
    [10_000_000n, "10"],
    [1_500_000n, "1.5"],
    [10_000n, "0.01"], // leading zero required by the spec
    [1n, "0.000001"],
    [10_000_000_000n, "10000"], // no thousands separators
    [123_456_789n, "123.456789"],
  ])("%s base units -> %s", (amount, expected) => {
    expect(formatTransferAmount(amount, 6)).toBe(expected);
    expect(expected).not.toMatch(/e|,|^\./i); // no scientific notation, separators or bare "."
  });
});

describe("encodeTransferRequest", () => {
  const invoice = {
    recipientWallet: SPEC_RECIPIENT,
    amount: 10_000_000n,
    tokenDecimals: 6,
    tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    reference: "7yqBW2Y7JPKNR92fvtx3czKhVSEwrT6UFjJe3bkPQCWV",
    invoiceNumber: "INV-2026-00001",
    description: "Laptop accessory purchase",
  };

  it("builds the full USDC link from stored invoice fields", () => {
    expect(encodeTransferRequest(invoice, "Laptop Store")).toBe(
      "solana:mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN?amount=10&spl-token=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" +
        "&reference=7yqBW2Y7JPKNR92fvtx3czKhVSEwrT6UFjJe3bkPQCWV&label=Laptop%20Store" +
        "&message=INV-2026-00001%20%C2%B7%20Laptop%20accessory%20purchase",
    );
  });

  it("uses just the invoice number as message when there's no description", () => {
    expect(encodeTransferRequest({ ...invoice, description: null }, "Shop")).toMatch(/&message=INV-2026-00001$/);
  });

  it("never emits a memo or redirect", () => {
    const url = encodeTransferRequest(invoice, "Shop");
    expect(url).not.toMatch(/[?&](memo|redirect)=/);
  });

  it("URL-encodes characters that would break the query string", () => {
    const url = encodeTransferRequest({ ...invoice, description: "A&B=C?D #1 + 50% off" }, "Café & Co");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("label")).toBe("Café & Co");
    expect(parsed.searchParams.get("message")).toBe("INV-2026-00001 · A&B=C?D #1 + 50% off");
    expect([...parsed.searchParams.keys()]).toEqual(["amount", "spl-token", "reference", "label", "message"]);
  });

  it("produces a QR code whose payload is exactly the link", () => {
    const url = encodeTransferRequest(invoice, "Laptop Store");
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const payload = qr.segments.map((s) => (typeof s.data === "string" ? s.data : Buffer.from(s.data).toString("utf8"))).join("");
    expect(payload).toBe(url);
  });
});
