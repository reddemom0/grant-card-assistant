-- 037: /learn-this lessons wait for the teacher's confirmation
--
-- A /learn-this run now saves lessons as 'pending' on a lesson card
-- (src/cards/lesson-card.js). Nothing pending is used in answers. The teacher
-- presses Save (or edits, which re-checks the text and saves) to make a lesson
-- 'active'; Discard deletes it. Pending lessons expire after 24 hours: the
-- hourly tracked-cards job deletes them and updates the card silently.
--
-- status (verified / unverified / conflict) stays the check result; state is
-- whether the lesson is live. Rows saved before this migration are active.
--
-- from_document names the attached document a new fact came from; such a lesson
-- is labelled "from [document], not yet in Granted's notes".
--
-- Depends on: 035, 036, 030 (tracked_cards). Apply BEFORE deploying the code
-- that reads state — until then team notes are unavailable and /learn-this
-- cannot save.

ALTER TABLE team_lessons
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('pending', 'active')),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS card_id UUID REFERENCES tracked_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS from_document TEXT;

CREATE INDEX IF NOT EXISTS team_lessons_pending_expiry
  ON team_lessons (expires_at) WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS team_lessons_card
  ON team_lessons (card_id) WHERE card_id IS NOT NULL;
