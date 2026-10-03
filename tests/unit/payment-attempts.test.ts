import { describe, expect, it } from "vitest";
import {
  ATTEMPT_HOLD_MS,
  attemptKey,
  clearAttempt,
  holdsPayment,
  readAttempt,
  writeAttempt,
  type StorageLike,
} from "@/lib/wallet/payment-attempts";

const INVOICE = "01a1012c-4b9f-721a-8990-bc6e0cde9385";
const SIG = "4ZUq8B6hTwYDh3D3akZJZLkiBDwrLALy9pUEqmuDV1yeWXHjknM5ATgU43pi8RQ5uS53Qjt9L2roRKnHWsvgwYMh";
const T0 = 1_800_000_000_000;

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
const broken: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("payment attempt notes", () => {
  it("round-trips an approving and a sent attempt", () => {
    const s = memory();
    writeAttempt(s, INVOICE, { state: "approving", attemptId: "a", at: T0 });
    expect(readAttempt(s, INVOICE, T0 + 1)).toEqual({ state: "approving", attemptId: "a", at: T0 });
    writeAttempt(s, INVOICE, { state: "sent", attemptId: "a", at: T0, signature: SIG });
    expect(readAttempt(s, INVOICE, T0 + 1)).toEqual({ state: "sent", attemptId: "a", at: T0, signature: SIG });
  });

  it("keeps notes per invoice", () => {
    const s = memory();
    writeAttempt(s, INVOICE, { state: "approving", attemptId: "a", at: T0 });
    expect(readAttempt(s, "another-invoice", T0)).toBeNull();
  });

  it("forgets an approving attempt after the hold (a tab closed mid-approval)", () => {
    const s = memory();
    writeAttempt(s, INVOICE, { state: "approving", attemptId: "a", at: T0 });
    expect(readAttempt(s, INVOICE, T0 + ATTEMPT_HOLD_MS)).toBeNull();
    expect(s.data.size).toBe(0);
  });

  it("keeps a sent note after the hold (shown with 'Pay again anyway'), forgets it after a day", () => {
    const s = memory();
    writeAttempt(s, INVOICE, { state: "sent", attemptId: "a", at: T0, signature: SIG });
    expect(readAttempt(s, INVOICE, T0 + ATTEMPT_HOLD_MS + 1)).not.toBeNull();
    expect(readAttempt(s, INVOICE, T0 + 24 * 60 * 60_000)).toBeNull();
  });

  it.each([
    ["not JSON", "{"],
    ["unknown state", JSON.stringify({ state: "paid", attemptId: "a", at: T0 })],
    ["sent without a signature", JSON.stringify({ state: "sent", attemptId: "a", at: T0 })],
    ["a signature that isn't base58", JSON.stringify({ state: "sent", attemptId: "a", at: T0, signature: "<script>" + "x".repeat(80) })],
    ["no time", JSON.stringify({ state: "approving", attemptId: "a" })],
    ["a time in the future", JSON.stringify({ state: "approving", attemptId: "a", at: T0 + 10 * 60_000 })],
  ])("drops a garbled note: %s", (_label, raw) => {
    const s = memory();
    s.setItem(attemptKey(INVOICE), raw);
    expect(readAttempt(s, INVOICE, T0)).toBeNull();
    expect(s.data.size).toBe(0);
  });

  it("clears only its own attempt, never another tab's newer one", () => {
    const s = memory();
    writeAttempt(s, INVOICE, { state: "approving", attemptId: "tab-b", at: T0 });
    clearAttempt(s, INVOICE, "tab-a");
    expect(readAttempt(s, INVOICE, T0)?.attemptId).toBe("tab-b");
    clearAttempt(s, INVOICE, "tab-b");
    expect(readAttempt(s, INVOICE, T0)).toBeNull();
  });

  it("works without storage, or with storage that throws (private mode, quota)", () => {
    for (const s of [null, broken]) {
      expect(() => writeAttempt(s, INVOICE, { state: "approving", attemptId: "a", at: T0 })).not.toThrow();
      expect(readAttempt(s, INVOICE, T0)).toBeNull();
      expect(() => clearAttempt(s, INVOICE, "a")).not.toThrow();
    }
  });
});

describe("holdsPayment", () => {
  const approving = { state: "approving" as const, attemptId: "tab-a", at: T0 };
  const sent = { state: "sent" as const, attemptId: "tab-a", at: T0, signature: SIG };

  it("holds back another tab while an attempt is approving or just sent", () => {
    expect(holdsPayment(approving, "tab-b", T0 + 1000)).toBe(true);
    expect(holdsPayment(sent, null, T0 + ATTEMPT_HOLD_MS - 1)).toBe(true);
  });

  it("never holds back the attempt itself", () => {
    expect(holdsPayment(approving, "tab-a", T0 + 1000)).toBe(false);
  });

  it("releases after the hold, and when there is no note", () => {
    expect(holdsPayment(sent, null, T0 + ATTEMPT_HOLD_MS)).toBe(false);
    expect(holdsPayment(null, null, T0)).toBe(false);
  });
});
