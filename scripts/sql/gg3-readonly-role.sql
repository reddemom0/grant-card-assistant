-- ============================================================================
-- oracle_readonly: Oracle's read-only login on the gg3-ai-service OPS DB
-- ============================================================================
--
-- RUN THIS ON THE gg3-ai-service DATABASE ONLY. Never on Oracle's own DB.
-- Runbook: docs/runbooks/gg3-readonly-access.md
--
-- Kept out of migrations/ on purpose: run-migrations-railway.js runs every
-- .sql file in that folder against Oracle's DATABASE_URL. The guard below is
-- a second line of defence: it aborts unless gg3-ai-service tables are
-- present, and the whole file is one transaction, so a wrong-database run
-- creates nothing (CREATE ROLE is cluster-wide and would otherwise stick).
--
-- Before running: replace REPLACE_WITH_GENERATED_PASSWORD below with a fresh
-- password (`openssl rand -hex 24`; hex needs no URL-escaping). The guard
-- refuses to run with the placeholder still in place.
--
-- What the role gets, and nothing else:
--   CONNECT on this database, USAGE on schema public,
--   SELECT on chat_turns, conversations, match_results, grant_events,
--             grant_feedback, events.
-- Never ai_review_log, ai_review_cache, llm_calls or any other table. No
-- ALTER DEFAULT PRIVILEGES, so tables added later stay invisible to it.
--
-- default_transaction_read_only is a DEFAULT: a session can switch it off.
-- The real wall is that no INSERT/UPDATE/DELETE grant exists. Oracle's pool
-- also forces read-only per session, and scripts/gg3-ops-db-check.mjs probes
-- both layers.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  role_password CONSTANT text := 'REPLACE_WITH_GENERATED_PASSWORD';
BEGIN
  -- Wrong-database guard: these exist only in gg3-ai-service's schema.
  IF to_regclass('public.chat_turns') IS NULL
     OR to_regclass('public.match_results') IS NULL THEN
    RAISE EXCEPTION 'Refusing: chat_turns/match_results not found. This is not the gg3-ai-service database.';
  END IF;

  IF role_password = 'REPLACE_WITH_GENERATED_PASSWORD' OR length(role_password) < 24 THEN
    RAISE EXCEPTION 'Refusing: set a generated password (24+ chars) in place of the placeholder first.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oracle_readonly') THEN
    RAISE EXCEPTION 'Refusing: oracle_readonly already exists. To change its password, use the rotate steps in the runbook.';
  END IF;

  EXECUTE format(
    'CREATE ROLE oracle_readonly LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 3',
    role_password
  );

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO oracle_readonly', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO oracle_readonly;

GRANT SELECT ON
  public.chat_turns,
  public.conversations,
  public.match_results,
  public.grant_events,
  public.grant_feedback,
  public.events
TO oracle_readonly;

ALTER ROLE oracle_readonly SET default_transaction_read_only = on;
ALTER ROLE oracle_readonly SET statement_timeout = '15s';

COMMIT;
