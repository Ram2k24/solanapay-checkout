-- CreateEnum
CREATE TYPE "unmatched_reason" AS ENUM ('NO_REFERENCE', 'UNKNOWN_REFERENCE', 'AMOUNT_MISMATCH', 'DUPLICATE_PAYMENT', 'INVOICE_NOT_PAYABLE');

-- CreateEnum
CREATE TYPE "unmatched_status" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "unmatched_payments" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "invoice_id" UUID,
    "reason" "unmatched_reason" NOT NULL,
    "status" "unmatched_status" NOT NULL DEFAULT 'OPEN',
    "signature" VARCHAR(88) NOT NULL,
    "network" "solana_network" NOT NULL,
    "reference" VARCHAR(44),
    "sender_wallet" VARCHAR(44),
    "recipient_wallet" VARCHAR(44) NOT NULL,
    "recipient_token_account" VARCHAR(44) NOT NULL,
    "token_mint" VARCHAR(44) NOT NULL,
    "amount" BIGINT NOT NULL,
    "slot" BIGINT NOT NULL,
    "block_time" TIMESTAMPTZ(3),
    "commitment" "commitment" NOT NULL,
    "resolution_note" VARCHAR(500),
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "unmatched_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unmatched_payments_signature_key" ON "unmatched_payments"("signature");

-- CreateIndex
CREATE INDEX "unmatched_payments_merchant_id_status_created_at_idx" ON "unmatched_payments"("merchant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "unmatched_payments_invoice_id_idx" ON "unmatched_payments"("invoice_id");

-- AddForeignKey
ALTER TABLE "unmatched_payments" ADD CONSTRAINT "unmatched_payments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmatched_payments" ADD CONSTRAINT "unmatched_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmatched_payments" ADD CONSTRAINT "unmatched_payments_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Hand-written constraints and triggers (Prisma's schema language can't express these)
-- =====================================================================

-- Money is always a positive number of base units.
ALTER TABLE "unmatched_payments" ADD CONSTRAINT "unmatched_payments_amount_positive" CHECK ("amount" > 0);

-- Reasons about a specific invoice must name it; the others must not.
ALTER TABLE "unmatched_payments" ADD CONSTRAINT "unmatched_payments_invoice_matches_reason"
  CHECK (("reason" IN ('AMOUNT_MISMATCH', 'DUPLICATE_PAYMENT', 'INVOICE_NOT_PAYABLE')) = ("invoice_id" IS NOT NULL));

-- NO_REFERENCE exactly when there is no reference.
ALTER TABLE "unmatched_payments" ADD CONSTRAINT "unmatched_payments_reference_matches_reason"
  CHECK (("reason" = 'NO_REFERENCE') = ("reference" IS NULL));

-- A RESOLVED entry records when, by whom and why (a non-blank note); an OPEN one has none of these.
ALTER TABLE "unmatched_payments" ADD CONSTRAINT "unmatched_payments_resolution_matches_status"
  CHECK (
    ("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL)
    AND ("status" = 'RESOLVED') = ("resolved_by_user_id" IS NOT NULL)
    AND ("status" = 'RESOLVED') = ("resolution_note" IS NOT NULL)
    AND ("resolution_note" IS NULL OR length(btrim("resolution_note")) > 0)
  );

-- One on-chain transaction is recorded once: in payments OR in unmatched_payments,
-- never both (each table's UNIQUE(signature) covers duplicates within it). The
-- advisory lock serializes concurrent inserts of the same signature across the two
-- tables; under READ COMMITTED the EXISTS check then sees the other's committed row.
CREATE FUNCTION "signature_recorded_once"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('payment-signature:' || NEW.signature, 0));
  IF (TG_TABLE_NAME = 'payments' AND EXISTS (SELECT 1 FROM "unmatched_payments" WHERE "signature" = NEW.signature))
  OR (TG_TABLE_NAME = 'unmatched_payments' AND EXISTS (SELECT 1 FROM "payments" WHERE "signature" = NEW.signature))
  THEN
    RAISE EXCEPTION 'transaction % is already recorded', NEW.signature USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_signature_recorded_once"
  BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "signature_recorded_once"();

CREATE TRIGGER "unmatched_payments_signature_recorded_once"
  BEFORE INSERT ON "unmatched_payments"
  FOR EACH ROW EXECUTE FUNCTION "signature_recorded_once"();

-- An unmatched entry can only point at an invoice of the same merchant.
CREATE FUNCTION "unmatched_payments_check_invoice_merchant"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "invoices" WHERE "id" = NEW.invoice_id AND "merchant_id" = NEW.merchant_id
  ) THEN
    RAISE EXCEPTION 'invoice % does not belong to merchant %', NEW.invoice_id, NEW.merchant_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "unmatched_payments_invoice_merchant"
  BEFORE INSERT ON "unmatched_payments"
  FOR EACH ROW EXECUTE FUNCTION "unmatched_payments_check_invoice_merchant"();

-- Payment evidence is immutable and never deleted. The only change allowed is the
-- finality upgrade CONFIRMED -> FINALIZED (commitment, finalized_at, updated_at).
CREATE FUNCTION "payments_block_evidence_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted (payment %)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id                      IS DISTINCT FROM OLD.id
  OR NEW.invoice_id              IS DISTINCT FROM OLD.invoice_id
  OR NEW.signature               IS DISTINCT FROM OLD.signature
  OR NEW.network                 IS DISTINCT FROM OLD.network
  OR NEW.reference               IS DISTINCT FROM OLD.reference
  OR NEW.sender_wallet           IS DISTINCT FROM OLD.sender_wallet
  OR NEW.recipient_wallet        IS DISTINCT FROM OLD.recipient_wallet
  OR NEW.recipient_token_account IS DISTINCT FROM OLD.recipient_token_account
  OR NEW.token_mint              IS DISTINCT FROM OLD.token_mint
  OR NEW.amount                  IS DISTINCT FROM OLD.amount
  OR NEW.slot                    IS DISTINCT FROM OLD.slot
  OR NEW.block_time              IS DISTINCT FROM OLD.block_time
  OR NEW.late                    IS DISTINCT FROM OLD.late
  OR NEW.verified_at             IS DISTINCT FROM OLD.verified_at
  OR NEW.created_at              IS DISTINCT FROM OLD.created_at
  OR (OLD.commitment = 'FINALIZED' AND NEW.commitment <> 'FINALIZED')
  THEN
    RAISE EXCEPTION 'payment evidence is immutable (payment %)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_evidence_immutable"
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payments_block_evidence_changes"();

-- Unmatched evidence is immutable and never deleted. Allowed: the finality upgrade,
-- and resolving an OPEN entry once (a resolution is final).
CREATE FUNCTION "unmatched_payments_block_evidence_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'unmatched payments cannot be deleted (entry %)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.id                      IS DISTINCT FROM OLD.id
  OR NEW.merchant_id             IS DISTINCT FROM OLD.merchant_id
  OR NEW.invoice_id              IS DISTINCT FROM OLD.invoice_id
  OR NEW.reason                  IS DISTINCT FROM OLD.reason
  OR NEW.signature               IS DISTINCT FROM OLD.signature
  OR NEW.network                 IS DISTINCT FROM OLD.network
  OR NEW.reference               IS DISTINCT FROM OLD.reference
  OR NEW.sender_wallet           IS DISTINCT FROM OLD.sender_wallet
  OR NEW.recipient_wallet        IS DISTINCT FROM OLD.recipient_wallet
  OR NEW.recipient_token_account IS DISTINCT FROM OLD.recipient_token_account
  OR NEW.token_mint              IS DISTINCT FROM OLD.token_mint
  OR NEW.amount                  IS DISTINCT FROM OLD.amount
  OR NEW.slot                    IS DISTINCT FROM OLD.slot
  OR NEW.block_time              IS DISTINCT FROM OLD.block_time
  OR NEW.created_at              IS DISTINCT FROM OLD.created_at
  OR (OLD.commitment = 'FINALIZED' AND NEW.commitment <> 'FINALIZED')
  OR (OLD.status = 'RESOLVED' AND (
        NEW.status              IS DISTINCT FROM OLD.status
     OR NEW.resolution_note     IS DISTINCT FROM OLD.resolution_note
     OR NEW.resolved_at         IS DISTINCT FROM OLD.resolved_at
     OR NEW.resolved_by_user_id IS DISTINCT FROM OLD.resolved_by_user_id))
  THEN
    RAISE EXCEPTION 'unmatched payment evidence is immutable (entry %)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "unmatched_payments_evidence_immutable"
  BEFORE UPDATE OR DELETE ON "unmatched_payments"
  FOR EACH ROW EXECUTE FUNCTION "unmatched_payments_block_evidence_changes"();
