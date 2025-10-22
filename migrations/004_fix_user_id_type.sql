-- Fix user_id type mismatch in conversations table
-- Change from UUID to INTEGER to match users.id type

-- Drop the index on user_id first
DROP INDEX IF EXISTS idx_conversations_user_id;

-- Alter the column type from UUID to INTEGER
ALTER TABLE conversations
ALTER COLUMN user_id TYPE INTEGER USING NULL;

-- Recreate the index
CREATE INDEX idx_conversations_user_id ON conversations(user_id);

-- Update comment
COMMENT ON COLUMN conversations.user_id IS 'User ID (nullable for anonymous users, references users.id)';
