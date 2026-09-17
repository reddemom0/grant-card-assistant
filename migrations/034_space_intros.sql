-- 034: where Oracle has already introduced itself
--
-- One row per Chat space (and one per DM), claimed before the intro card is
-- posted, so a second addedToSpace event — or a second first-DM — cannot post a
-- second intro. Claiming is INSERT … ON CONFLICT DO NOTHING: the caller that
-- gets a row posts, and deletes the row again if posting failed.
--
-- Deliberately NOT chat_listen_spaces.notice_posted_at: that column is set for
-- spaces that were told about the stored copy in plain text, so a flow keyed on
-- it would never show them the card. It is also only about listened spaces,
-- while this is about every space and every DM.
--
-- Depends on: nothing. Safe to run at any time.

CREATE TABLE IF NOT EXISTS space_intros (
  space_name    TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'space' CHECK (kind IN ('space', 'dm')),
  posted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_name  TEXT
);

COMMENT ON TABLE space_intros IS
  'Spaces and DMs Oracle has introduced itself in. Claimed before posting; the row is deleted again when the post fails.';
COMMENT ON COLUMN space_intros.kind IS
  'space = a shared space''s intro card; dm = the card someone gets on their first direct message.';
COMMENT ON COLUMN space_intros.message_name IS
  'The intro card''s own message, so it can be patched rather than reposted.';
