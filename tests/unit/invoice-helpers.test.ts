import { isAddress } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { AUTO_ORDER_ID_PATTERN, formatInvoiceNumber, formatOrderId } from "@/lib/payments/invoice-number";
import { generateReference } from "@/lib/payments/reference";
import { hashRequest } from "@/lib/payments/request-hash";

describe("formatInvoiceNumber", () => {
  it("zero-pads to five digits", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("INV-2026-00001");
    expect(formatInvoiceNumber(2026, 12345)).toBe("INV-2026-12345");
  });
  it("keeps counting past 99999 instead of wrapping", () => {
    expect(formatInvoiceNumber(2026, 100000)).toBe("INV-2026-100000");
  });
});

describe("formatOrderId / AUTO_ORDER_ID_PATTERN", () => {
  it("formats auto order IDs like invoice numbers", () => {
    expect(formatOrderId(2026, 7)).toBe("ORD-2026-00007");
  });
  it("recognizes the reserved format, case-insensitively, and nothing else", () => {
    for (const id of ["ORD-2026-00001", "ord-2026-5", "ORD-2027-123456"]) expect(AUTO_ORDER_ID_PATTERN.test(id)).toBe(true);
    for (const id of ["ORDER-10001", "10045", "ORD-26-00001", "MY-ORD-2026-00001", "ORD-2026-00001-A"]) expect(AUTO_ORDER_ID_PATTERN.test(id)).toBe(false);
  });
});

describe("generateReference", () => {
  it("returns a valid, unique Solana address", async () => {
    const refs = await Promise.all(Array.from({ length: 20 }, generateReference));
    expect(refs.every((r) => isAddress(r))).toBe(true);
    expect(new Set(refs).size).toBe(20);
  });
});

describe("hashRequest", () => {
  it("is independent of key order", () => {
    expect(hashRequest({ a: "1", b: 2 })).toBe(hashRequest({ b: 2, a: "1" }));
  });
  it("changes when any value changes", () => {
    expect(hashRequest({ amount: "10.00", orderId: null })).not.toBe(hashRequest({ amount: "10.01", orderId: null }));
  });
  it("is a 64-character hex SHA-256", () => {
    expect(hashRequest({ x: "y" })).toMatch(/^[0-9a-f]{64}$/);
  });
});
