# Database Migration Summary

## Overview
Successfully created `api/server-with-db.js` - a PostgreSQL-backed version of `api/server.js` that replaces Redis conversation storage with persistent database storage.

## Key Changes

### 1. PostgreSQL Connection Pool Added
**Location:** Line ~12
```javascript
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
```

### 2. JWT User ID Extraction Function
**Location:** Line ~148
```javascript
function getUserIdFromJWT(req) {
  const cookies = req.headers.cookie || '';
  const tokenMatch = cookies.match(/granted_session=([^;]+)/);
  if (!tokenMatch) return null;

  try {
    const token = tokenMatch[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.id || decoded.sub || decoded.userId || null;
  } catch (error) {
    console.error('JWT decode error:', error.message);
    return null;
  }
}
```

### 3. Database-Backed Conversation Functions

#### getConversation (Line ~556)
**OLD:** `async function getConversation(conversationId)`
**NEW:** `async function getConversation(conversationId, userId)`

**Behavior:**
- Loads conversation from PostgreSQL `conversations` and `messages` tables
- Verifies user ownership before returning data
- Returns empty array if conversation doesn't exist or user doesn't have access

#### saveConversation (Line ~593)
**OLD:** `async function saveConversation(conversationId, conversation)`
**NEW:** `async function saveConversation(conversationId, userId, conversation, agentType)`

**Behavior:**
- Creates conversation record in `conversations` table if it doesn't exist
- Saves only new messages to `messages` table (incremental saves)
- Requires `agentType` parameter to categorize conversations

#### deleteConversation (Line ~650)
**OLD:** `async function deleteConversation(conversationId)`
**NEW:** `async function deleteConversation(conversationId, userId)`

**Behavior:**
- Deletes from PostgreSQL with user ownership verification
- Cascade deletes all associated messages automatically

### 4. Modified Endpoints

All endpoints now extract userId from JWT and require authentication:

#### Streaming Handler (Line ~3241)
- **Endpoint:** `/api/chat` (POST)
- **Changes:**
  - Added userId extraction with 401 error if missing
  - Updated: `getConversation(fullConversationId, userId)`
  - Updated: `saveConversation(fullConversationId, userId, conversation, agentType)`

#### Context Status (Line ~3672)
- **Endpoint:** `/api/context-status` (POST)
- **Changes:**
  - Added userId extraction with 401 error if missing
  - Updated: `getConversation(conversationId, userId)`

#### Process Grant Cards (Line ~3784)
- **Endpoint:** `/api/process-grant` (POST)
- **Agent:** `grant-cards`
- **Changes:**
  - Added userId extraction with 401 error if missing
  - Updated: `getConversation(fullConversationId, userId)`
  - Updated: `saveConversation(fullConversationId, userId, conversation, agentType)`

#### Process ETG (Line ~3895)
- **Endpoint:** `/api/process-etg` (POST)
- **Agent:** `etg-writer`
- **Changes:**
  - Added userId extraction with 401 error if missing
  - Updated: `getConversation(fullConversationId, userId)`
  - Updated: `saveConversation(fullConversationId, userId, conversation, 'etg-writer')`

#### Process BCAFE (Line ~4058)
- **Endpoint:** `/api/process-bcafe` (POST)
- **Agent:** `bcafe-writer`
- **Changes:**
  - Added userId extraction with 401 error if missing
  - Updated: `getConversation(fullConversationId, userId)`
  - Updated: `saveConversation(fullConversationId, userId, conversation, 'bcafe-writer')`

#### Process CanExport Claims (Line ~4163)
- **Endpoint:** `/api/process-claims` (POST)
- **Agent:** `canexport-claims`
- **Changes:**
  - Added userId extraction with 401 error if missing
  - Updated: `getConversation(fullConversationId, userId)`
  - Updated: `saveConversation(fullConversationId, userId, conversation, 'canexport-claims')`

#### Get Conversation History (Line ~4295)
- **Endpoint:** `/api/conversation/:id` (GET)
- **Changes:**
  - Added userId extraction with 401 error if missing
  - Updated: `getConversation(conversationId, userId)`

#### Delete Conversation (Line ~4309)
- **Endpoint:** `/api/conversation/:id` (DELETE)
- **Changes:**
  - Added userId extraction with 401 error if missing
  - Updated: `deleteConversation(conversationId, userId)`

## What's Still Using Redis

The following features continue using Redis (not migrated to PostgreSQL):

1. **File Context Metadata** (`conv-meta:${conversationId}`)
   - Stores uploaded file information
   - Functions: `getConversationFileContext()`, `updateConversationFileContext()`

2. **Knowledge Base Cache** (`knowledge-${agentType}`)
   - Caches Google Drive documents
   - Functions: `getAgentKnowledgeBase()`, `loadAgentSpecificKnowledgeBase()`

3. **Rate Limiting** (in-memory arrays)
   - `callTimestamps` array
   - `lastCallTime` timestamp

## Verification Checklist

✅ All `getConversation()` calls now include `userId` parameter
✅ All `saveConversation()` calls now include `userId` and `agentType` parameters
✅ All `deleteConversation()` calls now include `userId` parameter
✅ All endpoints extract userId from JWT and return 401 if missing
✅ Database queries verify user ownership before returning data
✅ PostgreSQL pool connection properly configured
✅ Incremental message saving (only saves new messages)
✅ Conversation metadata created with agent_type for filtering

## Testing Instructions

### 1. Local Testing Setup
```bash
# Ensure DATABASE_URL is in .env
echo "DATABASE_URL=postgresql://..." >> .env

# Run database setup (if not already done)
npm run db:setup

# Update vercel.json to route to server-with-db.js temporarily
# Change: "src": "api/server.js" → "src": "api/server-with-db.js"

# Start development server
npm run dev
```

### 2. Test Each Endpoint

**Grant Cards Agent:**
1. Visit http://localhost:3000/grant-cards
2. Upload a grant document
3. Send a message
4. Verify conversation persists after page refresh
5. Check database for conversation and messages

**ETG Agent:**
1. Visit http://localhost:3000/etg-agent
2. Select organization type and grant type
3. Send a message
4. Verify persistence

**BCAFE Agent:**
1. Visit http://localhost:3000/bcafe-agent
2. Select organization type and markets
3. Send a message
4. Verify persistence

**CanExport Claims Agent:**
1. Visit http://localhost:3000/canexport-claims
2. Upload expense documents
3. Send a message
4. Verify persistence

### 3. Database Verification Queries

```sql
-- Check conversations
SELECT id, user_id, agent_type, title, created_at, updated_at
FROM conversations
ORDER BY updated_at DESC;

-- Check messages for a conversation
SELECT id, role, LEFT(content, 100) as content_preview, created_at
FROM messages
WHERE conversation_id = 'YOUR_CONVERSATION_ID'
ORDER BY created_at ASC;

-- Count messages per conversation
SELECT c.id, c.agent_type, c.title, COUNT(m.id) as message_count
FROM conversations c
LEFT JOIN messages m ON c.id = m.conversation_id
GROUP BY c.id, c.agent_type, c.title
ORDER BY c.updated_at DESC;
```

### 4. Test Authentication

**With Valid JWT:**
- All endpoints should work normally
- Conversations load from database
- Messages save to database

**Without JWT (or expired):**
- All endpoints should return 401 Unauthorized
- Error message: "Authentication required"

### 5. Test Conversation Isolation

1. Log in as User A
2. Create a conversation
3. Note the conversation ID
4. Log out
5. Log in as User B
6. Try to access User A's conversation ID
7. Should return empty array (no access)

## Production Deployment Steps

Once testing is complete:

1. **Backup current server.js**
   ```bash
   cp api/server.js api/server-original-backup.js
   ```

2. **Replace server.js with database version**
   ```bash
   cp api/server-with-db.js api/server.js
   ```

3. **Ensure vercel.json routes to server.js**
   ```json
   { "src": "/api/(.*)", "dest": "api/server.js" }
   ```

4. **Deploy to Vercel**
   ```bash
   npm run deploy
   ```

5. **Verify production deployment**
   - Test all agent pages
   - Verify conversations persist
   - Check database for new conversations
   - Monitor error logs

## Rollback Plan

If issues occur in production:

1. **Quick rollback:**
   ```bash
   cp api/server-original-backup.js api/server.js
   git add api/server.js
   git commit -m "Rollback to Redis-based server"
   npm run deploy
   ```

2. **Investigation:**
   - Check Vercel logs for errors
   - Verify DATABASE_URL is set in production environment
   - Test database connectivity
   - Review PostgreSQL pool configuration

## Environment Variables Checklist

Ensure these are set in Vercel production environment:

- ✅ `DATABASE_URL` or `POSTGRES_URL` - PostgreSQL connection string
- ✅ `JWT_SECRET` - For JWT verification
- ✅ `ANTHROPIC_API_KEY` - Claude API access
- ✅ `UPSTASH_REDIS_REST_URL` - Redis for file context/knowledge cache
- ✅ `UPSTASH_REDIS_REST_TOKEN` - Redis authentication
- ✅ `GOOGLE_SERVICE_ACCOUNT_KEY` - Google Drive access
- ✅ `GOOGLE_DRIVE_FOLDER_ID` - Knowledge base location

## Performance Considerations

**Database Queries per Request:**
- Chat request: 3-4 queries (check conversation, load messages, save messages)
- Get conversation: 2 queries (check ownership, load messages)
- Delete conversation: 1 query (cascade delete)

**Optimization Opportunities:**
- Message loading uses indexed `conversation_id` column
- User ownership verification uses indexed `user_id` column
- Incremental saves only insert new messages (reduces DB load)
- Consider adding message count limit per conversation (prevent unbounded growth)

## Next Steps

1. ✅ Complete server-with-db.js implementation
2. ⏳ Test locally with all agents
3. ⏳ Verify database persistence
4. ⏳ Compare behavior with original server.js
5. ⏳ Deploy to production
6. ⏳ Monitor and optimize
