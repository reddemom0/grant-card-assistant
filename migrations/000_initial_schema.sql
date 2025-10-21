-- Initial Schema for Direct Claude API
-- Creates tables for conversations, messages, and memory

-- Drop existing tables if they exist (clean slate)
DROP TABLE IF EXISTS conversation_memory CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL,  -- Nullable for anonymous users, no FK constraint
  agent_type VARCHAR(100) NOT NULL,
  title VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversation memory table (for memory tool)
CREATE TABLE conversation_memory (
  id SERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(conversation_id, key)
);

-- Indexes for performance
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_created_at ON conversations(created_at);
CREATE INDEX idx_conversation_memory_conversation_id ON conversation_memory(conversation_id);
CREATE INDEX idx_conversation_memory_conversation_key ON conversation_memory(conversation_id, key);

-- Trigger to update conversations.updated_at
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_timestamp
BEFORE UPDATE ON conversations
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp();

-- Trigger to update conversation_memory.updated_at
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

-- Add comments
COMMENT ON TABLE conversations IS 'Stores conversation metadata';
COMMENT ON TABLE messages IS 'Stores conversation messages';
COMMENT ON TABLE conversation_memory IS 'Stores key-value pairs for agent memory tool';
COMMENT ON COLUMN conversations.user_id IS 'User UUID (nullable for anonymous users, no foreign key constraint)';
