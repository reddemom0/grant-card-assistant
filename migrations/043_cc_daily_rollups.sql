-- 043: Control Centre daily roll-ups (matches, views, ratings)
--
-- The gg3-ai-service ops DB keeps match_results for 180 days, so Control
-- Centre ranges longer than that need their own history. A nightly job
-- (src/control-centre/rollup.js, CC_ROLLUP_ENABLED=true) reads the ops DB and
-- the GetGranted app DB read-only and upserts one row per key per day here.
--
-- day is the calendar date in America/Vancouver. Re-runs upsert on the unique
-- key and never delete, so re-running a day that has aged out of the source
-- leaves the stored history alone. company_id can be null (no company on the
-- source row); NULLS NOT DISTINCT keeps that a single key per day.
--
-- No personal data: ids and counts only. Test-harness traffic (non-Clerk
-- user ids) is excluded before aggregation; GetGranted staff are kept (blended
-- with clients during beta). See docs/control-centre.md.
--
-- Depends on: none (Postgres 15+ for NULLS NOT DISTINCT). Idempotent and safe
-- to re-run.

CREATE TABLE IF NOT EXISTS cc_daily_matches (
  id                BIGSERIAL PRIMARY KEY,
  day               DATE NOT NULL,
  company_id        INTEGER,
  grant_id          INTEGER NOT NULL,
  section           TEXT NOT NULL,
  times_computed    INTEGER NOT NULL DEFAULT 0,
  times_shown       INTEGER NOT NULL DEFAULT 0,
  best_position     INTEGER,
  best_score        NUMERIC,
  eligibility       TEXT,
  ai_review_action  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cc_daily_matches_key UNIQUE NULLS NOT DISTINCT (day, company_id, grant_id, section)
);

CREATE INDEX IF NOT EXISTS cc_daily_matches_company_day ON cc_daily_matches (company_id, day);
CREATE INDEX IF NOT EXISTS cc_daily_matches_grant_day ON cc_daily_matches (grant_id, day);

COMMENT ON TABLE cc_daily_matches IS
  'Control Centre: per Vancouver day, company, grant root and section, how often the engine computed and showed the grant (distinct result sets), best 0-based position when shown, best match_score, latest eligibility and latest AI review action. From ops match_results + ai_review_log by src/control-centre/rollup.js.';

CREATE TABLE IF NOT EXISTS cc_daily_views (
  id                      BIGSERIAL PRIMARY KEY,
  day                     DATE NOT NULL,
  company_id              INTEGER,
  grant_root_id           INTEGER NOT NULL,
  source                  TEXT,
  sessions                INTEGER NOT NULL DEFAULT 0,
  visible_seconds_capped  NUMERIC NOT NULL DEFAULT 0,
  median_visible_seconds  NUMERIC,
  users                   INTEGER NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cc_daily_views_key UNIQUE NULLS NOT DISTINCT (day, company_id, grant_root_id, source)
);

CREATE INDEX IF NOT EXISTS cc_daily_views_company_day ON cc_daily_views (company_id, day);
CREATE INDEX IF NOT EXISTS cc_daily_views_grant_day ON cc_daily_views (grant_root_id, day);

COMMENT ON TABLE cc_daily_views IS
  'Control Centre: per Vancouver day, company, grant root and view source, grant-detail view sessions, total visible seconds with each session capped at 600s, median capped seconds, distinct users. From app grant_view_sessions by src/control-centre/rollup.js.';

CREATE TABLE IF NOT EXISTS cc_daily_ratings (
  id             BIGSERIAL PRIMARY KEY,
  day            DATE NOT NULL,
  company_id     INTEGER,
  grant_root_id  INTEGER NOT NULL,
  ups            INTEGER NOT NULL DEFAULT 0,
  downs          INTEGER NOT NULL DEFAULT 0,
  changed        INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cc_daily_ratings_key UNIQUE NULLS NOT DISTINCT (day, company_id, grant_root_id)
);

CREATE INDEX IF NOT EXISTS cc_daily_ratings_company_day ON cc_daily_ratings (company_id, day);
CREATE INDEX IF NOT EXISTS cc_daily_ratings_grant_day ON cc_daily_ratings (grant_root_id, day);

COMMENT ON TABLE cc_daily_ratings IS
  'Control Centre: per Vancouver day, company and grant root, recommendation rating events: ups, downs, and changed (events that flipped an earlier rating). Events, not net state. From app grant_recommendation_feedback_events by src/control-centre/rollup.js.';
