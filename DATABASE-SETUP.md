# Database Setup Guide

This guide explains how to set up the PostgreSQL database schema for persistent authentication and conversation storage.

## Prerequisites

- Access to your Neon PostgreSQL database
- Database connection string (from `POSTGRES_URL` environment variable)
- Existing `users` table from OAuth setup

## Setup Steps

### Option 1: Using Neon Console (Recommended)

1. Log in to your Neon dashboard at https://console.neon.tech
2. Select your project
3. Navigate to the SQL Editor tab
4. Copy the contents of `database-schema.sql`
5. Paste into the SQL Editor
6. Click "Run" to execute

### Option 2: Using psql Command Line

```bash
# Connect to your database
psql "YOUR_POSTGRES_URL"

# Execute the schema file
\i database-schema.sql

# Verify tables were created
\dt

# Verify indexes
\di

# Exit
\q
```

### Option 3: Using Node.js Script

```javascript
// setup-database.js
const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function setupDatabase() {
  const schema = fs.readFileSync('./database-schema.sql', 'utf8');

  try {
    await pool.query(schema);
    console.log('✅ Database schema created successfully');

    // Verify
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('conversations', 'messages')
    `);
    console.log('Tables created:', tables.rows);

  } catch (error) {
    console.error('❌ Error creating schema:', error);
  } finally {
    await pool.end();
  }
}

setupDatabase();
```

Run with: `node setup-database.js`

## Verification

After running the schema, verify everything is set up correctly:

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('conversations', 'messages');

-- Check columns in conversations table
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'conversations';

-- Check columns in messages table
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'messages';

-- Check indexes
SELECT indexname, tablename FROM pg_indexes
WHERE tablename IN ('conversations', 'messages');

-- Check trigger exists
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table = 'messages';
```

Expected output:
- **Tables**: `conversations`, `messages`
- **Indexes**: `idx_conversations_user_id`, `idx_conversations_updated_at`, `idx_messages_conversation_id`, `idx_conversations_user_agent`
- **Trigger**: `trigger_update_conversation_timestamp`

## Schema Details

### Conversations Table
- `id` - UUID primary key (auto-generated)
- `user_id` - UUID foreign key to users table
- `agent_type` - VARCHAR(50) for agent identifier
- `title` - VARCHAR(255) optional conversation title
- `created_at` - Timestamp (auto-set)
- `updated_at` - Timestamp (auto-updated by trigger)

### Messages Table
- `id` - UUID primary key (auto-generated)
- `conversation_id` - UUID foreign key to conversations
- `role` - VARCHAR(20) with CHECK constraint ('user', 'assistant', 'system')
- `content` - TEXT for message content
- `created_at` - Timestamp (auto-set)

### Automatic Timestamp Updates
A trigger automatically updates `conversations.updated_at` whenever a new message is inserted, ensuring conversations are sorted by most recent activity.

## Troubleshooting

### Error: relation "users" does not exist
**Cause**: The `conversations` table references a `users` table that doesn't exist yet.

**Solution**: Create the users table first:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Error: permission denied
**Cause**: Your database user doesn't have sufficient privileges.

**Solution**: Make sure you're using the database owner credentials from your Neon connection string.

### Indexes not created
**Cause**: The `IF NOT EXISTS` clause may silently skip if there's a naming conflict.

**Solution**: Drop existing indexes with similar names first:
```sql
DROP INDEX IF EXISTS idx_conversations_user_id CASCADE;
-- Then re-run schema
```

## Next Steps

After successfully creating the schema:

1. ✅ Verify tables and indexes exist
2. 📝 Create API endpoints (`/api/verify-auth.js`, `/api/conversations.js`, `/api/messages.js`)
3. 🔧 Update `/api/chat` to use database instead of in-memory storage
4. 🎨 Create frontend auth module (`/public/auth.js`)
5. 🖥️ Update agent pages with conversation sidebar

## Development vs Production

**IMPORTANT**: Set up separate databases for development and production:

- **Development**: Use a separate Neon branch or database
- **Production**: Use your production Neon database

Update your `.env` files accordingly:
```bash
# .env.development
POSTGRES_URL=postgresql://user:pass@dev-host/db

# .env.production
POSTGRES_URL=postgresql://user:pass@prod-host/db
```

Run schema on **development database first**, test thoroughly, then apply to production.
