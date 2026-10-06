-- 041: Every Pulse post Oracle delivered, per recipient
--
-- One row per delivered message: the weekly digest (src/services/pulse-digest.js,
-- including --send-to test sends and --live runs), the morning roundup
-- (pulse-roundup.js) and the spike alert (pulse-spike.js). When someone replies
-- in that post's thread, or quotes it, Oracle reads the row so it answers about
-- the post and its period (src/services/pulse-posts.js, src/api/chat-google.js).
--
-- summary is the text the recipient was shown — no more. The digest shows only
-- anonymised questions and Oracle's own words; the roundup's client labels are
-- the ones already in that DM. Dry runs write nothing.
--
-- Depends on: none. Until it is applied, delivery logs one warning and carries
-- on, and replies get no post context. Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS pulse_posts (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind            TEXT NOT NULL CHECK (kind IN ('digest', 'roundup', 'spike')),
  is_test         BOOLEAN NOT NULL DEFAULT false,
  recipient_email TEXT,
  space_name      TEXT NOT NULL,
  message_name    TEXT NOT NULL,
  thread_name     TEXT,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  summary         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS pulse_posts_thread ON pulse_posts (space_name, thread_name);
CREATE INDEX IF NOT EXISTS pulse_posts_message ON pulse_posts (message_name);

COMMENT ON TABLE pulse_posts IS
  'GetGranted Pulse posts as delivered, one row per recipient message, so a reply in the post''s thread gets the post and its period as context. Written by pulse-digest.js, pulse-roundup.js and pulse-spike.js via pulse-posts.js.';
