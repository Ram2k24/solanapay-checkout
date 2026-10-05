-- Least-privilege database role for the running app (Phase 13.5, decisions E1-E3).
--
-- The app connects as solanapay_app: it can read and write rows, but it can't change
-- the schema, switch off the safety triggers (append-only audit log, immutable
-- payment evidence and invoice terms), TRUNCATE or DROP anything. Migrations run as
-- the owner (MIGRATE_DATABASE_URL).
--
-- Run as the database owner, once per database; safe to re-run (it resets the grants):
--   npm run db:role                                   (local Docker: dev + test databases)
--   APP_DB_PASSWORD=... psql "$MIGRATE_DATABASE_URL" -f scripts/db-app-role.sql  (hosted)
-- The password comes from the APP_DB_PASSWORD environment variable, never from this file.

\set ON_ERROR_STOP on
\getenv app_password APP_DB_PASSWORD
\if :{?app_password}
\else
  \echo 'APP_DB_PASSWORD is not set.'
  \quit 1
\endif

-- The role exists once per PostgreSQL server; create it on the first run only.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'solanapay_app') THEN
    CREATE ROLE solanapay_app;
  END IF;
END
$$;
ALTER ROLE solanapay_app WITH LOGIN PASSWORD :'app_password';
-- Server-side limit for every session of the role, also through a connection pooler
-- (PgBouncer drops the statement_timeout the app asks for when it connects).
ALTER ROLE solanapay_app SET statement_timeout = '10s';

-- A new role has none of these powers (PostgreSQL's defaults). They are checked, not set:
-- on hosted Postgres (e.g. Neon) the owner isn't a true superuser and may not even name
-- the SUPERUSER attribute in ALTER ROLE. A role escalated by hand stops the script here.
DO $$
DECLARE r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'solanapay_app';
  IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN
    RAISE EXCEPTION 'solanapay_app has a power it must not have (superuser, createdb, createrole, replication or bypassrls); remove it, then run this script again';
  END IF;
END
$$;

BEGIN;

SELECT format('GRANT CONNECT ON DATABASE %I TO solanapay_app', current_database()) \gexec

-- Start from nothing, so a re-run also removes anything granted by hand.
REVOKE ALL ON SCHEMA public FROM solanapay_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM solanapay_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM solanapay_app;

GRANT USAGE ON SCHEMA public TO solanapay_app; -- use the tables, not create new ones

-- Rows: read, add and change. Deleting is limited to the short-lived tables the
-- cleanup job empties (Phase 13.2); everything else is kept for good.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO solanapay_app;
GRANT DELETE ON auth_nonces, sessions, rate_limits TO solanapay_app;
REVOKE UPDATE ON audit_logs FROM solanapay_app;           -- append-only, also without the trigger
REVOKE ALL ON _prisma_migrations FROM solanapay_app;      -- migration history is the owner's

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO solanapay_app; -- audit_logs.id (BIGSERIAL)

-- Tables and sequences that future migrations create (as the owner running this
-- script) get the same row access automatically. DELETE stays explicit, above.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO solanapay_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO solanapay_app;

COMMIT;

\echo 'solanapay_app: grants applied to database' :DBNAME
