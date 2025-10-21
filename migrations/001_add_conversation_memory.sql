-- Migration: Add conversation_memory table for Memory Tool
-- This table stores key-value pairs that agents can remember across messages

CREATE TABLE IF NOT EXISTS conversation_memory (
  id SERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversation_id, key)
);

-- Index for fast lookup by conversation
CREATE INDEX IF NOT EXISTS idx_conversation_memory_conversation_id
ON conversation_memory(conversation_id);

-- Index for key lookups within a conversation
CREATE INDEX IF NOT EXISTS idx_conversation_memory_conversation_key
ON conversation_memory(conversation_id, key);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_memory_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_memory_timestamp
BEFORE UPDATE ON conversation_memory
FOR EACH ROW
EXECUTE FUNCTION update_memory_timestamp();
