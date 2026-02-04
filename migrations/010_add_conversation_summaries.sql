-- Migration: Add conversation_summaries table for auto-compaction
-- Date: 2026-02-04
-- Purpose: Store summaries of old conversation history to prevent token explosion

-- Create conversation_summaries table
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id SERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(conversation_id)
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_conversation_id
  ON conversation_summaries(conversation_id);

-- Add comment explaining the table
COMMENT ON TABLE conversation_summaries IS 'Stores summarized conversation history for auto-compaction. When conversations exceed 50K tokens, old messages are summarized and stored here, allowing recent messages to be kept while reducing context size.';

COMMENT ON COLUMN conversation_summaries.summary IS 'Condensed summary of old conversation messages (typically 2-3K tokens)';
COMMENT ON COLUMN conversation_summaries.metadata IS 'Compaction metadata: original_tokens, summary_tokens, saved_tokens, timestamp';
