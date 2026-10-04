import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { ApiError, parseJsonBody } from "@/lib/http/api";
import { assertSameOrigin } from "@/lib/http/request";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { requireMerchant, requireSession } from "@/lib/merchant/require-merchant";
import { payoutWalletProblem } from "@/lib/merchant/payout-wallet";
import { lockPayoutAddress, sharedPayoutProblem } from "@/lib/merchant/shared-payout";
import { onChainPayoutProblem } from "@/lib/merchant/payout-onchain";

const nameSchema = z.string().trim().min(1, "Enter a business name.").max(120, "At most 120 characters.");
const emailSchema = z.union([z.literal(""), z.email("Enter a valid email address.").max(254)]); // "" clears it

const bodySchema = z.strictObject({
  name: nameSchema,
  email: emailSchema.optional(),
  payoutWallet: z.string().trim().optional(), // defaults to the signed-in wallet
});

// Settings (Phase 11.4b): name and email only. The payout wallet is not accepted here
// (strict schema): changing it needs a fresh wallet signature (/api/merchant/payout-wallet).
const updateSchema = z
  .strictObject({ name: nameSchema.optional(), email: emailSchema.optional() })
  .refine((body) => body.name !== undefined || body.email !== undefined, "Nothing to update.");

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
  await enforceRateLimit(`merchant:create:${session.userId}`, 10, 60); // each attempt may query the RPC
  const body = await parseJsonBody(request, bodySchema);

  const payoutWallet = body.payoutWallet || session.walletAddress;
  // The signed-in wallet just proved it holds its key, so only another wallet is
  // looked up on-chain.
  const problem =
    payoutWalletProblem(payoutWallet) ??
    (payoutWallet === session.walletAddress ? null : await onChainPayoutProblem(payoutWallet));
  if (problem) throw new ApiError("InvalidRequest", { payoutWallet: problem });

  try {
    const merchant = await db.$transaction(async (tx) => {
      await lockPayoutAddress(tx, payoutWallet);
      const shared = await sharedPayoutProblem(tx, payoutWallet, session.userId);
      if (shared) throw new ApiError("InvalidRequest", { payoutWallet: shared });
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

// Updates the business name and/or email. Only real changes are written and audited
// (old and new values); an unchanged submission returns the profile as it is.
export const PATCH = route("merchant.update", async (request, { log }) => {
  assertSameOrigin(request);
  const { session, merchant, payoutWallet } = await requireMerchant(request);
  await enforceRateLimit(`merchant:update:${merchant.id}`, 20, 60);
  const body = await parseJsonBody(request, updateSchema);

  const next = { name: body.name ?? merchant.name, email: body.email === undefined ? merchant.email : body.email || null };
  const changes = Object.fromEntries(
    (["name", "email"] as const)
      .filter((field) => next[field] !== merchant[field])
      .map((field) => [field, { from: merchant[field], to: next[field] }]),
  );
  if (Object.keys(changes).length === 0) return NextResponse.json(toDto(merchant, payoutWallet));

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.merchant.update({ where: { id: merchant.id }, data: next });
    await tx.auditLog.create({
      data: { actorType: "USER", actorId: session.userId, action: "merchant.updated", entityType: "merchant", entityId: merchant.id, data: changes },
    });
    return row;
  });
  log.info({ merchantId: merchant.id, fields: Object.keys(changes) }, "merchant updated");
  return NextResponse.json(toDto(updated, payoutWallet));
});
