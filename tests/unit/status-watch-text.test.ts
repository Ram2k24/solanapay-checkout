import { describe, expect, it } from "vitest";
import { describeWatch } from "@/components/checkout/status-watch-text";

describe("describeWatch", () => {
  it("never says updates stopped when a payment was just detected (Phase 8.5 finding)", () => {
    // The poller stops at PAID before the page has re-rendered.
    expect(describeWatch("PAID", "stopped", "PENDING")).toBe("Payment detected. Updating this page…");
    expect(describeWatch("CONFIRMING", "active", "PENDING")).toBe("Payment detected. Updating this page…");
  });

  it("describes other changes neutrally while the page catches up", () => {
    expect(describeWatch("EXPIRED", "active", "PENDING")).toBe("The invoice status changed. Updating this page…");
    expect(describeWatch("FAILED", "stopped", "PENDING")).toBe("The invoice status changed. Updating this page…");
  });

  it("says updates stopped only for a real stop, with the page up to date", () => {
    expect(describeWatch("EXPIRED", "stopped", "EXPIRED")).toMatch(/Automatic updates have stopped/);
  });

  it("keeps the existing messages when page and poller agree", () => {
    expect(describeWatch("PENDING", "active", "PENDING")).toBe("Waiting for your payment. This page updates automatically.");
    expect(describeWatch("PENDING", "paused", "PENDING")).toMatch(/paused/);
    expect(describeWatch("PENDING", "backoff", "PENDING")).toMatch(/retrying/);
    expect(describeWatch("CONFIRMING", "active", "CONFIRMING")).toMatch(/final confirmation/);
    expect(describeWatch("EXPIRED", "active", "EXPIRED")).toMatch(/just before expiry/);
  });
});
