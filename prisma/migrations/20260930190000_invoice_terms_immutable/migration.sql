-- An invoice's payment terms are fixed once it exists: the QR code / payment link
-- shared with the customer, and the on-chain verification (Phase 9), both rely on
-- the stored values. Only lifecycle fields (status, paid_at, failure_reason,
-- expires_at, updated_at) may change. Enforced here so no code path or manual SQL
-- can alter what a customer was asked to pay, or to whom.
CREATE FUNCTION "invoices_block_term_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.merchant_id      IS DISTINCT FROM OLD.merchant_id
  OR NEW.invoice_number   IS DISTINCT FROM OLD.invoice_number
  OR NEW.order_id         IS DISTINCT FROM OLD.order_id
  OR NEW.network          IS DISTINCT FROM OLD.network
  OR NEW.currency         IS DISTINCT FROM OLD.currency
  OR NEW.amount           IS DISTINCT FROM OLD.amount
  OR NEW.token_mint       IS DISTINCT FROM OLD.token_mint
  OR NEW.token_decimals   IS DISTINCT FROM OLD.token_decimals
  OR NEW.recipient_wallet IS DISTINCT FROM OLD.recipient_wallet
  OR NEW.reference        IS DISTINCT FROM OLD.reference
  OR NEW.created_at       IS DISTINCT FROM OLD.created_at
  OR NEW.idempotency_key  IS DISTINCT FROM OLD.idempotency_key
  OR NEW.request_hash     IS DISTINCT FROM OLD.request_hash
  THEN
    RAISE EXCEPTION 'invoice payment terms are immutable (invoice %)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "invoices_terms_immutable"
  BEFORE UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_block_term_changes"();
