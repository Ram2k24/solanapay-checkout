#!/usr/bin/env bash
# Database tasks against the hosted (Neon) database, run from your machine (Phase 15,
# decision G2). Reads .env.neon (git-ignored), never .env, so the production owner URL
# can't reach the development app, Vercel or your shell.
#
#   ./scripts/db-remote.sh status   prisma migrate status (as the owner, direct URL)
#   ./scripts/db-remote.sh deploy   prisma migrate deploy (as the owner, direct URL)
#   ./scripts/db-remote.sh role     create/update solanapay_app and its grants
#   ./scripts/db-remote.sh check    the 57 database checks, rolled back
#   ./scripts/db-remote.sh app      connect as the app role through the pooler, like Vercel
#   ./scripts/db-remote.sh app direct   the same, without the pooler (always a fresh session)
#
# .env.neon holds:
#   NEON_OWNER_DIRECT_URL=postgresql://<owner>:<password>@<host>/<db>?sslmode=require
#   APP_DB_PASSWORD=<openssl rand -hex 24>
# The app's URL (solanapay_app through Neon's pooler: the endpoint name + "-pooler") is
# derived from these two; set NEON_APP_POOLED_URL only to override it.
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f .env.neon ]] || { echo ".env.neon not found (see the comment at the top of this script)." >&2; exit 1; }
# Read as plain KEY=value text, never run as shell code: Neon's URLs contain "&"
# (…?sslmode=require&channel_binding=require), which a shell would treat as an operator.
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  key="${line%%=*}" value="${line#*=}"
  [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]] && value="${BASH_REMATCH[1]}"
  case "$key" in
    NEON_OWNER_DIRECT_URL | NEON_APP_POOLED_URL | APP_DB_PASSWORD) export "$key=$value" ;;
    *) echo "Ignoring unknown key in .env.neon: $key" >&2 ;;
  esac
done < .env.neon
: "${NEON_OWNER_DIRECT_URL:?NEON_OWNER_DIRECT_URL is not set in .env.neon}"

host=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$NEON_OWNER_DIRECT_URL")
if [[ "$host" == localhost || "$host" == 127.* || "$host" == *-pooler* ]]; then
  echo "Refusing: NEON_OWNER_DIRECT_URL must be the hosted database's DIRECT (non -pooler) URL." >&2
  exit 1
fi

# psql from the Postgres image you already use; the URL reaches it as an environment
# variable, never as a command-line argument. Host networking: the container then uses
# this machine's DNS resolver (Docker's default network may not reach the configured one).
psql_as_owner() {
  PGURL="$NEON_OWNER_DIRECT_URL" APP_DB_PASSWORD="${APP_DB_PASSWORD:-}" \
    docker run --rm -i --network host -e PGURL -e APP_DB_PASSWORD postgres:17-alpine sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -q'
}

# solanapay_app through the pooler: same database, host "<endpoint>-pooler.<rest>".
app_pooled_url() {
  POOLER="${1:-pooled}" node -e '
    const url = new URL(process.argv[1]);
    const [endpoint, ...rest] = url.hostname.split(".");
    if (process.env.POOLER !== "direct") url.hostname = [endpoint + "-pooler", ...rest].join(".");
    url.username = "solanapay_app";
    url.password = process.env.APP_DB_PASSWORD;
    // Full certificate verification, explicitly: pg will read "require" more weakly
    // (libpq semantics) from its next major version on.
    url.searchParams.set("sslmode", "verify-full");
    console.log(url.toString());' "$NEON_OWNER_DIRECT_URL"
}

case "${1:-}" in
  status | deploy)
    # Both set: prisma.config.ts prefers MIGRATE_DATABASE_URL.
    MIGRATE_DATABASE_URL="$NEON_OWNER_DIRECT_URL" DATABASE_URL="$NEON_OWNER_DIRECT_URL" npx prisma migrate "$1"
    ;;
  role)
    : "${APP_DB_PASSWORD:?APP_DB_PASSWORD is not set in .env.neon}"
    psql_as_owner < scripts/db-app-role.sql
    ;;
  check)
    psql_as_owner < scripts/db-constraint-check.sql
    ;;
  app)
    : "${APP_DB_PASSWORD:?APP_DB_PASSWORD is not set in .env.neon}"
    if [[ "${2:-}" == direct ]]; then NEON_APP_POOLED_URL="$(app_pooled_url direct)"; else NEON_APP_POOLED_URL="${NEON_APP_POOLED_URL:-$(app_pooled_url)}"; fi
    # The same connection settings as src/lib/db/client.ts, through the pooler.
    NEON_APP_POOLED_URL="$NEON_APP_POOLED_URL" node -e '
      const { Client } = require("pg");
      const client = new Client({ connectionString: process.env.NEON_APP_POOLED_URL, connectionTimeoutMillis: 5000, query_timeout: 10000, statement_timeout: 10000 });
      (async () => {
        await client.connect();
        const { rows: [r] } = await client.query(
          "SELECT current_user AS role, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser, current_setting($1) AS statement_timeout, (SELECT rolconfig FROM pg_roles WHERE rolname = current_user) AS role_settings, (SELECT count(*) FROM invoices)::int AS invoices",
          ["statement_timeout"]);
        console.log(r);
        for (const sql of ["TRUNCATE audit_logs", "ALTER TABLE payments DISABLE TRIGGER ALL"]) {
          await client.query(sql).then(() => console.log("ALLOWED (wrong!):", sql), (e) => console.log("refused as expected:", sql, "-", e.code));
        }
        await client.end();
      })().catch((e) => { console.error("connection failed:", e.code ?? "", e.message); process.exit(1); });'
    ;;
  *)
    echo "usage: $0 status|deploy|role|check|app" >&2
    exit 2
    ;;
esac
