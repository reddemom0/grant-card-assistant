-- Migration 029: A stored copy of messages in listened Chat spaces
--
-- WHY
-- Oracle could only read a space's history through the person asking. Stage 3
-- needs its own current copy of the spaces it has been asked to follow. The
-- copy is kept by src/chat-listen/: a Workspace Events subscription per space
-- (authorized by the listener account named in CHAT_LISTENER_USER_EMAIL),
-- pushed through Pub/Sub to POST /api/chat/events, plus a one-time 12-month
-- backfill. Only spaces in data/chat/listen-spaces.json are ever followed.
--
-- THREE TABLES
-- chat_listen_spaces       one row per followed space: status, subscription,
--                          backfill progress, whether members were told.
-- chat_space_messages      the copy. Text is UNTRUSTED data — it must reach a
--                          model only through the tool-output labelling.
--                          No attachment content, ever.
-- chat_message_tombstones  names of deleted messages, no text. A slow fetch or
--                          a retried "created" event must not bring a deleted
--                          message back. Pub/Sub retries for at most 7 days, so
--                          tombstones are pruned after 30.
--
-- PAUSED IS NOT REMOVED
-- status 'paused' (with a pause_reason code) means the listener lost access or
-- its token stopped working. The stored copy is kept. Only 'removed' — the
-- Oracle app was removed from the space, or the space left the allowlist —
-- deletes the copy.
--
-- RETENTION
-- A daily job deletes messages whose create_time is older than 12 months.
--
-- Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS chat_listen_spaces (
  space_name               TEXT PRIMARY KEY,
  label                    TEXT,
  status                   TEXT NOT NULL DEFAULT 'paused'
                             CHECK (status IN ('active', 'paused', 'removed')),
  pause_reason             TEXT,
  paused_at                TIMESTAMPTZ,
  subscription_name        TEXT,
  subscription_expire_time TIMESTAMPTZ,
  subscription_state       TEXT,
  backfill_state           TEXT NOT NULL DEFAULT 'pending'
                             CHECK (backfill_state IN ('pending', 'running', 'done', 'failed')),
  backfill_since           TIMESTAMPTZ NOT NULL,
  backfill_page_token      TEXT,
  notice_posted_at         TIMESTAMPTZ,
  enabled_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE chat_listen_spaces IS
  'Chat spaces Oracle keeps a stored copy of. Allowlist: data/chat/listen-spaces.json. Managed by src/chat-listen/.';
COMMENT ON COLUMN chat_listen_spaces.status IS
  'active: subscribed and storing. paused: listener cannot read (copy kept). removed: copy deleted.';
COMMENT ON COLUMN chat_listen_spaces.pause_reason IS
  'Fixed code only, e.g. listener_not_member, listener_token_revoked, notice_failed.';
COMMENT ON COLUMN chat_listen_spaces.backfill_since IS
  'Start of the one-time backfill window, fixed when the space is enabled (12 months back).';
COMMENT ON COLUMN chat_listen_spaces.backfill_page_token IS
  'Next spaces.messages.list page, saved with each stored page so an interrupted backfill resumes.';
COMMENT ON COLUMN chat_listen_spaces.notice_posted_at IS
  'When members were told the space is being copied. Listening does not start until this is set.';

CREATE TABLE IF NOT EXISTS chat_space_messages (
  message_name   TEXT PRIMARY KEY,
  space_name     TEXT NOT NULL REFERENCES chat_listen_spaces(space_name) ON DELETE CASCADE,
  thread_name    TEXT,
  sender_user_id TEXT,
  create_time    TIMESTAMPTZ NOT NULL,
  update_time    TIMESTAMPTZ NOT NULL,
  text           TEXT,
  stored_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE chat_space_messages IS
  'Stored copy of Chat messages in listened spaces. text is UNTRUSTED: pass to a model only via tool-output labelling. Deleted after 12 months.';
COMMENT ON COLUMN chat_space_messages.sender_user_id IS
  'Chat resource name of the sender (users/NNN). Never an email.';
COMMENT ON COLUMN chat_space_messages.update_time IS
  'Message lastUpdateTime (createTime if never edited). An update is applied only if it is not older than this.';

CREATE INDEX IF NOT EXISTS idx_chat_space_messages_space_time
  ON chat_space_messages (space_name, create_time);
CREATE INDEX IF NOT EXISTS idx_chat_space_messages_create_time
  ON chat_space_messages (create_time);

CREATE TABLE IF NOT EXISTS chat_message_tombstones (
  message_name TEXT PRIMARY KEY,
  space_name   TEXT NOT NULL REFERENCES chat_listen_spaces(space_name) ON DELETE CASCADE,
  deleted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE chat_message_tombstones IS
  'Names (no text) of deleted Chat messages, so a late event cannot restore them. Pruned after 30 days.';

CREATE INDEX IF NOT EXISTS idx_chat_message_tombstones_space
  ON chat_message_tombstones (space_name);
CREATE INDEX IF NOT EXISTS idx_chat_message_tombstones_deleted_at
  ON chat_message_tombstones (deleted_at);
