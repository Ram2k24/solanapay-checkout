#!/usr/bin/env bash
# Verifies the local development environment. Read-only: it changes nothing.
set -u
cd "$(dirname "$0")/.."

fail=0
ok()  { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
bad() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }

echo "Tooling"
node_ver=$(node --version 2>/dev/null || true)
[[ "$node_ver" == v24.* ]] && ok "Node.js $node_ver" || bad "Node.js 24 required (found: ${node_ver:-none})"
npm_ver=$(npm --version 2>/dev/null || true)
[[ -n "$npm_ver" ]] && ok "npm $npm_ver" || bad "npm not found"
git_ver=$(git --version 2>/dev/null || true)
[[ -n "$git_ver" ]] && ok "$git_ver" || bad "git not found"
compose_ver=$(docker compose version --short 2>/dev/null || true)
[[ -n "$compose_ver" ]] && ok "Docker Compose $compose_ver" || bad "docker compose plugin not found"

echo "Repository"
[[ -d .git ]] && ok "git repository initialised" || bad "not a git repository"
[[ -f .env ]] && ok ".env present" || bad ".env missing (run: cp .env.example .env)"
git check-ignore -q .env && ok ".env is git-ignored" || bad ".env is NOT git-ignored"
if [[ -f .env ]]; then
  grep -qE '^AUTH_SECRET=.{32,}' .env && ok "AUTH_SECRET set" || bad "AUTH_SECRET empty or too short"
  grep -qE '^CRON_SECRET=.{32,}' .env && ok "CRON_SECRET set" || bad "CRON_SECRET empty or too short"
fi

echo "Database"
health=$(docker inspect -f '{{.State.Health.Status}}' solanapay-postgres 2>/dev/null || echo "not running")
[[ "$health" == healthy ]] && ok "postgres container healthy" || bad "postgres container: $health"
pg_ver=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "show server_version"' 2>/dev/null || true)
[[ -n "$pg_ver" ]] && ok "PostgreSQL $pg_ver accepting queries" || bad "cannot query PostgreSQL"

echo
if [[ $fail -eq 0 ]]; then echo "Environment ready."; else echo "Fix the FAIL items above."; exit 1; fi
