import { describe, expect, it } from "vitest";
import { parsePaymentSearch } from "@/lib/payments/payment-search";

const SIG = "44aK9dusnvWsi3p7XA1p9ykBMNkenWCdvJaf3cYJnjCSApXwYfESQJHDKh5J2pW2YcLAvz7WUKugiaikcVidvf5e";

describe("parsePaymentSearch (exact matches only, decision D2)", () => {
  it("is no search when empty", () => {
    for (const input of [undefined, null, "", "   "]) expect(parsePaymentSearch(input)).toBeNull();
  });

  it("recognises a full transaction signature", () => {
    expect(parsePaymentSearch(`  ${SIG} `)).toEqual({ signature: SIG });
  });

  it("recognises an invoice number, in any case", () => {
    expect(parsePaymentSearch("inv-2026-00038")).toEqual({ invoiceNumber: "INV-2026-00038" });
  });

  it.each([
    ["a partial signature", SIG.slice(0, 20)],
    ["a signature with a non-base58 character", `0${SIG.slice(1)}`],
    ["a partial invoice number", "INV-2026"],
    ["an order ID", "ORD-2026-00030"],
    ["a wildcard", "%"],
    ["an SQL fragment", "' OR 1=1 --"],
  ])("rejects %s", (_label, input) => {
    expect(parsePaymentSearch(input)).toBe("invalid");
  });
});
