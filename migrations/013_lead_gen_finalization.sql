-- Migration 013: Add finalization tracking for lead-gen conversations
-- Enables two-trigger HubSpot sync: immediate (Phase 5) or delayed (inactivity timeout)

-- Add finalization tracking columns
ALTER TABLE lead_gen_conversations
  ADD COLUMN IF NOT EXISTS finalized BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finalization_trigger VARCHAR(20), -- 'contact_captured' or 'inactivity_timeout'
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();

-- Create index for finding inactive sessions to finalize
CREATE INDEX IF NOT EXISTS idx_lead_gen_inactive_sessions
  ON lead_gen_conversations (last_activity_at, finalized)
  WHERE finalized = FALSE;

-- Update existing sessions to set last_activity_at from updated_at
UPDATE lead_gen_conversations
SET last_activity_at = updated_at
WHERE last_activity_at IS NULL;

COMMENT ON COLUMN lead_gen_conversations.finalized IS 'Whether this session has been synced to HubSpot';
COMMENT ON COLUMN lead_gen_conversations.finalized_at IS 'When the session was finalized';
COMMENT ON COLUMN lead_gen_conversations.finalization_trigger IS 'What triggered finalization: contact_captured or inactivity_timeout';
COMMENT ON COLUMN lead_gen_conversations.last_activity_at IS 'Last message timestamp, used for inactivity detection';
