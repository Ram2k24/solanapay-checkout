#!/usr/bin/env bash
# Creates the local test database (if it doesn't exist) and applies all migrations
# to it. Safe to run repeatedly. Usage: npm run db:test:setup
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env; set +a
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is not set in .env (see .env.example)}"

db_name=$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$TEST_DATABASE_URL")
if [[ ! "$db_name" =~ ^[a-z0-9_]+_test$ ]]; then
  echo "Refusing: the test database name must end in _test (got '$db_name')." >&2
  exit 1
fi

# CREATE DATABASE has no IF NOT EXISTS in PostgreSQL; \gexec runs it only when missing.
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' <<SQL
SELECT 'CREATE DATABASE $db_name' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db_name')\gexec
SQL
echo "Test database '$db_name' is present."

DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
