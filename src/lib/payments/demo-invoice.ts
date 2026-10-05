import "server-only";
import type { Invoice } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { ApiError } from "@/lib/http/api";
import { createInvoice } from "./create-invoice";

// "Try a demo payment" (Phase 16, decision H2-A): a real, small invoice of a dedicated
// demo merchant, so anyone can try the production checkout without signing up. Created
// through createInvoice like any invoice: the server fixes every payment term.
export const DEMO = {
  amount: "0.01", // USDC
  expiresInMinutes: 15,
  description: "Demo payment: SolanaPay Checkout",
  perIpPerHour: 5,
  dailyCap: 200, // per rolling 24 h, counted from the database (survives rate-limit cleanup)
} as const;

export async function createDemoInvoice(
  merchantId: string,
  { now = new Date(), dailyCap = DEMO.dailyCap }: { now?: Date; dailyCap?: number } = {},
): Promise<Invoice> {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    include: { wallets: { where: { isDefault: true }, take: 1 } },
  });
  const payoutWallet = merchant?.wallets[0]?.address;
  if (!merchant || !payoutWallet) throw new ApiError("NotFound"); // misconfigured: no demo

  const createdToday = await db.invoice.count({
    where: { merchantId, createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60_000) } },
  });
  if (createdToday >= dailyCap) throw new ApiError("RateLimited", undefined, { retryAfterSeconds: 60 * 60 });

  const { invoice } = await createInvoice(
    { id: merchant.id, userId: merchant.ownerUserId, payoutWallet },
    { amount: DEMO.amount, orderId: null, description: DEMO.description, customerReference: null, expiresInMinutes: DEMO.expiresInMinutes },
    null,
    { type: "SYSTEM", id: "demo" },
  );
  return invoice;
}
