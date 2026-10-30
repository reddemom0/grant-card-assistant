-- Quoted-message context kept for the rest of a Chat thread
-- (src/services/quoted-context-store.js). When someone quotes one of Oracle's
-- messages, the quote's text and any filing-sweep files are saved against that
-- thread's conversation, so later turns in the thread still have them. One row
-- per conversation; a newer Oracle quote in the same thread replaces it.
-- The (space_name, updated_at) index serves the DM fallback: a follow-up typed
-- in the main DM box (a new thread) picks up the newest quote in that DM from
-- the last 30 minutes.
-- Idempotent. Apply before deploying the code (it skips silently until then):
--   node migrations/run-migration.js migrations/059_quoted_contexts.sql

CREATE TABLE IF NOT EXISTS quoted_contexts (
  conversation_id     UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  space_name          TEXT NOT NULL,
  quoted_message_name TEXT NOT NULL,
  context             JSONB NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS quoted_contexts_space_recent ON quoted_contexts (space_name, updated_at DESC);
