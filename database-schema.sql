-- Database Schema for Grant Card Assistant
-- Persistent Authentication and Conversation Storage
--
-- Execute this against your Neon PostgreSQL database
-- Make sure you have a 'users' table already created from your OAuth setup

-- ============================================================================
-- CONVERSATIONS TABLE
-- Stores conversation metadata for each agent interaction
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_type VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- MESSAGES TABLE
-- Stores individual messages within conversations
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- Optimize common query patterns
-- ============================================================================

-- Index for fetching user's conversations (most common query)
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

-- Index for sorting conversations by recent activity
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- Index for fetching messages in a conversation
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Composite index for user + agent type queries
CREATE INDEX IF NOT EXISTS idx_conversations_user_agent ON conversations(user_id, agent_type);

-- ============================================================================
-- TRIGGER: Update conversation updated_at timestamp
-- Automatically update when messages are added
-- ============================================================================
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp();

-- ============================================================================
-- VERIFICATION QUERIES
-- Run these after schema creation to verify everything is set up correctly
-- ============================================================================

-- Check tables exist
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('conversations', 'messages');

-- Check indexes exist
-- SELECT indexname FROM pg_indexes WHERE tablename IN ('conversations', 'messages');

-- Check trigger exists
-- SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'messages';
