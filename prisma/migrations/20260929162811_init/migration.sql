-- CreateEnum
CREATE TYPE "solana_network" AS ENUM ('DEVNET', 'TESTNET', 'MAINNET');

-- CreateEnum
CREATE TYPE "currency" AS ENUM ('USDC');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'PENDING', 'CONFIRMING', 'PAID', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "commitment" AS ENUM ('CONFIRMED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "wallet_address" VARCHAR(44) NOT NULL,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "default_currency" "currency" NOT NULL DEFAULT 'USDC',
    "notify_by_email" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "address" VARCHAR(44) NOT NULL,
    "label" VARCHAR(60),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "invoice_number" VARCHAR(32) NOT NULL,
    "order_id" VARCHAR(64),
    "customer_reference" VARCHAR(120),
    "description" VARCHAR(500),
    "network" "solana_network" NOT NULL,
    "currency" "currency" NOT NULL,
    "amount" BIGINT NOT NULL,
    "token_mint" VARCHAR(44) NOT NULL,
    "token_decimals" SMALLINT NOT NULL,
    "recipient_wallet" VARCHAR(44) NOT NULL,
    "reference" VARCHAR(44) NOT NULL,
    "status" "invoice_status" NOT NULL,
    "failure_reason" VARCHAR(200),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "signature" VARCHAR(88) NOT NULL,
    "network" "solana_network" NOT NULL,
    "reference" VARCHAR(44) NOT NULL,
    "sender_wallet" VARCHAR(44) NOT NULL,
    "recipient_wallet" VARCHAR(44) NOT NULL,
    "recipient_token_account" VARCHAR(44) NOT NULL,
    "token_mint" VARCHAR(44) NOT NULL,
    "amount" BIGINT NOT NULL,
    "slot" BIGINT NOT NULL,
    "block_time" TIMESTAMPTZ(3),
    "commitment" "commitment" NOT NULL,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "finalized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" VARCHAR(64),
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "data" JSONB,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "users"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_owner_user_id_key" ON "merchants"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_merchant_id_address_key" ON "wallets"("merchant_id", "address");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_reference_key" ON "invoices"("reference");

-- CreateIndex
CREATE INDEX "invoices_merchant_id_status_idx" ON "invoices"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "invoices_merchant_id_created_at_idx" ON "invoices"("merchant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "invoices_status_expires_at_idx" ON "invoices"("status", "expires_at");

-- CreateIndex
CREATE INDEX "invoices_merchant_id_order_id_idx" ON "invoices"("merchant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_merchant_id_invoice_number_key" ON "invoices"("merchant_id", "invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "payments_invoice_id_key" ON "payments"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_signature_key" ON "payments"("signature");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written constraints (Prisma's schema language can't express these)
-- =====================================================================

-- Money is always a positive number of base units.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_token_decimals_range" CHECK ("token_decimals" BETWEEN 0 AND 18);

-- paid_at is set exactly when the invoice is PAID.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_at_matches_status"
  CHECK (("status" = 'PAID') = ("paid_at" IS NOT NULL));

-- A FINALIZED payment must have a finalized_at timestamp, and vice versa.
ALTER TABLE "payments" ADD CONSTRAINT "payments_finalized_at_matches_commitment"
  CHECK (("commitment" = 'FINALIZED') = ("finalized_at" IS NOT NULL));

-- At most one default payout wallet per merchant (partial unique index).
CREATE UNIQUE INDEX "wallets_one_default_per_merchant" ON "wallets"("merchant_id") WHERE "is_default";

-- Audit log is append-only: block UPDATE and DELETE.
CREATE FUNCTION "audit_logs_block_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% not allowed)', TG_OP;
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_changes"();
