// Development-only demo data: a merchant profile for your wallet plus a few demo
// invoices, created through the same code path as the real API (createInvoice).
//
// Usage:  npm run db:seed -- --wallet <your wallet address> [--name "Demo Shop"]
//
// Safe to run repeatedly: demo invoices use fixed idempotency keys, so a rerun
// returns the existing ones instead of creating duplicates. Refuses to run unless
// APP_ENV=development and the database is local (never production or test data).
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";

if (existsSync(".env")) process.loadEnvFile(".env");

const DEMO_INVOICES = [
  { key: "seed-demo-1", amount: "10.00", orderId: "DEMO-10001", description: "Laptop accessory purchase", expiresInMinutes: 30 },
  { key: "seed-demo-2", amount: "25.50", orderId: "DEMO-10002", description: "Coffee beans, 1 kg", expiresInMinutes: 1440 },
  { key: "seed-demo-3", amount: "5.00", orderId: "DEMO-10003", description: "Sticker pack", expiresInMinutes: 15 },
  { key: "seed-demo-4", amount: "120.00", orderId: null, description: "Conference ticket", expiresInMinutes: 60 },
] as const;

async function main() {
  // Guard first, before any database module is loaded.
  const { seedRefusal } = await import("../src/lib/dev/seed-guard");
  const refusal = seedRefusal({ APP_ENV: process.env.APP_ENV, DATABASE_URL: process.env.DATABASE_URL });
  if (refusal) throw new Error(`Seed refused: ${refusal}`);

  const { values } = parseArgs({ options: { wallet: { type: "string" }, name: { type: "string", default: "Demo Shop" } } });
  if (!values.wallet) throw new Error("Pass your wallet address: npm run db:seed -- --wallet <address>");

  const { payoutWalletProblem } = await import("../src/lib/merchant/payout-wallet");
  const problem = payoutWalletProblem(values.wallet);
  if (problem) throw new Error(`--wallet: ${problem}`);
  const wallet = values.wallet;

  const { db } = await import("../src/lib/db/client");
  const { createInvoice } = await import("../src/lib/payments/create-invoice");

  try {
    const user = await db.user.upsert({ where: { walletAddress: wallet }, create: { walletAddress: wallet }, update: {} });

    let merchant = await db.merchant.findUnique({ where: { ownerUserId: user.id } });
    if (!merchant) {
      merchant = await db.$transaction(async (tx) => {
        const created = await tx.merchant.create({ data: { ownerUserId: user.id, name: values.name } });
        await tx.wallet.create({ data: { merchantId: created.id, address: wallet, label: "Default", isDefault: true } });
        await tx.auditLog.create({
          data: { actorType: "SYSTEM", action: "merchant.created", entityType: "merchant", entityId: created.id, data: { seed: true } },
        });
        return created;
      });
      console.log(`Created merchant "${merchant.name}"`);
    } else {
      console.log(`Using existing merchant "${merchant.name}" (profile unchanged)`);
    }

    const payoutWallet = (await db.wallet.findFirstOrThrow({ where: { merchantId: merchant.id, isDefault: true } })).address;

    for (const demo of DEMO_INVOICES) {
      const { invoice, created } = await createInvoice(
        { id: merchant.id, userId: user.id, payoutWallet },
        { amount: demo.amount, orderId: demo.orderId, description: demo.description, customerReference: "seed", expiresInMinutes: demo.expiresInMinutes },
        demo.key,
      );
      console.log(`${created ? "created " : "exists  "} ${invoice.invoiceNumber}  ${invoice.orderId?.padEnd(15)}  ${demo.amount.padStart(7)} USDC  ${demo.description}`);
    }
    console.log("Done. Open http://localhost:3000/invoices");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
