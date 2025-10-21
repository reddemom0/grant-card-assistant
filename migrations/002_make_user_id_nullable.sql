-- Migration: Make user_id nullable for anonymous conversations
-- Allows conversations without requiring authentication

-- Drop the foreign key constraint
ALTER TABLE conversations
DROP CONSTRAINT IF EXISTS conversations_user_id_fkey;

-- Make user_id nullable
ALTER TABLE conversations
ALTER COLUMN user_id DROP NOT NULL;

-- Re-add foreign key constraint (but nullable)
ALTER TABLE conversations
ADD CONSTRAINT conversations_user_id_fkey
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Add index for user_id (for performance)
CREATE INDEX IF NOT EXISTS idx_conversations_user_id_null
ON conversations(user_id) WHERE user_id IS NOT NULL;
