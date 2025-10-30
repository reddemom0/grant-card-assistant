-- Migration: 006_add_usage_tracking.sql
-- Add conversation statistics tracking for analytics and cost monitoring

CREATE TABLE conversation_stats (
  id SERIAL PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  tokens_used INTEGER DEFAULT 0,
  tool_calls_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversation_id)
);

-- Create indexes for efficient queries
CREATE INDEX idx_conversation_stats_conversation_id ON conversation_stats(conversation_id);
CREATE INDEX idx_conversation_stats_created_at ON conversation_stats(created_at);
CREATE INDEX idx_conversation_stats_tokens_used ON conversation_stats(tokens_used);

-- Trigger to update conversation_stats.updated_at
CREATE OR REPLACE FUNCTION update_conversation_stats_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_stats_timestamp
BEFORE UPDATE ON conversation_stats
FOR EACH ROW
EXECUTE FUNCTION update_conversation_stats_timestamp();

-- Add comments
COMMENT ON TABLE conversation_stats IS 'Tracks usage statistics per conversation for analytics and cost monitoring';
COMMENT ON COLUMN conversation_stats.tokens_used IS 'Total Claude API tokens consumed in this conversation';
COMMENT ON COLUMN conversation_stats.tool_calls_count IS 'Number of tool calls made during conversation';
COMMENT ON COLUMN conversation_stats.error_count IS 'Number of errors encountered in conversation';
