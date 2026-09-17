-- Migration 030: Tracked cards — work items Oracle keeps current in Google Chat
--
-- WHY
-- A request like "can you two review these Docs?" used to be a single reply
-- that scrolled away. A tracked card is one Chat message per work item that
-- Oracle keeps up to date in place: who is doing what, what the real systems
-- say (open Doc comments, a HubSpot note waiting for confirmation), and when it
-- was last touched. The review card is the first type; src/cards/ holds the
-- shared foundation.
--
-- WHAT LIVES WHERE
-- tracked_cards              one row per work item. data holds the card type's
--                            own fields. Outcomes are written to the real system
--                            (e.g. a HubSpot note), never to a new sheet.
-- tracked_card_participants  the requester and each assignee, with their own
--                            status and whether they muted the card.
-- tracked_card_clicks        every button press: who, what, when.
-- chat_people                what Oracle knows about a Chat user: Hub account,
--                            email, calendar time zone, DM space.
-- tracked_card_digests       one row per person per local day, so the 08:00
--                            digest is sent at most once.
--
-- LIFECYCLE
-- offered / awaiting_docs  Oracle asked a question and is waiting (no card yet,
--                          or a small "track this?" card).
-- open                     live; refreshed on each click and once a day.
--                          completed_at is set when the work is done: the
--                          owner's digest shows it once (completion_shown_on),
--                          and the card closes 7 days later at the latest.
-- stale                    idle 30 days; the owner's digest asks Close / Keep.
-- closed                   frozen — no buttons, no refresh. Rows are kept so
--                          closed cards stay queryable.
--
-- Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS tracked_cards (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_type            TEXT NOT NULL,
  status               TEXT NOT NULL
                         CHECK (status IN ('offered', 'awaiting_docs', 'open', 'stale', 'closed')),
  space_name           TEXT NOT NULL,
  thread_name          TEXT NOT NULL,
  message_name         TEXT UNIQUE,
  source_message_name  TEXT,
  conversation_id      UUID REFERENCES conversations(id) ON DELETE SET NULL,
  owner_chat_id        TEXT NOT NULL,
  owner_user_id        INTEGER REFERENCES users(id),
  title                TEXT,
  data                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stale_since          TIMESTAMPTZ,
  closed_at            TIMESTAMPTZ,
  closed_reason        TEXT,
  last_refreshed_at    TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  completion_shown_on  DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE tracked_cards IS
  'Oracle tracked cards in Google Chat: one message per work item, updated in place. Managed by src/cards/.';
COMMENT ON COLUMN tracked_cards.conversation_id IS
  'The thread''s Oracle conversation (uuid v5 of the thread). Confirmation-gated actions for the card are stored under it.';
COMMENT ON COLUMN tracked_cards.data IS
  'Card-type fields (review: client, program, docs with open comment counts, pre-check, missing info, HubSpot state). Never raw message text.';

COMMENT ON COLUMN tracked_cards.completed_at IS
  'When the work item was done (review: every reviewer marked done). The card closes 7 days later at the latest.';
COMMENT ON COLUMN tracked_cards.completion_shown_on IS
  'Owner''s local date of the digest that showed the completion. Later digests leave the card out.';

-- One live card of a type per thread. A closed card does not block a new one.
CREATE UNIQUE INDEX IF NOT EXISTS tracked_cards_one_live_per_thread
  ON tracked_cards (card_type, thread_name)
  WHERE status <> 'closed';

CREATE INDEX IF NOT EXISTS idx_tracked_cards_status
  ON tracked_cards (status, last_activity_at);

CREATE TABLE IF NOT EXISTS tracked_card_participants (
  card_id              UUID NOT NULL REFERENCES tracked_cards(id) ON DELETE CASCADE,
  chat_user_id         TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('owner', 'reviewer')),
  display_name         TEXT,
  status               TEXT CHECK (status IN ('not_started', 'reviewing', 'done')),
  status_changed_at    TIMESTAMPTZ,
  muted                BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_notified_at TIMESTAMPTZ,
  PRIMARY KEY (card_id, chat_user_id)
);

COMMENT ON COLUMN tracked_card_participants.status IS
  'Per-person status, changed only by that person''s own button. NULL for the owner.';

CREATE INDEX IF NOT EXISTS idx_tracked_card_participants_user
  ON tracked_card_participants (chat_user_id);

CREATE TABLE IF NOT EXISTS tracked_card_clicks (
  id            BIGSERIAL PRIMARY KEY,
  card_id       UUID NOT NULL REFERENCES tracked_cards(id) ON DELETE CASCADE,
  actor_chat_id TEXT NOT NULL,
  actor_name    TEXT,
  action        TEXT NOT NULL,
  result        TEXT NOT NULL DEFAULT 'changed',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN tracked_card_clicks.result IS
  'changed | unchanged | why the press was ignored (not_a_reviewer, closed, ...). Every press is logged; the card''s "Last update" line shows only the latest changed one, and never a mute.';

CREATE INDEX IF NOT EXISTS idx_tracked_card_clicks_card
  ON tracked_card_clicks (card_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_people (
  chat_user_id          TEXT PRIMARY KEY,
  user_id               INTEGER REFERENCES users(id),
  email                 TEXT,
  display_name          TEXT,
  time_zone             TEXT,
  time_zone_checked_at  TIMESTAMPTZ,
  dm_space_name         TEXT,
  dm_checked_at         TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE chat_people IS
  'Chat users Oracle has seen: Hub account, email, calendar time zone (from Calendar, else DEFAULT_TIMEZONE), DM space for notifications.';

CREATE TABLE IF NOT EXISTS tracked_card_digests (
  chat_user_id  TEXT NOT NULL,
  local_date    DATE NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_name  TEXT,
  PRIMARY KEY (chat_user_id, local_date)
);
