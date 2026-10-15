-- 048: Control Centre — Companies tab: transcript view log + empty-track cards
--
-- 1. cc_transcript_views. The Companies tab shows a client's GetGranted chats.
--    Opening one shows the whole conversation, verbatim, so every opening is
--    logged: who (the signed-in staff member's email), which conversation (ops
--    DB conversations.id), which company page it was opened from, and when.
--    The page shows "Viewed by …" on each chat from these rows. Rows are never
--    updated or deleted by the app.
--
-- 2. Review cards of kind 'empty_track': a goal track that showed a client
--    nothing in their latest recorded match run, flagged by staff from the
--    company page ("Flag empty track"). One card per (company, goal track),
--    keyed on the new goal_track column (the ops match_results.section name).
--    The card's snapshot is built server-side when it is filed: the goal, how
--    many grants the run considered, where they were removed, and the profile
--    gaps.
--
-- Written only by src/control-centre/companies.js (views, empty-track flags
-- through review-queue.js addFlag). Hub DB only — the app and ops DBs stay
-- read-only. See docs/control-centre.md. Depends on: 044, 045, 047.
-- Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS cc_transcript_views (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  INTEGER NOT NULL,
  company_id       INTEGER,
  viewer           TEXT NOT NULL,
  viewed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cc_transcript_views_conversation
  ON cc_transcript_views (conversation_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS cc_transcript_views_company
  ON cc_transcript_views (company_id, viewed_at DESC);

COMMENT ON TABLE cc_transcript_views IS
  'Control Centre: one row per opening of a client chat transcript on the Companies tab — viewer email, ops conversation id, company, time. Written by src/control-centre/companies.js.';

ALTER TABLE cc_review_items ADD COLUMN IF NOT EXISTS goal_track TEXT;

ALTER TABLE cc_review_items DROP CONSTRAINT IF EXISTS cc_review_items_kind_check;
ALTER TABLE cc_review_items ADD CONSTRAINT cc_review_items_kind_check
  CHECK (kind IN ('match', 'chat', 'grant_pattern', 'empty_track'));

ALTER TABLE cc_review_items DROP CONSTRAINT IF EXISTS cc_review_items_kind_shape;
ALTER TABLE cc_review_items ADD CONSTRAINT cc_review_items_kind_shape CHECK (
  (kind = 'match' AND company_id IS NOT NULL AND grant_root_id IS NOT NULL AND chat_turn_ref IS NULL
     AND pattern_category IS NULL AND goal_track IS NULL)
  OR (kind = 'chat' AND chat_turn_ref IS NOT NULL AND grant_root_id IS NULL AND pattern_category IS NULL
     AND goal_track IS NULL)
  OR (kind = 'grant_pattern' AND grant_root_id IS NOT NULL AND pattern_category IS NOT NULL
     AND company_id IS NULL AND chat_turn_ref IS NULL AND goal_track IS NULL)
  OR (kind = 'empty_track' AND company_id IS NOT NULL AND goal_track IS NOT NULL
     AND grant_root_id IS NULL AND chat_turn_ref IS NULL AND pattern_category IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS cc_review_items_empty_track_key
  ON cc_review_items (company_id, goal_track) WHERE kind = 'empty_track';

COMMENT ON COLUMN cc_review_items.goal_track IS
  'empty_track cards only: the goal track (ops match_results.section) that showed the company nothing.';
