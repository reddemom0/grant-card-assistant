-- 045: Control Centre review queue — diagnosis evidence and retries
--
-- Step 5 diagnoses each 'new' review item: it freezes the evidence (the
-- snapshot), routes the item to an owner, and has Sonnet write a short
-- narrative. These columns hold the frozen evidence and the retry state.
--
--   snapshot            the evidence the diagnosis was made from, frozen the
--                       first time the item is diagnosed: match-explain's
--                       bad_match JSON for a match item, the flagged turn and
--                       the 3 turns before it for a chat item. Retries reuse
--                       it; a reopen (flagged_again) clears it so the next
--                       diagnosis takes a fresh one.
--   snapshot_at         when the snapshot was taken
--   diagnosis_attempts  failed attempts so far; the third failure moves the
--                       item to 'diagnosed' as could_not_diagnose (owner chris)
--   last_error          the most recent failure's error code
--
-- Written only by src/control-centre/review-queue.js. See
-- docs/control-centre.md. Depends on: 044. Idempotent and safe to re-run.

ALTER TABLE cc_review_items ADD COLUMN IF NOT EXISTS snapshot JSONB;
ALTER TABLE cc_review_items ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ;
ALTER TABLE cc_review_items ADD COLUMN IF NOT EXISTS diagnosis_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cc_review_items ADD COLUMN IF NOT EXISTS last_error TEXT;

COMMENT ON COLUMN cc_review_items.snapshot IS
  'Frozen diagnosis evidence: match-explain bad_match JSON (match) or the flagged chat turn plus the 3 before it (chat). Taken once; cleared on reopen.';
COMMENT ON COLUMN cc_review_items.snapshot_at IS 'When snapshot was taken.';
COMMENT ON COLUMN cc_review_items.diagnosis_attempts IS
  'Failed diagnosis attempts. The third failure diagnoses the item as could_not_diagnose (owner chris). Reset on reopen.';
COMMENT ON COLUMN cc_review_items.last_error IS 'Error code of the most recent failed diagnosis attempt; cleared on success and on reopen.';
