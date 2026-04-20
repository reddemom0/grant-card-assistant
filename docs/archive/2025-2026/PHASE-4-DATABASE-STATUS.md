# Phase 4 Database Schema Status

## Summary

Based on the schema files in this repository, here's the complete status of the PostgreSQL database schema for Phase 4 (User Authentication & Scoped Experience).

---

## 1. ✅ CONVERSATIONS TABLE - Has user_id

**File:** `database-schema.sql` (lines 11-18)

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_type VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Details:
- ✅ **Has user_id column**: `UUID NOT NULL`
- ✅ **Foreign key**: References `users(id)` with `ON DELETE CASCADE`
- ✅ **Indexed**: `idx_conversations_user_id` (line 38)
- ✅ **Composite index**: `idx_conversations_user_agent` for user+agent queries (line 47)

---

## 2. ❌ MESSAGES TABLE - Does NOT have user_id

**File:** `database-schema.sql` (lines 24-30)

```sql
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Details:
- ❌ **No user_id column** - Messages are scoped through `conversation_id` → `conversations.user_id`
- ✅ This is **CORRECT** - user scoping happens via the conversation relationship
- ✅ **Foreign key**: References `conversations(id)` with `ON DELETE CASCADE`
- ✅ **Indexed**: `idx_messages_conversation_id` (line 44)

**Architecture Note:** Messages don't need a direct `user_id` column because they inherit user scope through their parent conversation. All message queries should join through conversations:

```sql
-- Correct way to get user's messages
SELECT m.* FROM messages m
JOIN conversations c ON m.conversation_id = c.id
WHERE c.user_id = $1;
```

---

## 3. ⚠️ USERS TABLE - Schema Mismatch Warning

**File:** `database-setup.sql` (lines 5-13)

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,        -- ⚠️ INTEGER (SERIAL)
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  last_login TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### ⚠️ ISSUE DETECTED:
- **users.id** is `SERIAL` (INTEGER type)
- **conversations.user_id** expects `UUID`
- This will cause **foreign key constraint errors**!

### Solution Options:

#### Option A: Add UUID column to users (backward compatible)
```sql
-- From database-schema-conversations.sql lines 4-7
ALTER TABLE users ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);

-- Update conversations foreign key to reference users.uuid
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS fk_conversations_user;
ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_user
  FOREIGN KEY (user_id) REFERENCES users(uuid) ON DELETE CASCADE;
```

#### Option B: Migrate users.id to UUID (breaking change)
```sql
-- This requires data migration and will break existing foreign keys
ALTER TABLE users ALTER COLUMN id TYPE UUID USING gen_random_uuid();
```

**Recommendation:** Use Option A (add uuid column) - this is already in `database-schema-conversations.sql`

---

## 4. 📋 Complete Index List

All indexes defined in `database-schema.sql`:

```sql
-- User indexes (from database-setup.sql)
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Conversation indexes
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_user_agent ON conversations(user_id, agent_type);

-- Message indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
```

### Performance Optimization:
- ✅ User lookup by Google ID (OAuth)
- ✅ User's conversations query (most common)
- ✅ Conversation sorting by recent activity
- ✅ User's conversations filtered by agent type
- ✅ Messages in a conversation

---

## 5. 🔗 Foreign Key Relationships

```
users (id or uuid)
  ↓ (user_id)
conversations (id UUID)
  ↓ (conversation_id)
messages (id UUID)
```

**Cascade Behavior:**
- Deleting a user → deletes all their conversations → deletes all their messages
- Deleting a conversation → deletes all its messages

---

## 6. ⚡ Automatic Triggers

**File:** `database-schema.sql` (lines 53-66)

```sql
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
```

**Behavior:** Automatically updates `conversations.updated_at` whenever a new message is added, ensuring conversations are sorted by most recent activity.

---

## 🚨 CRITICAL ACTION REQUIRED

### The Schema Mismatch Must Be Fixed

**Problem:**
- `database-setup.sql` creates `users.id` as `SERIAL` (INTEGER)
- `database-schema.sql` expects `users.id` as `UUID`
- Foreign key `conversations.user_id → users.id` will **FAIL**

**Solution:**
Run the migration script: `database-migration-add-user-id.sql`

This migration:
1. Detects the ID type mismatch
2. Adds `users.uuid` column if needed
3. Updates foreign key to reference the correct column
4. Creates all indexes
5. Is **SAFE TO RUN MULTIPLE TIMES**

---

## How to Verify & Fix

### Step 1: Check Current Schema
```bash
node verify-database-schema.js
```

This will show you:
- Which tables exist
- Which columns are present
- Data types (UUID vs INTEGER)
- Foreign key constraints
- Indexes

### Step 2: Run Migration (if needed)
```bash
# Option A: Using psql
psql "$POSTGRES_URL" -f database-migration-add-user-id.sql

# Option B: Using Neon Console
# 1. Copy contents of database-migration-add-user-id.sql
# 2. Paste into Neon SQL Editor
# 3. Click Run
```

### Step 3: Verify Again
```bash
node verify-database-schema.js
```

Should show:
```
✅ Database schema is fully configured for Phase 4
✅ User authentication and user-scoped conversations are ready
```

---

## Expected Production Schema

After migration, your production schema should match:

### users table
```
id          | integer (SERIAL) | NOT NULL (existing)
uuid        | uuid             | NOT NULL (new - for foreign keys)
google_id   | varchar(255)     | NOT NULL UNIQUE
email       | varchar(255)     | NOT NULL
name        | varchar(255)     | NULL
picture     | text             | NULL
last_login  | timestamp        | DEFAULT NOW()
created_at  | timestamp        | DEFAULT NOW()
```

### conversations table
```
id          | uuid             | NOT NULL PRIMARY KEY
user_id     | uuid             | NOT NULL → users(uuid)
agent_type  | varchar(50)      | NOT NULL
title       | varchar(255)     | NULL
created_at  | timestamp        | DEFAULT NOW()
updated_at  | timestamp        | DEFAULT NOW()
```

### messages table
```
id              | uuid         | NOT NULL PRIMARY KEY
conversation_id | uuid         | NOT NULL → conversations(id)
role            | varchar(20)  | NOT NULL CHECK (user/assistant/system)
content         | text         | NOT NULL
created_at      | timestamp    | DEFAULT NOW()
```

---

## Backend Code Compatibility

The backend API (`api/server.js`) queries are already using user_id correctly:

```javascript
// Line references from previous Phase 4 backend work:
// - User scoped conversation list
// - User scoped conversation fetch
// - User scoped conversation creation

// All queries filter by user_id extracted from JWT token
```

**Status:** ✅ Backend is ready, just needs database migration

---

## Files to Reference

1. **database-setup.sql** - Original users table (SERIAL id)
2. **database-schema.sql** - Main schema with user_id (expects UUID)
3. **database-schema-conversations.sql** - Conversation schema with uuid workaround
4. **database-migration-add-user-id.sql** - ⭐ Run this to fix everything
5. **verify-database-schema.js** - Script to check current state

---

## Next Steps for Deployment

1. ✅ Frontend auth complete (all 4 agent pages + dashboard)
2. ✅ Backend user scoping complete (all API endpoints)
3. ⏳ **RUN DATABASE MIGRATION** ← You are here
4. ⏳ Test end-to-end authentication flow
5. ⏳ Test conversation isolation between users
6. ⏳ Deploy to production
