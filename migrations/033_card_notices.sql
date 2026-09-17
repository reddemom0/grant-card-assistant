-- Migration 033: One notice per person per day, for cards that watch dates
--
-- WHY
-- The /watch card DMs a watcher when a program opens, two weeks before the
-- deadline, two days before, and when a post says it closed. Several of those
-- can fall on one day, and a watcher may follow several programs. The rule is
-- at most one DM per program per watcher per day, so each participant row
-- records the local day it was last written to, and the sender claims that day
-- before sending (the same "first caller wins" shape as
-- tracked_cards.due_reminded_at). A counter kept inside tracked_cards.data
-- would lose writes when two watchers are notified at once.
--
-- Needs 031. Idempotent and safe to re-run.

ALTER TABLE tracked_card_participants ADD COLUMN IF NOT EXISTS notified_on DATE;

COMMENT ON COLUMN tracked_card_participants.notified_on IS
  'Local date this person was last sent a card notice (watch reminders). Claimed before sending, so a person gets at most one per card per day.';
