-- Migration 031: The /track card ("who has the ball") on the tracked-card tables
--
-- WHY
-- The review card was the first tracked card. /track is the second: for any ask
-- in a thread it shows who holds the ball now (one ball), or who has done their
-- part (everyone has a ball). src/cards/track-card.js.
--
-- WHAT CHANGES
-- tracked_card_participants  role 'member' — holders, past holders, the person
--                            chasing a client, and everyone asked in the
--                            "everyone" shape. Statuses 'pending' and
--                            'needs_help' for the everyone checklist. The
--                            current one-ball holder lives in tracked_cards.data.
-- tracked_cards              due_at (parsed from the ask), and the two markers
--                            that make the due-date reminder and the requester's
--                            due-date summary go out once.
--
-- RETENTION
-- Closed cards of every type are deleted 12 months after closing, like the
-- stored Chat copy (src/cards/lifecycle.js, daily pass). Until then they stay
-- queryable; recorded decisions are what recall finds.
--
-- Needs 030. Idempotent and safe to re-run.

ALTER TABLE tracked_card_participants DROP CONSTRAINT IF EXISTS tracked_card_participants_role_check;
ALTER TABLE tracked_card_participants ADD CONSTRAINT tracked_card_participants_role_check
  CHECK (role IN ('owner', 'reviewer', 'member'));

ALTER TABLE tracked_card_participants DROP CONSTRAINT IF EXISTS tracked_card_participants_status_check;
ALTER TABLE tracked_card_participants ADD CONSTRAINT tracked_card_participants_status_check
  CHECK (status IN ('not_started', 'reviewing', 'done', 'pending', 'needs_help'));

COMMENT ON COLUMN tracked_card_participants.status IS
  'Per-person status, changed only by that person''s own button. Review: not_started/reviewing/done. Track (everyone shape): pending/done/needs_help. NULL for the owner and for one-ball members.';

ALTER TABLE tracked_cards ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
ALTER TABLE tracked_cards ADD COLUMN IF NOT EXISTS due_reminded_at TIMESTAMPTZ;
ALTER TABLE tracked_cards ADD COLUMN IF NOT EXISTS due_summary_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN tracked_cards.due_at IS
  'When the ask is due, parsed from its wording in the requester''s time zone. NULL when the ask names no date.';
COMMENT ON COLUMN tracked_cards.due_reminded_at IS
  'Set when the one-ball holder was sent the due-today DM. Claimed before sending, so it goes out once.';
COMMENT ON COLUMN tracked_cards.due_summary_sent_at IS
  'Set when the requester was sent the everyone-shape due-date summary. Claimed before sending, so it goes out once.';

COMMENT ON COLUMN tracked_cards.data IS
  'Card-type fields. Review: client, program, docs with open comment counts, pre-check, missing info, HubSpot state. Track: the ask''s message name, shape, ball (holder, state, source message), suggestion, and text people typed into the card (a recorded decision, feedback responses). Never copied thread messages; the title is the ask''s first line, cut to 100 characters.';

CREATE INDEX IF NOT EXISTS idx_tracked_cards_due
  ON tracked_cards (due_at)
  WHERE due_at IS NOT NULL AND status IN ('open', 'stale');

CREATE INDEX IF NOT EXISTS idx_tracked_cards_space_type
  ON tracked_cards (space_name, card_type);
