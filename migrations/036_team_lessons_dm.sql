-- 036: /learn-this in direct messages
--
-- A lesson taught in a DM with Oracle has no thread anyone else can open, so it
-- is stored without a thread name or link and labelled "taught by [name] in a
-- DM". taught_in records where a lesson came from; every row saved before this
-- migration was taught in a space.
--
-- Depends on: 035_team_lessons.sql. Safe to run at any time; run it before
-- deploying the code that saves DM lessons.

ALTER TABLE team_lessons ALTER COLUMN thread_name DROP NOT NULL;
ALTER TABLE team_lessons ALTER COLUMN thread_link DROP NOT NULL;

ALTER TABLE team_lessons
  ADD COLUMN IF NOT EXISTS taught_in TEXT NOT NULL DEFAULT 'space'
  CHECK (taught_in IN ('space', 'dm'));
