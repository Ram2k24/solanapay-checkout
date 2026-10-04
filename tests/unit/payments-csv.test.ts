import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, csvCell, paymentsCsv } from "@/lib/payments/payments-csv";

describe("csvCell", () => {
  it("quotes every cell and doubles quotes", () => {
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(2_500_000n)).toBe('"2500000"');
    expect(csvCell(true)).toBe('"true"');
  });

  it.each([
    ["=", '=HYPERLINK("http://evil.example","click")'],
    ["+", "+1+2"],
    ["-", "-2+3"],
    ["@", "@SUM(A1:A2)"],
    ["tab", "\t=1+1"],
    ["carriage return", "\r=1+1"],
  ])("neutralises a cell starting with %s, so a spreadsheet shows it as text", (_label, value) => {
    const cell = csvCell(value);
    expect(cell.startsWith(`"'`)).toBe(true);
    expect(cell.slice(2, -1).replaceAll('""', '"')).toBe(value); // the original text is kept after the apostrophe
  });

  it("leaves ordinary values alone, including ones with = later on", () => {
    expect(csvCell("ORDER-10001")).toBe('"ORDER-10001"');
    expect(csvCell("a=b")).toBe('"a=b"');
  });
});

describe("paymentsCsv", () => {
  const payment = {
    id: "01a10535-6131-707e-b532-76f066456467",
    invoiceId: "inv",
    signature: "4UU2syiJq8x4PL1KawA7rU2DkyhHhkzAb4KXDY2m7G5ZmiEbp2efGvkFym32uLqbDC5HzdPpwUX9M7oSyic5RnGm",
    network: "DEVNET",
    reference: "41ZhN2onoTQiK9Wo9ggJHi9bfgRrxXsv8aW7TXpfbPrn",
    senderWallet: "BdStSPH3K1uabV1KYFzobL8FH3d2wbiz2irNgNi3vGHi",
    recipientWallet: "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT",
    recipientTokenAccount: "4mCBk3FmruHdVz9Xy15C1KyEzSSimhrmX9dMF3d3XEhu",
    tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    amount: 1_000_000n,
    slot: 507244096n,
    blockTime: new Date("2026-10-04T04:39:04Z"),
    commitment: "FINALIZED",
    late: false,
    verifiedAt: new Date("2026-10-04T04:39:06.788Z"),
    finalizedAt: new Date("2026-10-04T04:39:06.788Z"),
    createdAt: new Date("2026-10-04T04:39:06.790Z"),
    updatedAt: new Date("2026-10-04T04:39:06.790Z"),
    invoice: { invoiceNumber: "INV-2026-00040", orderId: '=HYPERLINK("http://evil.example")' },
  } as const;

  it("starts with a UTF-8 byte-order mark, a header, and uses CRLF line ends", () => {
    const csv = paymentsCsv([payment as never]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.map((c) => `"${c}"`).join(","));
    expect(lines).toHaveLength(3); // header, one row, final empty after the last CRLF
    expect(lines[2]).toBe("");
  });

  it("writes one row per payment with the stored values", () => {
    const row = paymentsCsv([payment as never]).slice(1).split("\r\n")[1]!;
    expect(row).toBe(
      [
        "2026-10-04T04:39:04.000Z", "INV-2026-00040", `'=HYPERLINK(""http://evil.example"")`, "1.00", "1000000", "finalized", "false",
        payment.senderWallet, payment.recipientWallet, payment.recipientTokenAccount, payment.tokenMint, payment.reference, "devnet",
        "507244096", payment.signature, "2026-10-04T04:39:06.788Z", "2026-10-04T04:39:06.788Z", payment.id,
      ].map((v) => `"${v}"`).join(","),
    );
  });

  it("is only the header when there are no payments", () => {
    expect(paymentsCsv([])).toBe(`﻿${CSV_COLUMNS.map((c) => `"${c}"`).join(",")}\r\n`);
  });
});
