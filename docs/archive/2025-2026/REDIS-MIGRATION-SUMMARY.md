# Redis Conversation Persistence Migration

## Problem Fixed

**Original Bug**: Conversations were being lost after 2-3 message exchanges on Vercel's serverless platform.

**Root Cause**: Conversations were stored in an in-memory JavaScript `Map()` which is lost when serverless function instances are recycled (cold starts). Vercel keeps instances warm for only ~5 minutes, causing conversation history to disappear.

**Solution**: Migrated all conversation storage to Redis (Upstash) with 24-hour TTL, ensuring persistence across cold starts.

## Changes Made

### 1. Core Redis Helper Functions (Lines 452-487)

**Added:**
- `async function getConversation(conversationId)` - Loads conversation array from Redis
- `async function saveConversation(conversationId, conversation)` - Saves with 24hr expiry
- `async function deleteConversation(conversationId)` - Removes from Redis
- `const conversationMetadata = new Map()` - Lightweight in-memory metadata tracking (timestamps only)

**Redis Key Pattern:**
- Conversations: `conv:${conversationId}` (e.g., `conv:etg-1234567890-abc123`)
- File metadata: `conv-meta:${conversationId}`

### 2. File Context Functions (Lines 315-359)

**Updated:**
- `getConversationFileContext()` → Now loads from Redis key `conv-meta:${conversationId}`
- `updateConversationFileContext()` → Now saves to Redis with 24hr TTL
- Both functions now `async` and use `await`

### 3. Cleanup Function (Lines 95-102)

**Updated:**
- `cleanupExpiredConversations()` → Now calls `deleteConversation()` which removes from Redis
- Uses `conversationMetadata` Map instead of old `conversationTimestamps`

### 4. Streaming Endpoint (Lines ~2663-2745)

**Pattern Applied:**
```javascript
// OLD:
if (!conversations.has(fullConversationId)) {
  conversations.set(fullConversationId, []);
}
const conversation = conversations.get(fullConversationId);

// NEW:
let conversation = await getConversation(fullConversationId);
if (conversation.length === 0) {
  console.log(`🆕 Starting new conversation`);
}
```

**Save Pattern:**
```javascript
// After Claude API response
conversation.push({ role: 'assistant', content: fullContentBlocks });
await saveConversation(fullConversationId, conversation); // ✅ Added
```

### 5. Non-Streaming Endpoints Updated

All agent endpoints migrated:
- `/api/process-grant` (grant-cards)
- `/api/process-etg` (ETG Business Case)
- `/api/process-bcafe` (BCAFE)
- `/api/process-claims` (CanExport Claims)

Each endpoint now:
1. Calls `await getConversation()` to load from Redis
2. Calls `await saveConversation()` after pushing assistant response
3. Uses `await getConversationFileContext()` for file metadata
4. Uses `await updateConversationFileContext()` when files uploaded

### 6. Management Endpoints (Lines 3580-3595)

**GET `/api/conversation/:id`:**
```javascript
// OLD: const conversation = conversations.get(conversationId) || [];
// NEW:
const conversation = await getConversation(conversationId);
```

**DELETE `/api/conversation/:id`:**
```javascript
// OLD:
// conversations.delete(conversationId);
// conversations.delete(`${conversationId}-meta`);

// NEW:
await deleteConversation(conversationId);
await redis.del(`conv-meta:${conversationId}`);
```

### 7. Context Status Endpoint (Line 2994)

```javascript
// OLD: const conversation = conversations.get(conversationId) || [];
// NEW: const conversation = await getConversation(conversationId);
```

## File Changes Summary

**File**: `api/server-redis-updated.js` (complete updated version)

**Total Changes**: ~30 locations updated

**Lines Modified**:
- Helper functions: 452-487
- File context: 315-359
- Cleanup: 95-102
- Streaming endpoints: ~2663-2745
- Grant-cards: ~3123-3180
- ETG: ~3211-3357
- BCAFE: ~3379-3455
- Claims: ~3513-3563
- Management: 2994, 3582, 3590-3592

## Testing Checklist

Before deploying to production:

- [ ] Verify Redis connection (check `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars)
- [ ] Test conversation persistence across multiple message exchanges
- [ ] Test file uploads persist across exchanges
- [ ] Test each agent type (grant-cards, ETG, BCAFE, claims)
- [ ] Verify conversations expire after 24 hours
- [ ] Test DELETE conversation endpoint
- [ ] Monitor Redis memory usage in Upstash dashboard
- [ ] Check CloudWatch/Vercel logs for Redis errors

## Deployment

1. Replace `api/server.js` with `api/server-redis-updated.js`
2. Ensure Redis environment variables are set in Vercel:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. Deploy to Vercel
4. Monitor first few conversations for errors

## Rollback Plan

If issues occur:
1. Restore original `api/server.js` from git history
2. Redeploy
3. In-memory conversations will work within warm instances (5 min window)

## Benefits

✅ **Conversations persist across cold starts**
✅ **File uploads retained throughout conversation**
✅ **Scalable across multiple serverless instances**
✅ **Automatic 24-hour expiry prevents Redis bloat**
✅ **Compatible with existing frontend code (no changes needed)**

## Performance Impact

- **Latency**: +10-30ms per request (Redis read/write)
- **Cost**: Minimal - Upstash charges per 100K commands, typical conversation = ~2-4 commands
- **Memory**: Moved from serverless RAM to Redis (better for multi-instance scaling)

## Redis Key Examples

```
conv:grant-cards-grant-cards-conversation
conv:etg-1234567890-abc123
conv:bcafe-1234567890-xyz789
conv:claims-1234567890-def456

conv-meta:grant-cards-grant-cards-conversation
conv-meta:etg-1234567890-abc123
```

## Notes

- The old `conversationTimestamps` Map is now `conversationMetadata` (lightweight metadata only)
- Removed all `conversations.get/set/has/delete` operations (replaced with Redis)
- Frontend requires NO changes - conversation IDs work exactly the same
- Session storage in frontend (etg-agent.html) still generates unique IDs per browser tab