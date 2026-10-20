-- Migration 051: Steph's morning brief — the daily run claim and per-item state
--
-- WHY
-- src/services/steph-brief.js posts one Google Chat card each weekday at 08:00
-- (America/Vancouver) listing the inbox threads Steph hasn't answered, with a
-- saved Gmail draft and a Done button per item. Two tables:
--
-- steph_brief_runs — ONE ROW PER RUN. For real runs, (owner_email, local_date)
--   is unique: that row is the claim, so a second instance (or a second
--   deploy's scheduler) skips the day. A failed run is re-claimable after 30
--   minutes, a crashed 'building' row after 2 hours (same rule as
--   pre_call_briefings). Dry runs (is_test) insert a fresh row every time and
--   never take the claim. Stores counts and the posted message's name — no
--   subjects or bodies.
--
-- steph_brief_items — ONE ROW PER ITEM, CARRIED ACROSS DAYS. An item is one
--   sender's unanswered threads, or one document's Drive notifications
--   (item_key 'doc:<fileId>'). state: open | done (Steph pressed Done) |
--   auto_done (she replied). Holds the sender, subject and the one- or
--   two-line assessment shown on the card — the card is rebuilt from this
--   table when Done is pressed. Draft bodies are NOT stored (they live in her
--   Gmail as drafts); dry runs store them in draft_preview only, is_test rows.
--   Per item it also records what its context + draft cost (model, tokens,
--   tool calls, web searches, cost_usd); the run row carries the total and a
--   breakdown in counts.cost. Brief rows in api_cost_events carry
--   metadata.brief_run_id and metadata.is_dry_run.
--
-- Depends on: users (049/050 not required). Apply BEFORE setting
-- STEPH_BRIEF_ENABLED=true. Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS steph_brief_runs (
  id            BIGSERIAL PRIMARY KEY,
  owner_email   TEXT NOT NULL,
  local_date    DATE NOT NULL,
  is_test       BOOLEAN NOT NULL DEFAULT false,
  recipient_email TEXT,
  recipient_chat_id TEXT,
  status        TEXT NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'done', 'failed', 'skipped')),
  window_start  TIMESTAMPTZ,
  space_name    TEXT,
  message_name  TEXT,
  cost_usd      NUMERIC(10, 4),
  counts        JSONB,
  item_ids      UUID[] NOT NULL DEFAULT '{}',   -- the items this run's card showed, in order
  error_code    TEXT,
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS steph_brief_runs_claim
  ON steph_brief_runs (owner_email, local_date) WHERE NOT is_test;
CREATE INDEX IF NOT EXISTS steph_brief_runs_owner_recent
  ON steph_brief_runs (owner_email, is_test, claimed_at DESC);
CREATE INDEX IF NOT EXISTS steph_brief_runs_message
  ON steph_brief_runs (message_name);

CREATE TABLE IF NOT EXISTS steph_brief_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email     TEXT NOT NULL,
  is_test         BOOLEAN NOT NULL DEFAULT false,
  item_key        TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('client', 'partner', 'lead', 'team', 'government', 'docs')),
  thread_ids      TEXT[] NOT NULL DEFAULT '{}',
  sender          TEXT,
  subject         TEXT,
  assessment      TEXT,
  owner_hint      TEXT,
  note            TEXT,
  facts_line      TEXT,
  draft_ids       TEXT[] NOT NULL DEFAULT '{}',
  draft_preview   TEXT,
  nudge           INTEGER NOT NULL DEFAULT 0,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_inbound_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  state           TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done', 'auto_done')),
  state_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_id     BIGINT REFERENCES steph_brief_runs(id) ON DELETE SET NULL,
  position        INTEGER,
  -- Triage: Haiku judged no reply needed — on the card, no context, no draft.
  no_reply        BOOLEAN NOT NULL DEFAULT false,
  -- Cost of the item's latest context + draft work (not the shared classify
  -- call, which is on the run). Website lookup and web-search fees included.
  model           TEXT,
  cost_usd        NUMERIC(10, 4),
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cache_read_tokens  INTEGER,
  cache_write_tokens INTEGER,
  tool_calls      INTEGER,
  tools_used      TEXT[] NOT NULL DEFAULT '{}',
  web_searches    INTEGER,
  conversation_id TEXT,          -- the Oracle run's conversation (clients only)
  compare         JSONB,         -- dry runs only: the other model's draft + cost
  UNIQUE (owner_email, is_test, item_key)
);

CREATE INDEX IF NOT EXISTS steph_brief_items_run ON steph_brief_items (last_run_id, position);
CREATE INDEX IF NOT EXISTS steph_brief_items_open ON steph_brief_items (owner_email, is_test, state);

COMMENT ON TABLE steph_brief_runs IS
  'Steph morning brief: one row per run. Real runs are unique per (owner_email, local_date) — the daily claim. is_test rows are dry runs. Counts only, no mail content.';
COMMENT ON TABLE steph_brief_items IS
  'Steph morning brief items (one sender''s unanswered threads, or one document''s notifications), carried across days. state open | done | auto_done. Holds sender, subject and the card assessment; never draft bodies except draft_preview on is_test rows.';
