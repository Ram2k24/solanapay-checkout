import { describe, expect, it } from "vitest";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { assertTransition, canTransition, effectiveStatus, InvalidTransitionError } from "@/lib/payments/invoice-state";

const ALL: InvoiceStatus[] = ["DRAFT", "PENDING", "CONFIRMING", "PAID", "EXPIRED", "FAILED"];
const ALLOWED = new Set([
  "DRAFT>PENDING",
  "PENDING>CONFIRMING",
  "PENDING>EXPIRED",
  "PENDING>FAILED",
  "CONFIRMING>PAID",
  "CONFIRMING>FAILED",
]);

describe("invoice state machine", () => {
  // Checks every one of the 36 (from, to) pairs against the allowed list.
  for (const from of ALL) {
    for (const to of ALL) {
      const allowed = ALLOWED.has(`${from}>${to}`);
      it(`${from} -> ${to} is ${allowed ? "allowed" : "rejected"}`, () => {
        expect(canTransition(from, to)).toBe(allowed);
        if (allowed) expect(() => assertTransition(from, to)).not.toThrow();
        else expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
      });
    }
  }

  it("never allows skipping CONFIRMING (PENDING -> PAID)", () => {
    expect(canTransition("PENDING", "PAID")).toBe(false);
  });

  it("treats PAID, EXPIRED and FAILED as final", () => {
    for (const final of ["PAID", "EXPIRED", "FAILED"] as const) {
      expect(ALL.some((to) => canTransition(final, to))).toBe(false);
    }
  });
});

describe("effectiveStatus", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const past = new Date("2026-09-30T11:59:59Z");
  const future = new Date("2026-09-30T12:00:01Z");

  it("shows a PENDING invoice past expiry as EXPIRED", () => {
    expect(effectiveStatus({ status: "PENDING", expiresAt: past }, now)).toBe("EXPIRED");
    expect(effectiveStatus({ status: "PENDING", expiresAt: now }, now)).toBe("EXPIRED");
  });
  it("keeps a PENDING invoice before expiry as PENDING", () => {
    expect(effectiveStatus({ status: "PENDING", expiresAt: future }, now)).toBe("PENDING");
  });
  it("never expires a CONFIRMING or PAID invoice", () => {
    expect(effectiveStatus({ status: "CONFIRMING", expiresAt: past }, now)).toBe("CONFIRMING");
    expect(effectiveStatus({ status: "PAID", expiresAt: past }, now)).toBe("PAID");
  });
});
