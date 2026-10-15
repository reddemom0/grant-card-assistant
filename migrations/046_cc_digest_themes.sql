-- 046: Control Centre — what clients asked, as stored data
--
-- The weekly Pulse digest (src/services/pulse-digest.js) already makes one
-- Haiku call per week that groups client questions into themes and rewrites
-- each question without identifying details. Until now that output lived only
-- as text (the Chat DM, the "Digest YYYY-MM-DD" sheet tab, pulse_posts.summary).
-- These two tables keep it as data, written by the same run from the same call
-- (no new model call), so the Control Centre can show "What clients asked
-- about" and the internal-accounts toggle / Chat themes tab can use it.
--
--   cc_digest_themes      one row per theme per digest week
--   cc_digest_questions   one row per rewritten question, with its theme and
--                         the client it came from (Clerk id, and companies.id
--                         when the identity lookup could resolve it)
--
-- week_start is the digest's Monday (America/Vancouver calendar date).
-- A week's rows are replaced whole when the digest writes it again.
-- source: 'digest' (written by the weekly run) or 'backfill_summary' (parsed
-- from pulse_posts.summary — names, counts, takeaways and one example
-- question per theme; no client ids).
--
-- Only rewritten (anonymised) question text is stored — never the original.
-- Written by src/control-centre/digest-themes.js. See docs/control-centre.md.
-- Depends on: none. Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS cc_digest_themes (
  id              BIGSERIAL PRIMARY KEY,
  week_start      DATE NOT NULL,
  position        INTEGER NOT NULL,
  name            TEXT NOT NULL,
  question_count  INTEGER NOT NULL,
  takeaway        TEXT,
  source          TEXT NOT NULL CHECK (source IN ('digest', 'backfill_summary')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cc_digest_themes_week_position UNIQUE (week_start, position)
);

CREATE INDEX IF NOT EXISTS cc_digest_themes_week ON cc_digest_themes (week_start DESC);

COMMENT ON TABLE cc_digest_themes IS
  'Weekly Pulse digest themes as data: one row per theme per digest week (week_start = Monday, Vancouver). question_count is the number of questions the digest placed in the theme. Written by src/control-centre/digest-themes.js from the digest''s existing model call.';

CREATE TABLE IF NOT EXISTS cc_digest_questions (
  id              BIGSERIAL PRIMARY KEY,
  week_start      DATE NOT NULL,
  theme_position  INTEGER NOT NULL,
  question        TEXT NOT NULL,
  question_order  INTEGER NOT NULL,
  clerk_id        TEXT,
  company_id      INTEGER,
  source          TEXT NOT NULL CHECK (source IN ('digest', 'backfill_summary')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cc_digest_questions_week_order UNIQUE (week_start, question_order)
);

CREATE INDEX IF NOT EXISTS cc_digest_questions_week ON cc_digest_questions (week_start DESC, question_order DESC);

COMMENT ON TABLE cc_digest_questions IS
  'Weekly Pulse digest client questions, each rewritten without identifying details by the digest''s model call (original text is never stored). question_order is the exchange''s place in the week, oldest first. clerk_id / company_id say who asked; null on backfilled rows. Written by src/control-centre/digest-themes.js.';
