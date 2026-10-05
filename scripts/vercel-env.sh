#!/usr/bin/env bash
# Builds the production environment variables for Vercel (Phase 15) into .env.vercel
# (git-ignored, readable only by you). Open that file yourself and paste its contents
# into Vercel → Project → Settings → Environment Variables (Production). It prints key
# names only, never values.
#
#   ./scripts/vercel-env.sh https://your-project.vercel.app
#
# Reads .env.neon (the app role's password and the database host) and .env.helius
# (HELIUS_DEVNET_RPC_URL=https://devnet.helius-rpc.com/?api-key=…). AUTH_SECRET and
# CRON_SECRET are generated on the first run and kept on later runs, so re-running with
# another app URL doesn't sign everyone out.
#
# Deliberately NOT included: the owner's database URL (migrations run from your machine),
# test databases, Docker settings.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/env-file.sh

app_url="${1:-}"
[[ "$app_url" =~ ^https://[a-z0-9.-]+$ ]] || { echo "usage: $0 https://<your-project>.vercel.app  (https, no path or trailing slash)" >&2; exit 2; }

read_env_file .env.neon NEON_OWNER_DIRECT_URL NEON_APP_POOLED_URL APP_DB_PASSWORD
read_env_file .env.helius HELIUS_DEVNET_RPC_URL
: "${APP_DB_PASSWORD:?missing in .env.neon}" "${NEON_OWNER_DIRECT_URL:?missing in .env.neon}" "${HELIUS_DEVNET_RPC_URL:?missing in .env.helius}"

# Keep the secrets of an earlier run.
AUTH_SECRET="" CRON_SECRET=""
[[ -f .env.vercel ]] && read_env_file .env.vercel AUTH_SECRET CRON_SECRET 2>/dev/null || true
AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -hex 32)}"
CRON_SECRET="${CRON_SECRET:-$(openssl rand -hex 32)}"

# The server's RPC must really be devnet (the app also checks this at runtime).
# The URL (with its API key) goes to curl through stdin, not the command line.
genesis=$(printf 'url = "%s"\n' "$HELIUS_DEVNET_RPC_URL" | curl -s --max-time 20 -K - -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).result??"")}catch{console.log("")}})')
[[ "$genesis" == "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ]] || { echo "HELIUS_DEVNET_RPC_URL doesn't answer as Solana devnet (check the URL and API key)." >&2; exit 1; }

# The app connects as solanapay_app through Neon's pooler, verifying the certificate.
database_url=$(OWNER_URL="$NEON_OWNER_DIRECT_URL" node -e '
  const url = new URL(process.env.OWNER_URL);
  const [endpoint, ...rest] = url.hostname.split(".");
  url.hostname = [endpoint.replace(/-pooler$/, "") + "-pooler", ...rest].join(".");
  url.username = "solanapay_app";
  url.password = process.env.APP_DB_PASSWORD;
  url.searchParams.set("sslmode", "verify-full");
  console.log(url.toString());')

umask 077
cat > .env.vercel <<EOF
APP_ENV=production
LOG_LEVEL=info
NEXT_PUBLIC_APP_URL=$app_url
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_EXPLORER_URL=https://explorer.solana.com
SOLANA_RPC_URL=$HELIUS_DEVNET_RPC_URL
USDC_MINT_DEVNET=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
USDC_MINT_MAINNET=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
AUTH_SECRET=$AUTH_SECRET
CRON_SECRET=$CRON_SECRET
DATABASE_URL=$database_url
EOF
chmod 600 .env.vercel
git check-ignore -q .env.vercel || { echo "Refusing: .env.vercel is not git-ignored." >&2; rm -f .env.vercel; exit 1; }

echo "Wrote .env.vercel (git-ignored, mode 600) with:"
sed 's/=.*//; s/^/  /' .env.vercel
echo "Helius RPC answers as Solana devnet."
