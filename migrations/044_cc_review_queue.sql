-- 044: Control Centre review queue (bad matches, bad chat answers)
--
-- One item per thing that needs a look: a (company, grant root) match, or a
-- single chat turn. Flags pile onto the item: client 👎s pulled hourly from
-- the app DB's grant_recommendation_feedback_events, and staff flags from
-- /api/control-centre/review/flag. Every change to an item is logged in
-- cc_review_events.
--
-- Written only by src/control-centre/review-queue.js. The app DB and ops DB
-- stay read-only; this lives in the Hub DB.
--
--   cc_review_items   one row per (match, company, grant root) or (chat turn)
--   cc_review_flags   each flag; source_ref UNIQUE makes re-sweeps idempotent
--   cc_review_events  audit log: who changed what, from which status to which
--
-- source_created_at on a flag is the source event's own time (the rating's
-- created_at). The hourly sweep uses it as its cursor; created_at is only
-- the insert time. Null for staff flags.
--
-- See docs/control-centre.md. Depends on: none. Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS cc_review_items (
  id              BIGSERIAL PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('match', 'chat')),
  company_id      INTEGER,
  grant_root_id   INTEGER,
  chat_turn_ref   TEXT,
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'diagnosed', 'in_progress', 'closed')),
  owner           TEXT CHECK (owner IN ('client', 'research', 'chris', 'jason')),
  diagnosis       JSONB,
  narrative       TEXT,
  client_notice   TEXT,
  flagged_again   BOOLEAN NOT NULL DEFAULT FALSE,
  flag_count      INTEGER NOT NULL DEFAULT 0,
  expected_match  TEXT CHECK (expected_match IN ('should', 'shouldnt')),
  close_note      TEXT,
  closed_by       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  CONSTRAINT cc_review_items_kind_shape CHECK (
    (kind = 'match' AND company_id IS NOT NULL AND grant_root_id IS NOT NULL AND chat_turn_ref IS NULL)
    OR (kind = 'chat' AND chat_turn_ref IS NOT NULL AND grant_root_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS cc_review_items_match_key
  ON cc_review_items (company_id, grant_root_id) WHERE kind = 'match';
CREATE UNIQUE INDEX IF NOT EXISTS cc_review_items_chat_key
  ON cc_review_items (chat_turn_ref) WHERE kind = 'chat';
CREATE INDEX IF NOT EXISTS cc_review_items_status_updated
  ON cc_review_items (status, updated_at DESC);

COMMENT ON TABLE cc_review_items IS
  'Control Centre review queue: one row per flagged match (company, grant root) or chat turn. status new → diagnosed → in_progress → closed; a new flag on a closed item reopens it with flagged_again. Written by src/control-centre/review-queue.js.';

CREATE TABLE IF NOT EXISTS cc_review_flags (
  id                 BIGSERIAL PRIMARY KEY,
  item_id            BIGINT NOT NULL REFERENCES cc_review_items (id) ON DELETE CASCADE,
  source             TEXT NOT NULL CHECK (source IN ('client_thumbs_down', 'staff_flag')),
  source_ref         TEXT NOT NULL UNIQUE,
  source_created_at  TIMESTAMPTZ,
  actor              TEXT,
  comment            TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cc_review_flags_item ON cc_review_flags (item_id, created_at);
CREATE INDEX IF NOT EXISTS cc_review_flags_source_created
  ON cc_review_flags (source, source_created_at);

COMMENT ON TABLE cc_review_flags IS
  'Control Centre review queue: each flag on an item. source_ref is the app rating id for client_thumbs_down, staff:<uuid> for staff_flag; UNIQUE so a re-sweep never double-counts. actor is a Clerk id or staff email.';

CREATE TABLE IF NOT EXISTS cc_review_events (
  id           BIGSERIAL PRIMARY KEY,
  item_id      BIGINT NOT NULL REFERENCES cc_review_items (id) ON DELETE CASCADE,
  actor        TEXT,
  action       TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT,
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cc_review_events_item ON cc_review_events (item_id, created_at);

COMMENT ON TABLE cc_review_events IS
  'Control Centre review queue audit log: one row per change to an item (created, flagged, reopened, diagnosed, status, owner, closed).';
