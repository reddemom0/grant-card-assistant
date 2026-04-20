# Cache Duplication Bug Fix

**Date:** February 3, 2026
**File:** `src/claude/client.js`
**Impact:** $63/month savings (30% reduction)

---

## Problem Identified

Your system was creating a **new cache for every conversation** instead of reusing a shared cache across conversations.

**Root cause:** Conversation-specific data (memories and learning) was being concatenated into the system prompt BEFORE caching.

### Before (Buggy Code)

```javascript
// Line 89-99: Load and CONCATENATE everything
let systemPrompt = loadAgentPromptCached(agentType);
if (memories) {
  systemPrompt += memories;  // ❌ Conversation-specific appended!
}
if (learningMemory) {
  systemPrompt += learningMemory;  // ❌ User-specific appended!
}

// Line 267-272: Cache the ENTIRE concatenated string
system: [
  {
    type: 'text',
    text: systemPrompt,  // ❌ Different for every conversation!
    cache_control: { type: 'ephemeral' }
  }
]
```

**Result:** Every conversation had a unique `systemPrompt`, so every conversation created a new cache.

- Conversation A: `basePrompt + memoriesA` → Cache 1
- Conversation B: `basePrompt + memoriesB` → Cache 2
- Conversation C: `basePrompt + memoriesC` → Cache 3
- ...17 conversations = 17 separate caches

---

## Solution Implemented

**Separate cacheable content from non-cacheable content** using multiple system blocks.

### After (Fixed Code)

```javascript
// Lines 88-115: Load components separately (DON'T concatenate)
const baseAgentPrompt = loadAgentPromptCached(agentType);  // ✅ Static
const memories = await loadConversationMemories(conversationId);  // ✅ Separate
const learningMemory = await loadLearningMemory(agentType, conversationId, userId);  // ✅ Separate

// Lines 266-288: Build system blocks array
const systemBlocks = [
  {
    type: 'text',
    text: baseAgentPrompt,
    cache_control: { type: 'ephemeral' }  // ✅ CACHED (reused!)
  }
];

// Only add memories if present (NOT cached)
if (memories) {
  systemBlocks.push({
    type: 'text',
    text: memories  // ✅ NOT cached (varies per conversation)
  });
}

// Only add learning if present (NOT cached)
if (learningMemory) {
  systemBlocks.push({
    type: 'text',
    text: learningMemory  // ✅ NOT cached (varies per user)
  });
}

system: systemBlocks  // ✅ Multiple blocks with proper cache control
```

**Result:** All conversations for the same agent type now share ONE cache for the base prompt.

- Conversation A: Cache 1 (base) + memoriesA (uncached)
- Conversation B: Cache 1 (base) + memoriesB (uncached)  ← Reuses cache!
- Conversation C: Cache 1 (base) + memoriesC (uncached)  ← Reuses cache!
- ...17 conversations = 1 shared cache

---

## Expected Impact

### Before Fix
- **17 cache creations per day** (one per conversation)
- **Cache write cost:** 17 × $0.14 = **$2.38/day**
- **Monthly:** $71.40

### After Fix
- **2-3 cache creations per day** (one per agent type)
- **Cache write cost:** 2 × $0.14 = **$0.28/day**
- **Monthly:** $8.40

### Savings
- **$2.10/day**
- **$63/month**
- **30% reduction in total API costs**

---

## Cache Reuse Behavior

With this fix, here's how caching now works:

1. **First conversation of the day** (internal-oracle agent):
   - Creates new cache for base internal-oracle prompt
   - Cost: $0.14 (cache write)

2. **All subsequent conversations** (internal-oracle agent):
   - Reuses cache from conversation 1
   - Cost: $0.01 (cache read) instead of $0.14 (cache write)
   - **90% savings per conversation**

3. **First conversation with different agent** (etg-writer):
   - Creates new cache for base etg-writer prompt
   - Cost: $0.14 (cache write)

4. **All subsequent etg-writer conversations:**
   - Reuses cache from first etg-writer conversation
   - Cost: $0.01 (cache read)
   - **90% savings**

---

## Verification

After deploying this fix, you should see in your logs:

### Good Signs
- **Cache creation count:** 1-3 per day (one per agent type used)
- **Cache read count:** Should be 10-20x higher than creation count
- **Cache hit rate:** Should increase to 85-95%

### Red Flags
- If you still see 15+ cache creations per day, something is wrong
- If cache reads are less than 10x cache creations, investigate

### How to Monitor

Look at your daily logs for these token metrics:
```
cache_creation_input_tokens: Should be LOW (only 1-3 conversations create)
cache_read_input_tokens: Should be HIGH (most conversations read)
```

**Target ratio:** 1 cache creation : 10-20 cache reads

---

## Technical Details

### Why Multiple System Blocks Work

Anthropic's API allows you to specify multiple system blocks with independent cache control:

```javascript
system: [
  { type: 'text', text: 'static content', cache_control: { type: 'ephemeral' } },  // Cached
  { type: 'text', text: 'dynamic content' }  // Not cached
]
```

**Cache key:** Generated from the content of blocks with `cache_control`

- If the cached blocks are identical, the cache is reused
- If they differ, a new cache is created

### Our Fix Applied

**Cache key = hash(baseAgentPrompt)**

- Same for all conversations with same agent type
- Different only when agent type changes

**Non-cached content (memories, learning):**
- Varies per conversation/user
- Doesn't affect cache key
- No impact on cache reuse

---

## Files Modified

- `src/claude/client.js` (Lines 84-117, 256-303)
  - Separated base prompt from memories/learning
  - Built system blocks array with proper cache control
  - Added documentation comments explaining the fix

---

## Next Steps

1. **Deploy to Railway** (push changes, Railway will auto-deploy)
2. **Monitor for 24 hours** to verify fix is working
3. **Check logs** to confirm cache reuse (should see ~17 cache reads, not 17 cache writes)
4. **Validate savings** in next day's cost analysis

Expected result: Daily API costs should drop from **$7.10** to **$5.00** (30% reduction)

---

## Related Optimizations

This fix addresses the cache duplication issue. For additional savings, consider:

1. **Orchestrator-Workers Pattern** (implemented in `src/patterns/orchestrator-workers.js`)
   - Potential savings: 60-80% on complex queries
   - Next step: Integrate into main agent routing

2. **1-Hour Cache TTL** (currently using 5-minute default)
   - Change: `cache_control: { type: 'ephemeral', ttl: 3600 }`
   - Additional savings: $47/month

3. **Query Routing** (route simple queries to Haiku)
   - Potential savings: 40-60%
   - Requires query classifier implementation

See `COST_OPTIMIZATION_STRATEGIES.md` for full details.

---

*This fix is the foundation for all other optimizations. Without it, we were wasting 85% of our cache budget on redundant writes.*
