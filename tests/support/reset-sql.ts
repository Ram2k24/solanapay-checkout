// Every app table, emptied between tests (Vitest and Playwright share this list, so a
// new table can't be forgotten in one of them).
export const RESET_SQL = `TRUNCATE users, merchants, wallets, invoices, invoice_checks, payments, unmatched_payments, audit_logs,
  auth_nonces, sessions, rate_limits RESTART IDENTITY CASCADE`;
