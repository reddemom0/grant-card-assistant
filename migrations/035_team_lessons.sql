-- 035: lessons the team taught Oracle with "@Oracle /learn-this"
--
-- One row per lesson, taken from a Chat thread. Each carries its check status:
-- verified (with the source that confirms it), unverified, or conflict (with the
-- official source it contradicts). Lessons reach answers labelled as team notes,
-- through load_skill (skill-tagged) and runAgent's learning step (general), and
-- official sources always win over them. Uses are logged to learning_applications.
--
-- Only general program or process knowledge is stored — no client specifics —
-- because lessons are used in every space, DM, and the Hub.
--
-- retired_at is for the later routine that turns lessons into skill-file PRs, and
-- for lessons that are superseded. Nothing deletes rows.
--
-- Depends on: users. Safe to run at any time.

CREATE TABLE IF NOT EXISTS team_lessons (
  id              SERIAL PRIMARY KEY,
  lesson          TEXT NOT NULL,
  skill           TEXT,
  topic           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('verified', 'unverified', 'conflict')),
  source_label    TEXT,
  source_url      TEXT,
  taught_by_name  TEXT,
  taught_at       TIMESTAMPTZ,
  captured_by     INTEGER REFERENCES users(id),
  space_name      TEXT NOT NULL,
  thread_name     TEXT NOT NULL,
  thread_link     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS team_lessons_skill_active
  ON team_lessons (skill) WHERE retired_at IS NULL;
