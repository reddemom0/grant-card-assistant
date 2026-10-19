-- 049: Pre-call briefings built for a staff member's meetings
--
-- One row per calendar event (src/services/ruk-briefings.js). event_id is the
-- claim: a run INSERTs the row before building, and ON CONFLICT DO NOTHING
-- means a second run, a redeploy or a second server copy finds it taken and
-- skips — so a meeting is briefed once. A 'failed' row is re-claimed after 30
-- minutes, and a 'building' row left by a crash after 2 hours, in the same one
-- statement, so a broken run retries without ever building twice at once.
--
-- Stores the company NAME and HubSpot id (the Doc's title already carries the
-- name) but no attendee address and no briefing text — the Doc holds that.
--
-- Depends on: none. Apply BEFORE setting RUK_BRIEFINGS_ENABLED=true — until
-- then the job logs once and skips every run. Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS pre_call_briefings (
  event_id            TEXT PRIMARY KEY,
  owner_email         TEXT NOT NULL,
  meeting_date        DATE NOT NULL,
  meeting_type        TEXT NOT NULL CHECK (meeting_type IN ('discovery', 'check_in')),
  company_name        TEXT,
  hubspot_company_id  TEXT,
  status              TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'done', 'failed')),
  doc_url             TEXT,
  match_source        TEXT,          -- 'engine' | 'search' | 'none'
  cost_usd            NUMERIC(10, 4),
  error_code          TEXT,          -- why it failed, or a delivery note on a done row (no_dm_space, dm_failed)
  claimed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pre_call_briefings_owner_date
  ON pre_call_briefings (owner_email, meeting_date DESC);

COMMENT ON TABLE pre_call_briefings IS
  'Pre-call briefings, one per calendar event; event_id is the build claim. Written by src/services/ruk-briefings.js.';
