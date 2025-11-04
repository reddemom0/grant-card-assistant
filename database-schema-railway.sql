-- Railway PostgreSQL Schema for Granted AI Hub
-- Conversation persistence with user isolation

-- Users table (Google OAuth authentication)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  role VARCHAR(50) DEFAULT 'user',        -- 'user' or 'admin'
  is_active BOOLEAN DEFAULT true,         -- Account active status
  last_login TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Conversations table (links to existing users table)
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,                    -- e.g., "conv-abc123"
    user_id INTEGER NOT NULL,               -- Links to users.id (SERIAL/INTEGER)
    agent_type TEXT NOT NULL,               -- "grant_card", "etg", "bcafe", "canexport"
    title TEXT,                             -- "Grant Card for ABC Company"
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Ensure conversations belong to real users
    CONSTRAINT fk_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
);

-- Messages table (conversation history)
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),

    -- Link to conversations, delete messages when conversation deleted
    CONSTRAINT fk_conversation FOREIGN KEY (conversation_id)
        REFERENCES conversations(id) ON DELETE CASCADE
);

-- File attachments metadata
CREATE TABLE IF NOT EXISTS file_attachments (
    id SERIAL PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT,                         -- "application/pdf", "text/plain"
    file_size INTEGER,                      -- bytes
    upload_timestamp TIMESTAMP DEFAULT NOW(),

    CONSTRAINT fk_conversation_files FOREIGN KEY (conversation_id)
        REFERENCES conversations(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_type);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_files_conversation ON file_attachments(conversation_id);

-- Comments for documentation
COMMENT ON TABLE users IS 'User accounts via Google OAuth';
COMMENT ON TABLE conversations IS 'User conversations with AI agents, isolated per user via Google OAuth';
COMMENT ON TABLE messages IS 'Individual messages within conversations (user + assistant)';
COMMENT ON TABLE file_attachments IS 'Metadata for files uploaded during conversations';
