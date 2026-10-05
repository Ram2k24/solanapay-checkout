// Where the browser tests' servers listen (playwright.config.ts starts both).
export const E2E_APP_URL = "http://localhost:3200";
export const E2E_RPC_PORT = 3299;
export const E2E_RPC_URL = `http://127.0.0.1:${E2E_RPC_PORT}`;
// The E2E build's DEMO_MERCHANT_ID (Phase 16): demo.spec.ts creates a merchant with this id.
export const E2E_DEMO_MERCHANT_ID = "01a10e63-0000-7000-8000-0000000e2ed0";
