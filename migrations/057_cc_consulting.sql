-- 057: Control Centre — Consulting owner and cards, the AI knowledge queue,
--      deadline cards
--
-- 1. Owner 'consulting' on cc_review_items. The daily chat review
--    (chat-daily.js) files a chat card (ref conv:<id>:consulting_question) when
--    a client asked for consulting or application writing and the chat didn't
--    fully answer. A consultant writes the answer on the card (staff_answer),
--    sends it to Chris (owner chris, in progress), and Chris approves it for
--    the AI, which closes the card and queues the pair below.
--
-- 2. cc_ai_knowledge: approved question + answer pairs, 'pending' until an
--    export downloads them as one markdown file (for gg3-ai-service), then
--    'exported' with the batch id. Rows are never deleted by the app.
--
-- 3. Kind 'grant_deadline': a live grant whose deadline text is a past date
--    while its status is still active. One card per grant root (unique index),
--    filed by the hourly review sweep (deadline-cards.js) with flag source
--    'catalogue_check'; the flag's source_ref carries the parsed date, so the
--    same date is never filed twice.
--
-- 044 declared the owner CHECK inline, so Postgres auto-named it; it is
-- dropped by what it says (any CHECK on cc_review_items over `owner`), not by
-- a guessed name, then re-added under a fixed name.
--
-- Written only by src/control-centre/review-queue.js (cards, answers,
-- approvals), knowledge.js (exports) and deadline-cards.js (through addFlag).
-- Hub DB only — the app and ops DBs stay read-only. See docs/control-centre.md.
-- Depends on: 044, 045, 047, 048, 049. Idempotent and safe to re-run.

-- The consultant's answer on a consulting card. Cleared on a reopen (the
-- answered event keeps the text; an approved answer lives in cc_ai_knowledge).
ALTER TABLE cc_review_items ADD COLUMN IF NOT EXISTS staff_answer    TEXT;
ALTER TABLE cc_review_items ADD COLUMN IF NOT EXISTS staff_answer_by TEXT;
ALTER TABLE cc_review_items ADD COLUMN IF NOT EXISTS staff_answer_at TIMESTAMPTZ;

COMMENT ON COLUMN cc_review_items.staff_answer IS
  'Consulting cards (chat_turn_ref conv:<id>:consulting_question): the consultant''s answer. Cleared on reopen; kept in the answered event and, once approved, in cc_ai_knowledge.';

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'cc_review_items'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ~ '\(owner (= ANY|IN) \('
  LOOP
    EXECUTE format('ALTER TABLE cc_review_items DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE cc_review_items ADD CONSTRAINT cc_review_items_owner_check
  CHECK (owner IN ('client', 'research', 'chris', 'jason', 'consulting'));

-- Deadline cards: kind, shape, one per grant root, and their flag source.
ALTER TABLE cc_review_items DROP CONSTRAINT IF EXISTS cc_review_items_kind_check;
ALTER TABLE cc_review_items ADD CONSTRAINT cc_review_items_kind_check
  CHECK (kind IN ('match', 'chat', 'grant_pattern', 'empty_track', 'grant_deadline'));

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
  OR (kind = 'grant_deadline' AND grant_root_id IS NOT NULL
     AND company_id IS NULL AND chat_turn_ref IS NULL AND pattern_category IS NULL AND goal_track IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS cc_review_items_deadline_key
  ON cc_review_items (grant_root_id) WHERE kind = 'grant_deadline';

ALTER TABLE cc_review_flags DROP CONSTRAINT IF EXISTS cc_review_flags_source_check;
ALTER TABLE cc_review_flags ADD CONSTRAINT cc_review_flags_source_check
  CHECK (source IN ('client_thumbs_down', 'staff_flag', 'ai_review_cut', 'oracle_detected', 'catalogue_check'));

-- The AI knowledge queue.
CREATE TABLE IF NOT EXISTS cc_ai_knowledge (
  id                  BIGSERIAL PRIMARY KEY,
  item_id             BIGINT REFERENCES cc_review_items (id) ON DELETE SET NULL,
  conversation_id     INTEGER,
  company_id          INTEGER,
  question            TEXT NOT NULL,          -- the client's words, from the card's snapshot
  question_rewritten  TEXT,                   -- the daily review's anonymised rewrite; the export prefers it
  ai_reply            TEXT,
  answer              TEXT NOT NULL,
  approved_by         TEXT NOT NULL,
  approved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'exported')),
  exported_at         TIMESTAMPTZ,
  export_batch        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cc_ai_knowledge_status ON cc_ai_knowledge (status, approved_at);
CREATE INDEX IF NOT EXISTS cc_ai_knowledge_batch  ON cc_ai_knowledge (export_batch);

COMMENT ON TABLE cc_ai_knowledge IS
  'Control Centre: consultant answers Chris approved for the AI — question (verbatim and rewritten), the chat''s reply, the approved answer; pending until exported as markdown. Written by src/control-centre/review-queue.js and knowledge.js.';
