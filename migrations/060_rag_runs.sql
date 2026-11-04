-- Granted Files RAG — nightly updater (phase 3)
--
-- drive_files gains the status 'removed': the file was trashed or deleted in
-- Drive. Its chunks are deleted and its row stays, because deleting the row
-- would null duplicate_of on its copies and make them look like canonicals.
--
-- rag_runs is the updater's run record and its own position in the Granted
-- Files change feed (page_token_after), separate from the filing sweep's.
-- One row per America/Vancouver day, claimed like filing_sweep_runs.
--
-- Idempotent. Apply via railway ssh (the database has no public proxy).

ALTER TABLE drive_files DROP CONSTRAINT IF EXISTS drive_files_status_check;
ALTER TABLE drive_files ADD CONSTRAINT drive_files_status_check
  CHECK (status IN ('indexed', 'scanned', 'skipped', 'excluded', 'failed', 'removed'));

CREATE TABLE IF NOT EXISTS rag_runs (
  id                BIGSERIAL PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('baseline', 'nightly')),
  local_date        DATE NOT NULL,                       -- America/Vancouver
  status            TEXT NOT NULL DEFAULT 'building'
                      CHECK (status IN ('building', 'done', 'stopped', 'failed')),
  page_token_before TEXT,                                -- where this run read from
  page_token_after  TEXT,                                -- set only when done: the next run's start
  counts            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- files by action and by status
  tokens            BIGINT NOT NULL DEFAULT 0,
  cost_usd          NUMERIC(10,4) NOT NULL DEFAULT 0,
  errors            INTEGER NOT NULL DEFAULT 0,
  error_code        TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS rag_runs_one_per_day ON rag_runs (local_date);
CREATE INDEX IF NOT EXISTS rag_runs_recent ON rag_runs (started_at DESC);
