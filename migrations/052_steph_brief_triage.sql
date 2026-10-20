-- Migration 052: Steph's morning brief — item types, badges, draft text for
-- learning, and the voice-corrections table
--
-- WHY (inbox-manager review, DECISIONS.md 2026-10-20)
-- The brief now surfaces kinds of item beyond "an email to answer": a promise
-- Steph made that is due, a payment/credential request to verify by phone, a
-- sensitive email to write herself, an unhappy client (acknowledgement-only
-- draft), a bill, and borderline mail it "wasn't sure" about. Each carries a
-- type and a badge for the card.
--
-- steph_brief_items:
--   item_type  mail | promise | safety | sensitive | unhappy | bill | unsure
--   badge      the card's short label ("Verify by phone first", …), or NULL
--   draft_text the draft saved in her Gmail, kept ONLY until her reply is
--              compared with it (learning from edits), then cleared; any left
--              is cleared after 14 days. Real runs only — dry runs keep
--              draft_preview as before.
--   category   widened: 'promise' (her commitments) and 'other' (unsure items,
--              which are now surfaced, never dropped).
--
-- steph_voice_corrections — short rules learned from how Steph changed a draft
--   before sending ("gives a specific day, not 'this week'"). The latest ~15
--   are added to every drafting prompt after her voice guide. rule and example
--   are capped at 200 chars and written without names or amounts.
--
-- Depends on: 051. Idempotent and safe to re-run.

ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'mail';
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS badge TEXT;
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS draft_text TEXT;
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS draft_text_at TIMESTAMPTZ;

ALTER TABLE steph_brief_items DROP CONSTRAINT IF EXISTS steph_brief_items_item_type_check;
ALTER TABLE steph_brief_items ADD CONSTRAINT steph_brief_items_item_type_check
  CHECK (item_type IN ('mail', 'promise', 'safety', 'sensitive', 'unhappy', 'bill', 'unsure'));

ALTER TABLE steph_brief_items DROP CONSTRAINT IF EXISTS steph_brief_items_category_check;
ALTER TABLE steph_brief_items ADD CONSTRAINT steph_brief_items_category_check
  CHECK (category IN ('promise', 'client', 'partner', 'lead', 'team', 'government', 'other', 'docs'));

CREATE INDEX IF NOT EXISTS steph_brief_items_draft_text
  ON steph_brief_items (draft_text_at) WHERE draft_text IS NOT NULL;

CREATE TABLE IF NOT EXISTS steph_voice_corrections (
  id                BIGSERIAL PRIMARY KEY,
  owner_email       TEXT NOT NULL,
  is_test           BOOLEAN NOT NULL DEFAULT false,
  rule              TEXT NOT NULL CHECK (char_length(rule) <= 200),
  example           TEXT CHECK (example IS NULL OR char_length(example) <= 200),
  source_thread_id  TEXT,
  item_id           UUID REFERENCES steph_brief_items(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS steph_voice_corrections_recent
  ON steph_voice_corrections (owner_email, is_test, created_at DESC);

COMMENT ON TABLE steph_voice_corrections IS
  'Steph morning brief: short drafting rules learned from how she edited a draft before sending. Latest ~15 go into every drafting prompt. No names or amounts.';
