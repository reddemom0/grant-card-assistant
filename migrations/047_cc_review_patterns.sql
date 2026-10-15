-- 047: Control Centre review queue — grant-pattern cards, chat cards from
-- Oracle's detector, and links between cards
--
-- Two new card sources:
--
--   grant_pattern   the AI Final Review (ops ai_review_log) cut the same grant
--                   for the same reason for 3 or more companies in 7 days. One
--                   card per (grant root, review category). Each cut is a flag
--                   (source ai_review_cut, source_ref ai_review:<id>).
--   oracle_detected Oracle's morning chat review found a conversation that went
--                   badly or a chat turn that failed. One chat card per issue
--                   per conversation: chat_turn_ref conv:<conversation>:<issue>.
--
-- New columns on cc_review_items:
--   pattern_category  the AI review category a grant_pattern card is about
--                     (wrong_industry, wrong_region, ineligible, …)
--   conversation_id   the ops DB conversation a chat card is about, when known
--
-- cc_review_links joins related cards: a grant_pattern card to every match
-- card for the same grant. Closing the pattern card adds a "recheck" event to
-- each linked card; it never moves or closes them.
--
-- Written only by src/control-centre/review-queue.js and grant-patterns.js.
-- See docs/control-centre.md. Depends on: 044, 045. Idempotent and safe to re-run.

ALTER TABLE cc_review_items ADD COLUMN IF NOT EXISTS pattern_category TEXT;
ALTER TABLE cc_review_items ADD COLUMN IF NOT EXISTS conversation_id INTEGER;

ALTER TABLE cc_review_items DROP CONSTRAINT IF EXISTS cc_review_items_kind_check;
ALTER TABLE cc_review_items ADD CONSTRAINT cc_review_items_kind_check
  CHECK (kind IN ('match', 'chat', 'grant_pattern'));

ALTER TABLE cc_review_items DROP CONSTRAINT IF EXISTS cc_review_items_kind_shape;
ALTER TABLE cc_review_items ADD CONSTRAINT cc_review_items_kind_shape CHECK (
  (kind = 'match' AND company_id IS NOT NULL AND grant_root_id IS NOT NULL AND chat_turn_ref IS NULL
     AND pattern_category IS NULL)
  OR (kind = 'chat' AND chat_turn_ref IS NOT NULL AND grant_root_id IS NULL AND pattern_category IS NULL)
  OR (kind = 'grant_pattern' AND grant_root_id IS NOT NULL AND pattern_category IS NOT NULL
     AND company_id IS NULL AND chat_turn_ref IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS cc_review_items_pattern_key
  ON cc_review_items (grant_root_id, pattern_category) WHERE kind = 'grant_pattern';
CREATE INDEX IF NOT EXISTS cc_review_items_match_grant
  ON cc_review_items (grant_root_id) WHERE kind = 'match';

COMMENT ON COLUMN cc_review_items.pattern_category IS
  'grant_pattern cards only: the AI Final Review category (wrong_industry, wrong_region, ineligible, …).';
COMMENT ON COLUMN cc_review_items.conversation_id IS
  'Chat cards: the ops DB conversations.id the card is about, when known.';

ALTER TABLE cc_review_flags DROP CONSTRAINT IF EXISTS cc_review_flags_source_check;
ALTER TABLE cc_review_flags ADD CONSTRAINT cc_review_flags_source_check
  CHECK (source IN ('client_thumbs_down', 'staff_flag', 'ai_review_cut', 'oracle_detected'));

COMMENT ON TABLE cc_review_flags IS
  'Control Centre review queue: each flag on an item. source_ref: the app rating id (client_thumbs_down), staff:<uuid> (staff_flag), ai_review:<ai_review_log id> (ai_review_cut), oracle:<conversation>:<issue>:<date> (oracle_detected); UNIQUE so a re-sweep never double-counts. actor is a Clerk id, staff email or system:<job>.';

CREATE TABLE IF NOT EXISTS cc_review_links (
  id              BIGSERIAL PRIMARY KEY,
  item_id         BIGINT NOT NULL REFERENCES cc_review_items (id) ON DELETE CASCADE,
  linked_item_id  BIGINT NOT NULL REFERENCES cc_review_items (id) ON DELETE CASCADE,
  relation        TEXT NOT NULL DEFAULT 'same_grant',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cc_review_links_pair UNIQUE (item_id, linked_item_id),
  CONSTRAINT cc_review_links_not_self CHECK (item_id <> linked_item_id)
);

CREATE INDEX IF NOT EXISTS cc_review_links_linked ON cc_review_links (linked_item_id);

COMMENT ON TABLE cc_review_links IS
  'Control Centre review queue: related cards. item_id is the grant_pattern card, linked_item_id a match card for the same grant (relation same_grant). Closing the pattern card logs a recheck event on each linked card.';
