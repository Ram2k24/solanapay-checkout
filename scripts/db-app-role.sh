#!/usr/bin/env bash
# Creates or updates the app's least-privilege role (scripts/db-app-role.sql) in the
# local Docker databases: development (POSTGRES_DB) and test (from TEST_DATABASE_URL).
# Safe to run repeatedly. Usage: npm run db:role
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env; set +a
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is not set in .env (see .env.example)}"
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is not set in .env (see .env.example)}"
test_db=$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$TEST_DATABASE_URL")

for db in "$POSTGRES_DB" "$test_db"; do
  # The password reaches psql as an environment variable (-e), never as an argument.
  docker compose exec -T -e APP_DB_PASSWORD postgres \
    sh -c 'psql -U "$POSTGRES_USER" -d "$1" -q' sh "$db" < scripts/db-app-role.sql
done
