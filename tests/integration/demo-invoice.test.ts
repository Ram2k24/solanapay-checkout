import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

// The route reads DEMO_MERCHANT_ID when its config module loads: set it first.
const DEMO_MERCHANT_ID = vi.hoisted(() => {
  const id = "01a10e63-0000-7000-8000-00000000d3e0";
  process.env.DEMO_MERCHANT_ID = id;
  return id;
});

import { POST as createDemo } from "@/app/api/demo/invoice/route";
import { db } from "@/lib/db/client";
import { createDemoInvoice, DEMO } from "@/lib/payments/demo-invoice";
import { resetDatabase } from "../support/db";
import { apiRequest, json } from "../support/http";
import { createTestWallet } from "../support/wallet";

// Phase 16 (decision H2-A): "Try a demo payment" creates a real 0.01 USDC invoice of the
// configured demo merchant, through the normal invoice rules, and reveals only its id.

let payout: string;
beforeEach(async () => {
  await resetDatabase();
  payout = (await createTestWallet()).address;
  const user = await db.user.create({ data: { walletAddress: payout } });
  await db.merchant.create({ data: { id: DEMO_MERCHANT_ID, ownerUserId: user.id, name: "SolanaPay Demo Store" } });
  await db.wallet.create({ data: { merchantId: DEMO_MERCHANT_ID, address: payout, isDefault: true } });
});

const demo = (init: Parameters<typeof apiRequest>[1] = {}) => createDemo(apiRequest("/api/demo/invoice", init));

describe("creating a demo invoice", () => {
  it("creates a 0.01 USDC, 15-minute invoice of the demo merchant and returns only its id", async () => {
    const before = Date.now();
    const response = await demo();

    expect(response.status).toBe(201);
    const body = await json(response);
    expect(Object.keys(body)).toEqual(["id"]);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: body.id } });
    expect(invoice).toMatchObject({
      merchantId: DEMO_MERCHANT_ID,
      amount: 10_000n, // 0.01 USDC in base units
      recipientWallet: payout,
      tokenMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      status: "PENDING",
      description: DEMO.description,
    });
    const minutes = (invoice.expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(14.9);
    expect(minutes).toBeLessThan(15.1);
  });

  it("records it in the audit log as created by the system, not by the merchant", async () => {
    const { id } = await json(await demo());
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "invoice.created", entityId: id } });
    expect(audit).toMatchObject({ actorType: "SYSTEM", actorId: "demo" });
  });

  it("only accepts requests from our own site", async () => {
    expect((await demo({ origin: "https://evil.example" })).status).toBe(403);
    expect(await db.invoice.count()).toBe(0);
  });
});

describe("limits", () => {
  it("allows 5 demo invoices per hour per IP address", async () => {
    // Inside one fixed hourly window, whatever time the test runs.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Math.floor(Date.now() / 3_600_000) * 3_600_000 + 10 * 60_000);
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const sameIp = { headers: { "x-forwarded-for": "203.0.113.7" } };

    for (let i = 0; i < 5; i++) expect((await demo(sameIp)).status).toBe(201); // the number, not DEMO.perIpPerHour
    const refused = await demo(sameIp);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
    expect((await demo({ headers: { "x-forwarded-for": "203.0.113.8" } })).status).toBe(201); // another visitor
  });

  it("stops at the daily cap, counted from the database", async () => {
    await createDemoInvoice(DEMO_MERCHANT_ID, { dailyCap: 2 });
    await createDemoInvoice(DEMO_MERCHANT_ID, { dailyCap: 2 });
    await expect(createDemoInvoice(DEMO_MERCHANT_ID, { dailyCap: 2 })).rejects.toMatchObject({ code: "RateLimited" });
    expect(await db.invoice.count()).toBe(2);
  });

  it("uses a daily cap of 200", () => {
    expect(DEMO.dailyCap).toBe(200);
  });
});

describe("configuration", () => {
  it("answers 404 when the configured demo merchant doesn't exist", async () => {
    await resetDatabase();
    expect((await demo()).status).toBe(404);
  });

  it("answers 404 when no demo merchant is configured", async () => {
    vi.resetModules();
    const saved = process.env.DEMO_MERCHANT_ID;
    delete process.env.DEMO_MERCHANT_ID;
    onTestFinished(() => {
      process.env.DEMO_MERCHANT_ID = saved;
    });
    const { POST } = await import("@/app/api/demo/invoice/route");
    expect((await POST(apiRequest("/api/demo/invoice"))).status).toBe(404);
  });
});
