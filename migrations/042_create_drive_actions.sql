-- 042: Every Drive move / rename Oracle ran, and every undo
--
-- One row per executed attempt of file_move_rename or file_move_rename_undo
-- (src/tools/drive-actions.js), successful or failed. Refusals before a
-- confirmation write nothing here. A done move_rename row carries the
-- undo_token that file_move_rename_undo takes; the undo writes its own row
-- (undoes_action_id) and sets undone_at on the original.
--
-- The same actions are appended to the "Drive migration log" sheet (Log tab,
-- Run = "Oracle"); sheet_logged / sheet_error record whether that worked.
--
-- Depends on: users (001), pending_actions (025). Until it is applied, moves
-- still run but write no row and return no undo token. Idempotent and safe to
-- re-run.

CREATE TABLE IF NOT EXISTS drive_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action            TEXT NOT NULL CHECK (action IN ('move_rename', 'undo')),
  asker_user_id     INTEGER REFERENCES users(id),
  asker_email       TEXT NOT NULL,
  confirmed_by      INTEGER REFERENCES users(id),
  pending_action_id UUID REFERENCES pending_actions(id) ON DELETE SET NULL,
  conversation_id   UUID,
  file_id           TEXT NOT NULL,
  name_before       TEXT,
  name_after        TEXT,
  parents_before    TEXT[],
  parents_after     TEXT[],
  path_before       TEXT,
  path_after        TEXT,
  owner_label       TEXT,
  folders_created   JSONB NOT NULL DEFAULT '[]'::jsonb,
  result            TEXT NOT NULL CHECK (result IN ('done', 'failed')),
  error             TEXT,
  undo_token        UUID UNIQUE,
  undoes_action_id  UUID REFERENCES drive_actions(id),
  undone_at         TIMESTAMPTZ,
  sheet_logged      BOOLEAN NOT NULL DEFAULT false,
  sheet_error       TEXT
);

CREATE INDEX IF NOT EXISTS drive_actions_file ON drive_actions (file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS drive_actions_asker ON drive_actions (asker_user_id, created_at DESC);
