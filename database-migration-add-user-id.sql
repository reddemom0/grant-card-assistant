-- ============================================================================
-- MIGRATION: Add user_id support to Grant Card Assistant
-- Date: 2025-10-07
-- Phase: 4 - User Authentication & Scoped Experience
-- ============================================================================
--
-- This migration adds user_id columns to support multi-user authentication.
-- It handles the ID type mismatch between users table (SERIAL) and
-- conversations/messages tables (UUID).
--
-- SAFE TO RUN MULTIPLE TIMES - All operations use IF NOT EXISTS / IF EXISTS
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Verify users table exists and add UUID column
-- ============================================================================

-- Add UUID column to users table if using SERIAL id
-- This allows foreign keys from conversations table
DO $$
BEGIN
    -- Check if users table uses SERIAL id (INTEGER type)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users'
        AND column_name = 'id'
        AND data_type = 'integer'
    ) THEN
        -- Add uuid column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'uuid'
        ) THEN
            ALTER TABLE users ADD COLUMN uuid UUID DEFAULT gen_random_uuid();
            RAISE NOTICE '✅ Added uuid column to users table';
        END IF;

        -- Create unique index on uuid
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE tablename = 'users' AND indexname = 'idx_users_uuid'
        ) THEN
            CREATE UNIQUE INDEX idx_users_uuid ON users(uuid);
            RAISE NOTICE '✅ Created unique index on users.uuid';
        END IF;
    ELSE
        RAISE NOTICE '✅ Users table already uses UUID for id column';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Create or update conversations table
-- ============================================================================

-- If conversations table doesn't exist, create it
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  agent_type VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add user_id column if conversations table exists without it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversations' AND column_name = 'user_id'
    ) THEN
        -- Determine which users column to reference (uuid or id)
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'uuid'
        ) THEN
            -- Reference users.uuid
            ALTER TABLE conversations ADD COLUMN user_id UUID;
            RAISE NOTICE '✅ Added user_id column to conversations (references users.uuid)';
        ELSE
            -- Reference users.id (already UUID)
            ALTER TABLE conversations ADD COLUMN user_id UUID;
            RAISE NOTICE '✅ Added user_id column to conversations (references users.id)';
        END IF;
    END IF;
END $$;

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_conversations_user'
    ) THEN
        -- Check if users table has uuid column
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'uuid'
        ) THEN
            ALTER TABLE conversations
            ADD CONSTRAINT fk_conversations_user
            FOREIGN KEY (user_id) REFERENCES users(uuid) ON DELETE CASCADE;
            RAISE NOTICE '✅ Added foreign key: conversations.user_id -> users.uuid';
        ELSE
            ALTER TABLE conversations
            ADD CONSTRAINT fk_conversations_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
            RAISE NOTICE '✅ Added foreign key: conversations.user_id -> users.id';
        END IF;
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Create or update messages table
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_messages_conversation'
    ) THEN
        ALTER TABLE messages
        ADD CONSTRAINT fk_messages_conversation
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
        RAISE NOTICE '✅ Added foreign key: messages.conversation_id -> conversations.id';
    END IF;
END $$;

-- ============================================================================
-- STEP 4: Create indexes for performance
-- ============================================================================

-- Index for fetching user's conversations (most common query)
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

-- Index for sorting conversations by recent activity
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

-- Index for fetching messages in a conversation
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Index for message ordering
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at ASC);

-- Composite index for user + agent type queries
CREATE INDEX IF NOT EXISTS idx_conversations_user_agent ON conversations(user_id, agent_type);

-- ============================================================================
-- STEP 5: Create trigger for automatic timestamp updates
-- ============================================================================

-- Create or replace function
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists, then create it
DROP TRIGGER IF EXISTS trigger_update_conversation_timestamp ON messages;
CREATE TRIGGER trigger_update_conversation_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp();

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES
-- Run these after migration to verify everything is set up correctly
-- ============================================================================

-- Check all tables exist
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('users', 'conversations', 'messages')
ORDER BY table_name;

-- Check users table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;

-- Check conversations table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'conversations'
ORDER BY ordinal_position;

-- Check messages table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'messages'
ORDER BY ordinal_position;

-- Check all indexes
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('users', 'conversations', 'messages')
ORDER BY tablename, indexname;

-- Check foreign key constraints
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_name IN ('conversations', 'messages')
ORDER BY tc.table_name;

-- Check triggers
SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE event_object_table IN ('conversations', 'messages')
ORDER BY trigger_name;

-- ============================================================================
-- EXPECTED RESULTS
-- ============================================================================
--
-- TABLES:
--   - users (with id + optional uuid column)
--   - conversations (with user_id UUID column)
--   - messages (with conversation_id UUID column)
--
-- INDEXES:
--   - idx_users_google_id, idx_users_email, idx_users_uuid (if uuid exists)
--   - idx_conversations_user_id, idx_conversations_updated_at, idx_conversations_user_agent
--   - idx_messages_conversation_id, idx_messages_created_at
--
-- FOREIGN KEYS:
--   - conversations.user_id -> users.id or users.uuid
--   - messages.conversation_id -> conversations.id
--
-- TRIGGERS:
--   - trigger_update_conversation_timestamp (on messages)
--
-- ============================================================================
