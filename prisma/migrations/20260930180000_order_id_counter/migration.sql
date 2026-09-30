-- CreateEnum
CREATE TYPE "counter_kind" AS ENUM ('INVOICE', 'ORDER');

-- AlterTable
ALTER TABLE "invoice_counters" DROP CONSTRAINT "invoice_counters_pkey",
ADD COLUMN     "kind" "counter_kind" NOT NULL DEFAULT 'INVOICE',
ADD CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("merchant_id", "kind", "year");

