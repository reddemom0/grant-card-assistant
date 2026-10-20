-- Migration 054: Steph's morning brief — card fixes from dry run 2
--
-- WHY (DECISIONS.md 2026-10-20, card fixes)
--   item_type gains 'security' (a Google Workspace "suspicious login"-style
--     alert: one line, no draft, suggest IT/admin — never "Verify by phone
--     first", which is for payment-detail changes, payment/wire asks and
--     credential requests) and 'cc' (Steph is only cc'd and the email asks
--     someone else to act: one line, no draft, suggest that person).
--   summary        the one-line summary (≤15 words), written by the model to
--                  length rather than a truncated assessment
--   draft_summary  what the saved draft does, in ≤15 words, written by the
--                  drafting call itself ("Draft says")
--
-- Depends on: 053. Idempotent and safe to re-run.

ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE steph_brief_items ADD COLUMN IF NOT EXISTS draft_summary TEXT;

ALTER TABLE steph_brief_items DROP CONSTRAINT IF EXISTS steph_brief_items_item_type_check;
ALTER TABLE steph_brief_items ADD CONSTRAINT steph_brief_items_item_type_check
  CHECK (item_type IN ('mail', 'promise', 'safety', 'security', 'sensitive', 'unhappy', 'bill', 'cc', 'unsure'));
