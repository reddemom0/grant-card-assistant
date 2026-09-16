-- Migration 028: Remember each user's Google Chat user id
--
-- WHY
-- A Chat @mention is an annotation carrying the mentioned person's CANONICAL id
-- (`users/123456789`). The Chat API accepts an email as an alias in requests but,
-- in its own words, "only the canonical resource name will be returned from the
-- API" — so a mention cannot be matched against a user's email. Reading the id
-- from membership listings would need chat.memberships.readonly, a scope we
-- deliberately did not ask for.
--
-- What we do have: every inbound Chat event carries message.sender.name, which
-- IS that canonical id for the person who sent it. So the id is recorded the
-- first time someone talks to Oracle in Chat, and reused afterwards.
--
-- NULL MEANS "NOT SEEN IN CHAT YET"
-- In a DM the id comes from the request itself, so the digest works on the first
-- try. From the Hub it needs this column; when it is NULL the tool says "message
-- me once in Google Chat" rather than guessing by display name, which would risk
-- attributing one person's mentions to another.
--
-- Idempotent and safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_user_id TEXT;

COMMENT ON COLUMN users.chat_user_id IS
  'Google Chat canonical user resource name (users/NNN), learned from message.sender.name on an inbound Chat event. NULL = this person has not messaged Oracle in Chat yet. Used to match @mention annotations, which never carry an email.';

CREATE INDEX IF NOT EXISTS idx_users_chat_user_id
  ON users(chat_user_id)
  WHERE chat_user_id IS NOT NULL;
