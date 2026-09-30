import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { ApiError, parseJsonBody } from "@/lib/http/api";
import { assertSameOrigin } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { requireSession } from "@/lib/merchant/require-merchant";
import { payoutWalletProblem } from "@/lib/merchant/payout-wallet";

const bodySchema = z.strictObject({
  name: z.string().trim().min(1, "Enter a business name.").max(120, "At most 120 characters."),
  email: z.union([z.literal(""), z.email("Enter a valid email address.").max(254)]).optional(),
  payoutWallet: z.string().trim().optional(), // defaults to the signed-in wallet
});

function toDto(merchant: { id: string; name: string; email: string | null; defaultCurrency: string }, payoutWallet: string) {
  return { id: merchant.id, name: merchant.name, email: merchant.email, defaultCurrency: merchant.defaultCurrency, payoutWallet };
}

// The signed-in user's merchant profile, or 404 if not created yet.
export const GET = route("merchant.get", async (request) => {
  const session = await requireSession(request);
  const merchant = await db.merchant.findUnique({
    where: { ownerUserId: session.userId },
    include: { wallets: { where: { isDefault: true }, take: 1 } },
  });
  const payoutWallet = merchant?.wallets[0]?.address;
  if (!merchant || !payoutWallet) throw new ApiError("NotFound");
  return NextResponse.json(toDto(merchant, payoutWallet));
});

// Creates the merchant profile (once) with a default payout wallet.
export const POST = route("merchant.create", async (request, { log }) => {
  assertSameOrigin(request);
  const session = await requireSession(request);
  const body = await parseJsonBody(request, bodySchema);

  const payoutWallet = body.payoutWallet || session.walletAddress;
  const problem = payoutWalletProblem(payoutWallet);
  if (problem) throw new ApiError("InvalidRequest", { payoutWallet: problem });

  try {
    const merchant = await db.$transaction(async (tx) => {
      const created = await tx.merchant.create({
        data: { ownerUserId: session.userId, name: body.name, email: body.email || null },
      });
      await tx.wallet.create({ data: { merchantId: created.id, address: payoutWallet, label: "Default", isDefault: true } });
      await tx.auditLog.create({
        data: { actorType: "USER", actorId: session.userId, action: "merchant.created", entityType: "merchant", entityId: created.id, data: { payoutWallet } },
      });
      return created;
    });
    log.info({ merchantId: merchant.id }, "merchant created");
    return NextResponse.json(toDto(merchant, payoutWallet), { status: 201 });
  } catch (error) {
    // owner_user_id is UNIQUE: a second profile for the same user is rejected by the database.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError("MerchantAlreadyExists");
    }
    throw error;
  }
});
