-- 038: Oracle's own copy of GG3 grant data, refreshed hourly
--
-- gg3_grants holds one row per GG3 grant as ai-api-backend search-context
-- returns it (POST /api/v1/ai/grants/search-context, every status). id is the
-- search-context id (grant_roots.id). Nested fields stay JSONB exactly as sent;
-- grant_amount, deadline and last_updated stay TEXT as sent ("2026/09/28"),
-- readers parse them. grant_amount is TEXT so an odd value never fails a run.
-- The hourly job in src/services/gg3-refresh.js replaces the whole table in one
-- transaction, and only when the pull passes its guard (non-empty, at least 80%
-- of the last successful row count).
--
-- gg3_refresh_runs records every run — success, failed (old copy kept) or
-- skipped (not configured, or a run already in flight). The latest successful
-- run's finished_at is the copy's "data as of" time. capped means the pull hit
-- search-context's 700-row limit, so grants are being cut off.
--
-- Depends on: none. Apply BEFORE setting AI_API_BACKEND_URL and
-- AI_API_BACKEND_TOKEN — until then every run fails on the missing table.

CREATE TABLE IF NOT EXISTS gg3_grants (
  id INTEGER PRIMARY KEY,
  grant_name TEXT,
  grant_type TEXT,
  program_provider TEXT,
  regions JSONB,
  industries JSONB,
  genre_scores JSONB,
  grant_criteria TEXT,
  grant_amount TEXT,
  contribution_percentage TEXT,
  deadline TEXT,
  best_practices TEXT,
  status TEXT,
  last_updated TEXT,
  boost_attributes JSONB,
  eligibility_criteria JSONB,
  field_content JSONB,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gg3_grants_status ON gg3_grants (status);

CREATE TABLE IF NOT EXISTS gg3_refresh_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  row_count INTEGER,
  previous_count INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  capped BOOLEAN NOT NULL DEFAULT false,
  error TEXT
);

CREATE INDEX IF NOT EXISTS gg3_refresh_runs_latest
  ON gg3_refresh_runs (status, finished_at DESC);
