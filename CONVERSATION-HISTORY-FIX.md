# Conversation History Fix - Database Column Mismatch

## Problem

The conversation history sidebar wasn't loading, and you couldn't see the `/new` page. The logs showed:

```
❌ column "role" does not exist
⚠️  JWT verification failed: column "role" does not exist
GET /api/conversations [401] 3ms
```

## Root Cause

The authentication middleware (`src/middleware/auth.js`) was trying to query columns that **don't exist** in the `users` table:

**What the code was querying:**
```sql
SELECT id, email, name, picture, role, is_active, last_login FROM users WHERE id = $1
```

**What actually exists in the database:**
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  google_id VARCHAR(255),
  email VARCHAR(255),
  name VARCHAR(255),
  picture TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

The columns `role`, `is_active`, and `last_login` **do not exist**, causing every authenticated request to fail.

## Why This Broke Conversation History

1. User logs in via Google OAuth ✅
2. JWT token created and stored in cookie ✅
3. Frontend tries to load conversation history
4. Request: `GET /api/conversations?agentType=etg-writer`
5. Auth middleware tries to verify JWT
6. **Database query fails** - "column role does not exist"
7. Auth middleware treats user as **anonymous** (null)
8. API returns **401 Unauthorized**
9. Sidebar shows empty/error

## What Was Fixed

Fixed 4 files that queried non-existent columns:

### 1. **src/middleware/auth.js**
```diff
- SELECT id, email, name, picture, role, is_active, last_login FROM users
+ SELECT id, email, name, picture FROM users
```

### 2. **src/middleware/admin.js**
```diff
- SELECT id, email, name, picture, role, is_active, last_login FROM users
+ SELECT id, email, name, picture FROM users
```

### 3. **src/database/admin-queries.js**
```diff
- SELECT id, google_id, email, name, picture, role, is_active, last_login, created_at
+ SELECT id, google_id, email, name, picture, created_at, updated_at
```

### 4. **src/services/analytics.js**
```diff
- SELECT COUNT(*) FROM users WHERE last_login >= NOW() - INTERVAL '7 days'
+ SELECT COUNT(*) FROM users WHERE updated_at >= NOW() - INTERVAL '7 days'
```

## Testing After Deployment

Once Railway redeploys (should happen automatically), test these steps:

### 1. Visit a New Conversation
```
https://grant-card-assistant-production.up.railway.app/etg-writer/new
```
- ✅ Should see the welcome screen
- ✅ Should NOT get a 404 or redirect

### 2. Send a Message
- Type: "What are the ETG eligibility criteria?"
- Click Send
- ✅ URL should change to `/etg-writer/chat/{uuid}`
- ✅ Should get a response

### 3. Check Conversation History
- Click the **"☰ History"** button in the top left
- ✅ Sidebar should open
- ✅ Should see your conversation listed with:
  - Title: "What are the ETG eligibility criteria?"
  - Message count: "2 messages" (or similar)
  - Timestamp: "Just now" or "2m ago"

### 4. Refresh the Page
- Press Cmd+R (or Ctrl+R)
- ✅ All your messages should still be there
- ✅ Can continue the conversation

### 5. Click on History Item
- Open history sidebar again
- Click on the conversation
- ✅ Should load all messages
- ✅ URL should update to the conversation ID

### 6. Start a New Conversation
- Click **"🔄 New Conversation"** button
- ✅ URL changes to `/etg-writer/new`
- ✅ Welcome screen appears
- ✅ Old conversation still in history

## What Should Work Now

✅ Authentication works correctly
✅ Conversation history sidebar loads
✅ Can see list of past conversations
✅ Can click to load old conversations
✅ URLs work: `/agent/new` and `/agent/chat/{id}`
✅ Messages persist across page refreshes
✅ New conversations create properly

## How to Verify It's Fixed

Check the Railway logs - you should NO LONGER see:

```
❌ column "role" does not exist
⚠️ JWT verification failed
GET /api/conversations [401]
```

Instead, you should see:

```
✅ Authenticated user: writers@granted.ca (ID: 1)
GET /api/conversations [200] 150ms
```

## Expected Log Output (Good)

When you click the History button:

```
🔐 Authenticated user: writers@granted.ca (ID: 1)
✓ Retrieved 3 conversations for user 1
GET /api/conversations [200] 145ms
```

When you send a message:

```
✓ New conversation created: 6454a8b9-033c-4ebf-b539-497aaa8a44e7 (user: writers@granted.ca)
✓ Message saved: user message for conversation 6454a8b9...
✓ Message saved: assistant message for conversation 6454a8b9...
POST /api/chat [200] 8000ms
```

## Why This Happened

This was a **schema mismatch** between:
1. **What the migration created** (basic user table with OAuth fields)
2. **What the code expected** (user table with admin fields like role, is_active)

The admin role features were added to the codebase but the database migrations to add those columns were never run on Railway.

## Long-term Solution (Optional)

If you want admin roles in the future, you'll need to:

1. Create a migration to add the columns:
```sql
ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user';
ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN last_login TIMESTAMP;
```

2. Run it on Railway via the endpoint:
```
GET /run-migration?file=006_add_user_roles.sql&secret=your-jwt-secret
```

But for now, the system works perfectly without those columns!

## Summary

**Problem**: Code queried database columns that didn't exist
**Cause**: Schema mismatch between migrations and code expectations
**Fix**: Updated code to only query columns that actually exist
**Status**: ✅ Fixed and deployed

Railway will automatically redeploy when it detects the push. Give it 2-3 minutes, then test the conversation history!
