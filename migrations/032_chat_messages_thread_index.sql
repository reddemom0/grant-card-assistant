-- Migration 032: Read one thread from the stored Chat copy
--
-- The /track card reads a thread from the stored copy (migration 029) when its
-- space is listened. chat_space_messages was indexed by space and time only.
--
-- Needs 029. Idempotent and safe to re-run.

CREATE INDEX IF NOT EXISTS idx_chat_space_messages_thread_time
  ON chat_space_messages (thread_name, create_time);
