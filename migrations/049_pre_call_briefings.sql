-- 049: Pre-call briefings built for a staff member's meetings
--
-- One row per calendar event (src/services/ruk-briefings.js). event_id is the
-- claim: a run INSERTs the row before building, and ON CONFLICT DO NOTHING
-- means a second run, a redeploy or a second server copy finds it taken and
-- skips — so a meeting is briefed once. A 'failed' row is re-claimed after 30
-- minutes, and a 'building' row left by a crash after 2 hours, in the same one
-- statement, so a broken run retries without ever building twice at once.
--
-- pre_call_briefings stores the company NAME and HubSpot id (the Doc's title
-- already carries the name) and where the DM landed (space / thread / message),
-- but no attendee address and no briefing text — the Doc holds that.
--
-- briefing_posts (second table) is one row per briefing DM actually SENT — the
-- daily run's and test sends (--dm-to, is_test) alike, which never touch the
-- claim table. A reply in that DM's thread (or a quote of it) is matched on
-- space + thread / message (src/services/briefing-posts.js) and Oracle answers
-- with the row's briefing text and gathered facts as context. So, unlike the
-- claim table, it HOLDS CLIENT CONTENT: the briefing as written and the facts
-- it was written from (contact names, HubSpot notes, calls and emails logged to
-- the deal or company, calculator answers). Same standing as pulse_posts.
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
  space_name          TEXT,          -- where the DM landed (Chat resource names), set on a done row
  thread_name         TEXT,
  message_name        TEXT,
  claimed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pre_call_briefings_owner_date
  ON pre_call_briefings (owner_email, meeting_date DESC);

COMMENT ON TABLE pre_call_briefings IS
  'Pre-call briefings, one per calendar event; event_id is the build claim. Written by src/services/ruk-briefings.js.';

CREATE TABLE IF NOT EXISTS briefing_posts (
  id                 BIGSERIAL PRIMARY KEY,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_id           TEXT NOT NULL,
  meeting_date       DATE NOT NULL,
  meeting_type       TEXT NOT NULL CHECK (meeting_type IN ('discovery', 'check_in')),
  company_name       TEXT,
  is_test            BOOLEAN NOT NULL DEFAULT false,
  recipient_email    TEXT,
  space_name         TEXT NOT NULL,
  message_name       TEXT NOT NULL,
  thread_name        TEXT,
  doc_url            TEXT,
  briefing_markdown  TEXT NOT NULL,
  facts_json         JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS briefing_posts_thread ON briefing_posts (space_name, thread_name);
CREATE INDEX IF NOT EXISTS briefing_posts_message ON briefing_posts (message_name);

COMMENT ON TABLE briefing_posts IS
  'Pre-call briefing DMs as sent (daily run and --dm-to tests), one row per DM, so a reply in its thread gets the briefing and its gathered facts as context. Holds client content. Written by src/services/briefing-posts.js.';
