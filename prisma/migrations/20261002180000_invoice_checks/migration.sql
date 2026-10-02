-- CreateTable
CREATE TABLE "invoice_checks" (
    "invoice_id" UUID NOT NULL,
    "next_check_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "lease_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_checks_pkey" PRIMARY KEY ("invoice_id")
);

-- CreateIndex
CREATE INDEX "invoice_checks_next_check_at_idx" ON "invoice_checks"("next_check_at");

-- AddForeignKey
ALTER TABLE "invoice_checks" ADD CONSTRAINT "invoice_checks_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Hand-written constraints, trigger and backfill (Phase 10)
-- =====================================================================

ALTER TABLE "invoice_checks" ADD CONSTRAINT "invoice_checks_attempts_non_negative" CHECK ("attempts" >= 0);

-- Every invoice gets its scheduling row in the same transaction that inserts it, so no
-- creation path (API, seed, tests, manual SQL) can leave an invoice unwatched. The first
-- check is due one reconciler interval (30 s) after creation.
CREATE FUNCTION "invoices_create_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "invoice_checks" ("invoice_id", "next_check_at", "updated_at")
  VALUES (NEW.id, now() + interval '30 seconds', now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoices_schedule_check"
  AFTER INSERT ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_create_check"();

-- Backfill existing invoices. Due now: anything that may still change (PENDING,
-- CONFIRMING) and EXPIRED invoices still inside the 24-hour late-money watch.
-- PAID / FAILED / older EXPIRED: no further checks (next_check_at NULL).
INSERT INTO "invoice_checks" ("invoice_id", "next_check_at", "updated_at")
SELECT "id",
       CASE
         WHEN "status" IN ('PENDING', 'CONFIRMING') THEN now()
         WHEN "status" = 'EXPIRED' AND "expires_at" > now() - interval '24 hours' THEN now()
         ELSE NULL
       END,
       now()
FROM "invoices";
