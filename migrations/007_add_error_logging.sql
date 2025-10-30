-- Migration: 007_add_error_logging.sql
-- Add error logging table for monitoring and debugging

CREATE TABLE error_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  agent_type VARCHAR(100),
  error_type VARCHAR(100),
  error_message TEXT,
  stack_trace TEXT,
  request_path VARCHAR(255),
  user_agent TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for efficient queries
CREATE INDEX idx_error_logs_user_id ON error_logs(user_id);
CREATE INDEX idx_error_logs_conversation_id ON error_logs(conversation_id);
CREATE INDEX idx_error_logs_agent_type ON error_logs(agent_type);
CREATE INDEX idx_error_logs_error_type ON error_logs(error_type);
CREATE INDEX idx_error_logs_created_at ON error_logs(created_at DESC);

-- Add comments
COMMENT ON TABLE error_logs IS 'System-wide error logging for monitoring and debugging';
COMMENT ON COLUMN error_logs.user_id IS 'User who encountered the error (if authenticated)';
COMMENT ON COLUMN error_logs.conversation_id IS 'Conversation where error occurred (if applicable)';
COMMENT ON COLUMN error_logs.agent_type IS 'Agent type that generated the error';
COMMENT ON COLUMN error_logs.error_type IS 'Type of error (e.g., validation, database, api, auth)';
COMMENT ON COLUMN error_logs.error_message IS 'Human-readable error message';
COMMENT ON COLUMN error_logs.stack_trace IS 'Full error stack trace for debugging';
COMMENT ON COLUMN error_logs.request_path IS 'API endpoint or route where error occurred';
