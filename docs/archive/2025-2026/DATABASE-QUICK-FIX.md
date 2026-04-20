# Phase 4 Database Quick Fix

## 🚨 CRITICAL ISSUE DETECTED

**Problem:** Schema mismatch between `users` table and `conversations` table

- `users.id` = `SERIAL` (INTEGER)
- `conversations.user_id` = `UUID`
- Foreign key will **FAIL** ❌

## ✅ QUICK FIX (5 minutes)

### Step 1: Run Verification Script
```bash
node verify-database-schema.js
```

**Expected output if schema is broken:**
```
⚠️  WARNING: users.id is INTEGER (SERIAL) - should migrate to UUID
❌ users.uuid column MISSING - run migration
⚠️  Database schema needs migration
```

### Step 2: Run Migration

**Option A: Using psql command line**
```bash
psql "$POSTGRES_URL" -f database-migration-add-user-id.sql
```

**Option B: Using Neon Console (Recommended)**
1. Go to https://console.neon.tech
2. Select your project
3. Click "SQL Editor" tab
4. Copy ALL contents of `database-migration-add-user-id.sql`
5. Paste into editor
6. Click **Run**
7. Wait for "COMMIT" success message

### Step 3: Verify Fix
```bash
node verify-database-schema.js
```

**Expected output after fix:**
```
✅ Database schema is fully configured for Phase 4
✅ User authentication and user-scoped conversations are ready
```

---

## What the Migration Does

1. ✅ Adds `users.uuid` column (keeps existing `id` intact)
2. ✅ Creates unique index on `users.uuid`
3. ✅ Updates foreign key: `conversations.user_id` → `users.uuid`
4. ✅ Creates all required indexes
5. ✅ Sets up automatic timestamp trigger

**Safe Features:**
- ✅ Idempotent (safe to run multiple times)
- ✅ Uses `IF NOT EXISTS` / `IF EXISTS` checks
- ✅ Non-destructive (doesn't drop existing data)
- ✅ Transaction wrapped (all or nothing)

---

## Current Schema Files

| File | Purpose | Status |
|------|---------|--------|
| `database-setup.sql` | Original users table (SERIAL id) | ⚠️ Outdated |
| `database-schema.sql` | Main schema (expects UUID) | ✅ Correct |
| `database-schema-conversations.sql` | Alt schema with uuid workaround | ⚠️ Partial |
| **`database-migration-add-user-id.sql`** | **⭐ Run this one** | **✅ Complete** |

---

## Verification Checklist

After running migration, verify these exist:

### ✅ Tables
- [x] `users` (with `id` and `uuid` columns)
- [x] `conversations` (with `user_id` UUID column)
- [x] `messages` (with `conversation_id` UUID column)

### ✅ Foreign Keys
- [x] `conversations.user_id` → `users.uuid` ON DELETE CASCADE
- [x] `messages.conversation_id` → `conversations.id` ON DELETE CASCADE

### ✅ Indexes
- [x] `idx_users_google_id` (OAuth lookup)
- [x] `idx_users_uuid` (conversation joins)
- [x] `idx_conversations_user_id` (user's conversations)
- [x] `idx_conversations_updated_at` (sort by recent)
- [x] `idx_conversations_user_agent` (user + agent filter)
- [x] `idx_messages_conversation_id` (conversation messages)

### ✅ Triggers
- [x] `trigger_update_conversation_timestamp` (auto-update conversation.updated_at)

---

## Common Issues

### Issue: "relation users does not exist"
**Cause:** No users table created yet

**Fix:**
```bash
psql "$POSTGRES_URL" -f database-setup.sql
psql "$POSTGRES_URL" -f database-migration-add-user-id.sql
```

### Issue: "column user_id does not exist in conversations"
**Cause:** Old conversations table without user_id

**Fix:** Run the migration - it will add the column
```bash
psql "$POSTGRES_URL" -f database-migration-add-user-id.sql
```

### Issue: "permission denied"
**Cause:** Database user lacks privileges

**Fix:** Use the owner connection string from Neon (not pooler URL)

### Issue: Foreign key constraint violation
**Cause:** Existing conversations without user_id values

**Fix:** Migration handles this - adds column as nullable first if needed

---

## After Migration: Test Queries

### Test 1: Create a user
```sql
INSERT INTO users (google_id, email, name, picture)
VALUES ('test-google-id', 'test@example.com', 'Test User', NULL)
RETURNING id, uuid;
```

### Test 2: Create a conversation for that user
```sql
INSERT INTO conversations (id, user_id, agent_type, title)
VALUES (
  gen_random_uuid(),
  'USER_UUID_FROM_TEST_1',
  'grant-cards',
  'Test Conversation'
)
RETURNING *;
```

### Test 3: Add a message
```sql
INSERT INTO messages (conversation_id, role, content)
VALUES (
  'CONVERSATION_ID_FROM_TEST_2',
  'user',
  'Test message'
)
RETURNING *;
```

### Test 4: Query user's conversations
```sql
SELECT c.id, c.title, c.agent_type, c.created_at, c.updated_at,
       COUNT(m.id) as message_count
FROM conversations c
LEFT JOIN messages m ON m.conversation_id = c.id
WHERE c.user_id = 'USER_UUID_FROM_TEST_1'
GROUP BY c.id
ORDER BY c.updated_at DESC;
```

All 4 tests should succeed without errors.

---

## Environment Variables Required

Make sure these are set in Vercel:

```bash
# Database
POSTGRES_URL=postgresql://user:pass@host/db

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret

# JWT
JWT_SECRET=your-random-secret-string

# Claude AI
ANTHROPIC_API_KEY=sk-ant-...

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

---

## Next Steps After Database Fix

1. ✅ Run migration
2. ✅ Verify schema with script
3. 🧪 Test authentication flow:
   - Login with Google
   - Create conversation
   - Add messages
   - View conversation history
   - Logout and login as different user
4. 🧪 Verify conversation isolation (users can't see each other's conversations)
5. 🚀 Deploy to production

---

## Support

If migration fails:
1. Check the error message
2. Run verification script to see current state
3. Check Neon logs in console
4. Contact database admin if permissions issue

**Migration is safe to retry** - it uses transaction wrapping and IF EXISTS checks.
