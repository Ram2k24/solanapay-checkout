/*
  Warnings:

  - A unique constraint covering the columns `[merchant_id,idempotency_key]` on the table `invoices` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "idempotency_key" VARCHAR(64),
ADD COLUMN     "request_hash" CHAR(64);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "merchant_id" UUID NOT NULL,
    "year" SMALLINT NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("merchant_id","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_merchant_id_idempotency_key_key" ON "invoices"("merchant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written constraints
-- =====================================================================

-- Counters start at 1 and only ever count up.
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_last_value_positive" CHECK ("last_value" > 0);
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_year_range" CHECK ("year" BETWEEN 2000 AND 9999);

-- An idempotency key is always stored together with the hash of its request.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_idempotency_pair"
  CHECK (("idempotency_key" IS NULL) = ("request_hash" IS NULL));
