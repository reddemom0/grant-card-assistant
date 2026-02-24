ALTER TABLE lead_gen_conversations
  ADD COLUMN IF NOT EXISTS finalized BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalization_trigger VARCHAR(20),
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_lead_gen_inactive_sessions
  ON lead_gen_conversations (last_activity_at, finalized)
  WHERE finalized = FALSE;

UPDATE lead_gen_conversations
SET last_activity_at = updated_at
WHERE last_activity_at IS NULL;
