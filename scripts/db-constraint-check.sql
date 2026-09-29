-- Verifies the database rejects invalid data. Safe to run on any environment:
-- everything happens inside one transaction that is ROLLED BACK at the end.
-- Usage (local Docker): npm run db:check

BEGIN;

CREATE TEMP TABLE results (test text, outcome text) ON COMMIT DROP;

-- Expects `stmt` to fail with SQLSTATE `expected`; records PASS or FAIL.
CREATE FUNCTION pg_temp.expect_error(test text, stmt text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    INSERT INTO results VALUES (test, 'FAIL (statement succeeded)');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO results VALUES (test,
      CASE WHEN SQLSTATE = expected THEN 'PASS' ELSE 'FAIL (got ' || SQLSTATE || ': ' || SQLERRM || ')' END);
  END;
END;
$$;

-- Fixture rows (the app generates UUIDv7 IDs; fixed/random UUIDs are fine here).
INSERT INTO users (id, wallet_address, updated_at)
  VALUES ('00000000-0000-4000-8000-000000000001', 'TestWa11etAddress1111111111111111111111111', now());
INSERT INTO merchants (id, owner_user_id, name, updated_at)
  VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Test Merchant', now());
INSERT INTO invoices (id, merchant_id, invoice_number, network, currency, amount, token_mint, token_decimals,
                      recipient_wallet, reference, status, expires_at, updated_at)
  VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'INV-TEST-1',
          'DEVNET', 'USDC', 10000000, '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 6,
          'TestWa11etAddress1111111111111111111111111', 'TestReference11111111111111111111111111111', 'PENDING',
          now() + interval '30 minutes', now());
INSERT INTO payments (id, invoice_id, signature, network, reference, sender_wallet, recipient_wallet,
                      recipient_token_account, token_mint, amount, slot, commitment, verified_at, updated_at)
  VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000003', 'TestSignature1', 'DEVNET',
          'TestReference11111111111111111111111111111', 'Sender', 'TestWa11etAddress1111111111111111111111111',
          'TokenAccount', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 10000000, 1, 'CONFIRMED', now(), now());
INSERT INTO audit_logs (actor_type, action, entity_type, entity_id) VALUES ('SYSTEM', 'test', 'invoice', 'x');

\o /dev/null
-- 23514 = check_violation, 23505 = unique_violation, 23503 = foreign_key_violation,
-- 22P02 = invalid enum value, P0001 = raised by our trigger
SELECT pg_temp.expect_error('invoice amount must be > 0',
  $q$UPDATE invoices SET amount = 0 WHERE invoice_number = 'INV-TEST-1'$q$, '23514');
SELECT pg_temp.expect_error('PAID requires paid_at',
  $q$UPDATE invoices SET status = 'PAID' WHERE invoice_number = 'INV-TEST-1'$q$, '23514');
SELECT pg_temp.expect_error('paid_at only when PAID',
  $q$UPDATE invoices SET paid_at = now() WHERE invoice_number = 'INV-TEST-1'$q$, '23514');
SELECT pg_temp.expect_error('unknown status rejected',
  $q$UPDATE invoices SET status = 'REFUNDED' WHERE invoice_number = 'INV-TEST-1'$q$, '22P02');
SELECT pg_temp.expect_error('reference is unique across invoices',
  $q$INSERT INTO invoices (id, merchant_id, invoice_number, network, currency, amount, token_mint, token_decimals,
       recipient_wallet, reference, status, expires_at, updated_at)
     SELECT gen_random_uuid(), merchant_id, 'INV-TEST-2', network, currency, amount, token_mint, token_decimals,
       recipient_wallet, reference, status, expires_at, now() FROM invoices WHERE invoice_number = 'INV-TEST-1'$q$, '23505');
SELECT pg_temp.expect_error('invoice number is unique per merchant',
  $q$INSERT INTO invoices (id, merchant_id, invoice_number, network, currency, amount, token_mint, token_decimals,
       recipient_wallet, reference, status, expires_at, updated_at)
     SELECT gen_random_uuid(), merchant_id, invoice_number, network, currency, amount, token_mint, token_decimals,
       recipient_wallet, 'OtherReference', status, expires_at, now() FROM invoices WHERE invoice_number = 'INV-TEST-1'$q$, '23505');
SELECT pg_temp.expect_error('signature cannot be reused (replay)',
  $q$INSERT INTO payments (id, invoice_id, signature, network, reference, sender_wallet, recipient_wallet,
       recipient_token_account, token_mint, amount, slot, commitment, verified_at, updated_at)
     SELECT gen_random_uuid(), gen_random_uuid(), signature, network, reference, sender_wallet, recipient_wallet,
       recipient_token_account, token_mint, amount, slot, commitment, verified_at, now() FROM payments LIMIT 1$q$, '23505');
SELECT pg_temp.expect_error('one payment per invoice',
  $q$INSERT INTO payments (id, invoice_id, signature, network, reference, sender_wallet, recipient_wallet,
       recipient_token_account, token_mint, amount, slot, commitment, verified_at, updated_at)
     SELECT gen_random_uuid(), invoice_id, 'OtherSignature', network, reference, sender_wallet, recipient_wallet,
       recipient_token_account, token_mint, amount, slot, commitment, verified_at, now() FROM payments LIMIT 1$q$, '23505');
SELECT pg_temp.expect_error('payment must reference an existing invoice',
  $q$UPDATE payments SET invoice_id = gen_random_uuid()$q$, '23503');
SELECT pg_temp.expect_error('FINALIZED requires finalized_at',
  $q$UPDATE payments SET commitment = 'FINALIZED'$q$, '23514');
SELECT pg_temp.expect_error('one default wallet per merchant',
  $q$INSERT INTO wallets (id, merchant_id, address, is_default, updated_at) VALUES
       (gen_random_uuid(), '00000000-0000-4000-8000-000000000002', 'WalletA', true, now()),
       (gen_random_uuid(), '00000000-0000-4000-8000-000000000002', 'WalletB', true, now())$q$, '23505');
SELECT pg_temp.expect_error('audit log UPDATE blocked',
  $q$UPDATE audit_logs SET action = 'tampered'$q$, 'P0001');
SELECT pg_temp.expect_error('audit log DELETE blocked',
  $q$DELETE FROM audit_logs$q$, 'P0001');
SELECT pg_temp.expect_error('merchant with invoices cannot be deleted',
  $q$DELETE FROM merchants WHERE id = '00000000-0000-4000-8000-000000000002'$q$, '23503');
\o

\pset footer off
SELECT test, outcome FROM results;
SELECT count(*) FILTER (WHERE outcome = 'PASS') AS passed, count(*) AS total FROM results;

ROLLBACK;
