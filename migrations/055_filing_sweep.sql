-- Filing sweep (src/services/filing-sweep.js): a weekday job that suggests moves
-- and renames for files newly added to Granted Files. Suggest-only — every move
-- goes through file_move_rename (pending_actions → Confirm → drive_actions).
-- Idempotent. Apply: node migrations/run-migration.js migrations/055_filing_sweep.sql

-- One row per run. The partial unique index is the claim that stops a second
-- server copy from running the same day (as steph_brief_runs).
CREATE TABLE IF NOT EXISTS filing_sweep_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              TEXT NOT NULL DEFAULT 'sweep' CHECK (kind IN ('sweep', 'summary')),
  local_date        DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'done', 'failed')),
  page_token_before TEXT,
  page_token_after  TEXT,
  counts            JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_usd          NUMERIC(10, 6) NOT NULL DEFAULT 0,
  error_code        TEXT,
  claimed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS filing_sweep_runs_one_per_day ON filing_sweep_runs (kind, local_date);
CREATE INDEX IF NOT EXISTS filing_sweep_runs_done ON filing_sweep_runs (kind, status, completed_at DESC);

-- Every file the sweep has seen in Granted Files. The first run records all
-- current files (the baseline), so nothing that existed before is ever checked.
CREATE TABLE IF NOT EXISTS filing_sweep_known_files (
  file_id       TEXT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per new file, whatever happened to it. file_id is unique: a file is
-- checked, and suggested, once.
CREATE TABLE IF NOT EXISTS filing_sweep_suggestions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID REFERENCES filing_sweep_runs(id) ON DELETE SET NULL,
  file_id           TEXT NOT NULL UNIQUE,
  file_name         TEXT NOT NULL,
  mime_type         TEXT,
  path_before       TEXT,
  recipient_email   TEXT,
  recipient_user_id INTEGER REFERENCES users(id),
  routed_reason     TEXT CHECK (routed_reason IN ('last_modifier', 'fallback_no_person', 'fallback_unreachable')),
  rule_failures     TEXT[] NOT NULL DEFAULT '{}',
  suggested_path    TEXT,
  suggested_name    TEXT,
  model_reason      TEXT,
  status            TEXT NOT NULL CHECK (status IN
                      ('ok', 'excluded', 'unsure', 'would_suggest', 'suggested', 'listed',
                       'confirmed', 'skipped', 'ignored', 'failed')),
  pending_action_id UUID REFERENCES pending_actions(id) ON DELETE SET NULL,
  conversation_id   UUID,
  space_name        TEXT,
  thread_name       TEXT,
  message_name      TEXT,
  cost_usd          NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suggested_at      TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS filing_sweep_suggestions_status ON filing_sweep_suggestions (status, suggested_at);
CREATE INDEX IF NOT EXISTS filing_sweep_suggestions_recipient ON filing_sweep_suggestions (recipient_email, created_at DESC);
CREATE INDEX IF NOT EXISTS filing_sweep_suggestions_pending ON filing_sweep_suggestions (pending_action_id);
