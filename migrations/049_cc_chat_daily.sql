-- 049: Control Centre — the daily chat grouping pass, as stored data
--
-- Once a night (08:30 America/Vancouver, after the morning roundup) one Haiku
-- pass reads the previous Vancouver day's GetGranted chats and, for every
-- client message, records: the question rewritten without identifying details,
-- its theme, whether it was a funding ask, whether the reply answered it, any
-- unmet need (something GetGranted doesn't offer), and which grant cards the
-- reply itself said don't fit. Code adds what the data already says: the cards
-- shown on that reply (chat_turns.surfaced_grant_ids), the grants the tools
-- returned and the reply named, and whether the chat searched. The Chat themes
-- tab and Oracle read these rows; the pass files two kinds of chat card from
-- them (no_cards_for_funding_ask, card_for_rejected_grant).
--
--   cc_chat_daily_runs   one row per day run: the claim (a day runs once), its
--                        status, counts, tokens and priced cost
--   cc_chat_questions    one row per client message (conversation, turn)
--
-- Only the rewritten question is stored — never the client's own words (the
-- weekly digest's rule, 046). A day's rows are replaced whole when the day is
-- run again (the backfill script). Written by src/control-centre/chat-daily.js.
-- See docs/control-centre.md, "The Chat themes tab".
-- Depends on: none. Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS cc_chat_daily_runs (
  day            DATE PRIMARY KEY,
  status         TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'empty')),
  model          TEXT,
  conversations  INTEGER NOT NULL DEFAULT 0,
  messages       INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(10, 5) NOT NULL DEFAULT 0,
  cards_filed    INTEGER NOT NULL DEFAULT 0,
  error_code     TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE cc_chat_daily_runs IS
  'One row per run of the daily chat grouping pass (day = the Vancouver day read). Inserting the row claims the day, so the nightly job runs once per day. Written by src/control-centre/chat-daily.js.';

CREATE TABLE IF NOT EXISTS cc_chat_questions (
  id                 BIGSERIAL PRIMARY KEY,
  day                DATE NOT NULL,
  conversation_id    INTEGER NOT NULL,
  turn_index         INTEGER NOT NULL,
  clerk_id           TEXT,
  company_id         INTEGER,
  occurred_at        TIMESTAMPTZ,
  question           TEXT NOT NULL,
  theme              TEXT NOT NULL,
  funding_ask        BOOLEAN NOT NULL DEFAULT FALSE,
  answer             TEXT NOT NULL CHECK (answer IN ('answered', 'partly', 'not_answered')),
  unanswered_reason  TEXT CHECK (unanswered_reason IN ('no_answer', 'asked_for_person', 'left_after_bad_reply')),
  unmet_need         TEXT,
  cards_shown        INTEGER[] NOT NULL DEFAULT '{}',
  cards_recorded     BOOLEAN NOT NULL DEFAULT FALSE,
  grants_named       INTEGER[] NOT NULL DEFAULT '{}',
  rejected_shown     INTEGER[] NOT NULL DEFAULT '{}',
  search_status      TEXT CHECK (search_status IN ('did_not_search', 'searched_found_nothing', 'searched_not_shown', 'searched_shown')),
  search_results     INTEGER,
  turn_failed        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cc_chat_questions_turn UNIQUE (conversation_id, turn_index)
);

CREATE INDEX IF NOT EXISTS cc_chat_questions_day ON cc_chat_questions (day DESC);
CREATE INDEX IF NOT EXISTS cc_chat_questions_company ON cc_chat_questions (company_id);

COMMENT ON TABLE cc_chat_questions IS
  'One row per GetGranted client message, from the daily chat grouping pass. question is rewritten without identifying details (the original is never stored). cards_recorded is false when the turn had no chat_turns row, so cards_shown is unknown. unanswered_reason is decided in code (chat-daily.js unansweredReason). Written by src/control-centre/chat-daily.js.';
