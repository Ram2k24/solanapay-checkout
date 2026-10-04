#!/usr/bin/env bash
# Smoke test against the PRODUCTION build: starts `next start` on a spare port,
# checks key endpoints, then stops the server. Run `npm run build` first.
# Usage: npm run smoke
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${SMOKE_PORT:-3100}"
BASE="http://localhost:$PORT"
set -a; . ./.env; set +a
ORIGIN="${NEXT_PUBLIC_APP_URL%/}"   # the Origin our own pages send
WALLET="DEdD6CafAz6TtKhKhicX26mKszTt5kaq16An485E5XY"

# Own process group (setsid), so the cleanup stops Next.js and any child processes.
setsid node_modules/.bin/next start -p "$PORT" > /dev/null 2>&1 &
SERVER_PID=$!
trap 'kill -- -"$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null' EXIT

for _ in $(seq 1 30); do curl -s -o /dev/null "$BASE/api/health" && break; sleep 0.5; done

fail=0
check() { # name, expected HTTP status, curl args...
  local name=$1 expected=$2; shift 2
  local status; status=$(curl -s -o /tmp/smoke-body.$$ -w "%{http_code}" "$@")
  if [[ "$status" == "$expected" ]]; then printf '  \033[32mPASS\033[0m  %-45s HTTP %s\n' "$name" "$status"
  else printf '  \033[31mFAIL\033[0m  %-45s HTTP %s (expected %s)\n' "$name" "$status" "$expected"; fail=1; fi
}

echo "Smoke test: $BASE"
check "landing page"                        200 "$BASE/"
# Security headers (Phase 13) on a page and an API route.
for path in "/" "/api/health"; do
  head=$(curl -s -D - -o /dev/null "$BASE$path" | tr -d '\r')
  for h in "content-security-policy: default-src 'self'" "x-content-type-options: nosniff" "x-frame-options: DENY" "referrer-policy: strict-origin-when-cross-origin"; do
    if grep -qiF "$h" <<<"$head"; then printf '  \033[32mPASS\033[0m  %-45s %s\n' "header on $path" "${h%%:*}"
    else printf '  \033[31mFAIL\033[0m  %-45s missing %s\n' "header on $path" "${h%%:*}"; fail=1; fi
  done
done
check "health (app + database)"             200 "$BASE/api/health"
check "sign-in challenge, same origin"      200 -X POST "$BASE/api/auth/nonce" -H "origin: $ORIGIN" -H 'content-type: application/json' -d "{\"walletAddress\":\"$WALLET\"}"
grep -q "Chain ID: $NEXT_PUBLIC_SOLANA_NETWORK" /tmp/smoke-body.$$ && echo "        message contains 'Chain ID: $NEXT_PUBLIC_SOLANA_NETWORK'" || { echo "        message missing chain ID"; fail=1; }
check "sign-in challenge, foreign origin"   403 -X POST "$BASE/api/auth/nonce" -H 'origin: https://evil.example' -H 'content-type: application/json' -d "{\"walletAddress\":\"$WALLET\"}"
check "sign-in challenge, invalid address"  400 -X POST "$BASE/api/auth/nonce" -H "origin: $ORIGIN" -H 'content-type: application/json' -d '{"walletAddress":"not-a-wallet"}'
check "checkout page, unknown invoice"       404 "$BASE/pay/00000000-0000-7000-8000-000000000000"
check "tx request preflight (CORS)"         204 -X OPTIONS "$BASE/api/pay/00000000-0000-7000-8000-000000000000/transaction"
check "tx request, unknown invoice"          404 -X POST "$BASE/api/pay/00000000-0000-7000-8000-000000000000/transaction" -H 'content-type: application/json' -d "{\"account\":\"$WALLET\"}"
check "invoice status, unknown invoice"      404 "$BASE/api/pay/00000000-0000-7000-8000-000000000000/status"
check "Solana Pay icon"                      200 "$BASE/solana-pay-icon.svg"
check "unmatched payments, no session"       401 "$BASE/api/payments/unmatched"
check "transaction lookup, no session"       401 -X POST "$BASE/api/payments/lookup" -H "origin: $ORIGIN" -H 'content-type: application/json' -d '{"signature":"x"}'
check "reconciler, no secret"               401 -X POST "$BASE/api/internal/reconcile"
check "session without cookie"              200 "$BASE/api/auth/session"
grep -q '"authenticated":false' /tmp/smoke-body.$$ && echo "        reports authenticated:false" || { echo "        unexpected session body"; fail=1; }
rm -f /tmp/smoke-body.$$

echo
if [[ $fail -eq 0 ]]; then echo "Smoke test passed."; else echo "Smoke test FAILED."; exit 1; fi
