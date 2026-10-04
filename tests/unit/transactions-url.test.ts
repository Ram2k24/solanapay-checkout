import { describe, expect, it } from "vitest";
import { transactionsHref } from "@/lib/payments/transactions-url";

describe("transactionsHref", () => {
  it("is the bare page without parameters", () => {
    expect(transactionsHref({})).toBe("/transactions");
  });

  it("keeps filter, search and cursor, in a stable order", () => {
    expect(transactionsHref({ cursor: "c1", q: "INV-2026-00038", filter: "LATE" })).toBe("/transactions?filter=LATE&q=INV-2026-00038&cursor=c1");
  });

  it("encodes what the merchant typed", () => {
    expect(transactionsHref({ q: "a b&c=d" })).toBe("/transactions?q=a+b%26c%3Dd");
  });
});
