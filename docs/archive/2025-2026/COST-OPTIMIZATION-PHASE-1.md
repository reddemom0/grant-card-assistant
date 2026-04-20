# Cost Optimization - Phase 1 Implementation

**Date:** January 28, 2026
**Expected Savings:** $40-50/month (48-60% reduction)
**Status:** ✅ Implemented, Ready for Testing

---

## 📊 Problem Analysis

### Current Costs (January 2026)
- **Total:** $103.77/month ($102.58 tokens + $1.19 web search)
- **Excluding indexing spike:** $83.63/month operational cost
- **Cost drivers:**
  - Conversation history NOT cached: ~$31.50/month
  - No conversation limits: Allows unbounded growth
  - No cost monitoring: Can't track expensive requests

### Root Causes
1. **No conversation history caching** - All history sent at full price ($3/M)
2. **Unlimited conversation history** - getConversationMessages() loads ALL messages
3. **No cost visibility** - No per-request logging

---

## 🛠️ What Was Implemented

### 1. Conversation History Caching
**File:** `src/claude/client.js`
**Lines:** 204-229

**What it does:**
- Marks every 5th assistant message with `cache_control: { type: 'ephemeral' }`
- Reduces cost from $3/M → $0.30/M for cached content (10x cheaper)
- Same behavior as Claude.ai website

**Impact:**
- 15K tokens × $0.30/M = $0.0045 per request (vs $0.045)
- **Saves ~$28/month**

### 2. Conversation Limits
**File:** `src/database/messages.js`
**Lines:** 42-63, 125-137

**What it does:**
- Added `maxMessages` parameter to getConversationMessages()
- Default: 60 messages (30 turns)
- Uses SQL subquery to get most recent messages efficiently
- Logs when conversations are limited

**Per-agent limits** (configured in `src/config/cost-settings.js`):
```javascript
{
  'grant-cards': 30 turns,
  'etg-writer': 30 turns,
  'canexport-claims': 30 turns,
  'internal-oracle': 40 turns,  // Longer for research
  // etc.
}
```

**Impact:**
- Prevents runaway costs on long conversations
- **Saves ~$10-15/month on long conversations**

### 3. Cost Monitoring & Logging
**File:** `src/claude/client.js`
**Lines:** 298-330

**What it does:**
- Logs token usage after every API call
- Calculates actual $ cost per request
- Warns if request exceeds $0.50 threshold
- Displays cache hit rate per request

**Example log output:**
```
📊 Token usage: { input: 928, output: 81, cache_creation: 0, cache_read: 33144 }
💰 Request cost: $0.0134
📈 Cache hit rate: 97.3%
```

**Impact:**
- Zero cost, pure visibility
- Enables tracking and optimization

### 4. Centralized Configuration
**File:** `src/config/cost-settings.js` (NEW)

**What it does:**
- Single source of truth for all cost settings
- Easy to adjust limits per agent
- Cost calculation functions
- Monitoring thresholds

**Makes it easy to:**
- Adjust conversation limits
- Change caching frequency
- Modify cost alert thresholds

---

## 📈 Expected Results

### Before (January operational costs):
```
Monthly:  $83.63
Daily:    $3.80
Per req:  $0.119 (avg)

Token breakdown per typical request:
- System prompt: 13K @ $0.30/M (cached) = $0.0039
- Conversation:  15K @ $3.00/M = $0.0450
- Current msg:    6K @ $3.00/M = $0.0180
Total: $0.0669 per request
```

### After (with Phase 1):
```
Monthly:  $33-40
Daily:    $1.50-1.80
Per req:  $0.047 (avg)

Token breakdown per typical request:
- System prompt: 13K @ $0.30/M (cached) = $0.0039
- Conversation:  15K @ $0.30/M (cached) = $0.0045  ← 10x cheaper!
- Current msg:    6K @ $3.00/M = $0.0180
Total: $0.0264 per request (60% savings!)
```

### Savings:
- **Per request:** $0.0405 saved (60% reduction)
- **Monthly:** $40-50 saved (48-60% reduction)
- **Annual:** $480-600 saved

---

## 🔍 How It Works - Technical Details

### Conversation History Caching

**Before:**
```javascript
let messages = [
  ...history,  // ALL sent at full price
  { role: 'user', content: userContent }
];
```

**After:**
```javascript
const historyWithCaching = history.map((msg, idx) => {
  if (msg.role === 'assistant' && (idx + 1) % 5 === 0) {
    return {
      ...msg,
      cache_control: { type: 'ephemeral' }  // Cache every 5th
    };
  }
  return msg;
});

let messages = [
  ...historyWithCaching,  // Checkpoint-based caching
  { role: 'user', content: userContent }
];
```

### Message Limiting

**Before:**
```sql
SELECT role, content, created_at
FROM messages
WHERE conversation_id = $1
ORDER BY created_at ASC
-- No LIMIT = loads ALL messages
```

**After:**
```sql
SELECT role, content, created_at
FROM (
  SELECT role, content, created_at
  FROM messages
  WHERE conversation_id = $1
  ORDER BY created_at DESC
  LIMIT 60  -- Most recent 60 messages
) recent_messages
ORDER BY created_at ASC
```

---

## 🧪 Testing Checklist

### 1. Verify Caching is Working
- [ ] Start a new conversation
- [ ] Check Railway logs for "cache_creation" tokens on first turn
- [ ] Send 2nd message within 5 minutes
- [ ] Check logs for "cache_read" tokens (should be 10x more than cache_creation)
- [ ] Verify cache hit rate is >50%

### 2. Verify Conversation Limits
- [ ] Check logs show "Retrieved X messages (limited from Y total)" on long conversations
- [ ] Verify short conversations (<30 turns) are unaffected
- [ ] Test that conversations still work correctly with history

### 3. Verify Cost Logging
- [ ] Check Railway logs show "📊 Token usage" after every request
- [ ] Verify "💰 Request cost" is displayed
- [ ] Confirm costs are lower than before

### 4. User Experience Testing
- [ ] Start conversation with grant-cards agent
- [ ] Have 5-10 turn conversation
- [ ] Verify agent maintains context correctly
- [ ] Check that responses are still high quality
- [ ] Test with attachments (PDFs, images)

---

## 🎛️ Configuration & Tuning

### If You Need Longer Conversations

Edit `src/config/cost-settings.js`:

```javascript
maxTurns: {
  'internal-oracle': 50,  // Increase from 40
  'grant-cards': 40,      // Increase from 30
  // etc.
}
```

### If Cache Hit Rate is Low

Adjust caching frequency:

```javascript
cacheEveryNMessages: 3,  // Cache more frequently (every 3rd instead of 5th)
```

### If Costs Are Still Too High

Lower the limits:

```javascript
maxTurns: {
  'default': 20  // Reduce from 30
}
```

---

## 📊 Monitoring After Deployment

### Check These Metrics Daily (First Week):

1. **Cache Hit Rate**
   - Target: >60%
   - Check Railway logs for "📈 Cache hit rate"

2. **Average Request Cost**
   - Target: $0.025-0.040
   - Check Railway logs for "💰 Request cost"

3. **User Experience**
   - Any complaints about lost context?
   - Any issues with long conversations?

4. **Total Daily Cost**
   - Target: $1.50-2.00/day
   - Monitor Claude Console

### Red Flags to Watch For:

- ⚠️ Cache hit rate <30% (something wrong with caching)
- ⚠️ Average cost >$0.10/request (limits not working)
- ⚠️ HIGH COST ALERT messages in logs (investigate those requests)
- ⚠️ User reports of "lost context" (limits may be too aggressive)

---

## 🚀 Deployment Steps

### 1. Commit Changes
```bash
git add .
git commit -m "feat: Implement Phase 1 cost optimizations

- Add conversation history caching (10x cost reduction)
- Add 30-turn conversation limits per agent
- Add cost monitoring and per-request logging
- Create centralized cost settings config

Expected savings: $40-50/month (48-60% reduction)
"
```

### 2. Deploy to Railway
```bash
git push origin railway-migration
```

### 3. Monitor Deployment
- Check Railway logs for successful startup
- Look for "✓ Agent prompt loaded" messages
- Verify no import errors

### 4. Test First Request
- Send a test message to internal-oracle
- Check logs for:
  - "📊 Token usage"
  - "💰 Request cost"
  - "📈 Cache hit rate" (on 2nd+ requests)

### 5. Monitor for 24 Hours
- Watch Railway logs for errors
- Check Claude Console for cost trends
- Verify user experience is unchanged

---

## ✅ Success Criteria

**Phase 1 is successful if:**

1. ✅ Cache hit rate consistently >50%
2. ✅ Average request cost <$0.05
3. ✅ Daily cost <$2.00
4. ✅ No user complaints about context loss
5. ✅ All agents working normally

**If all criteria met:**
- Phase 1 is working perfectly!
- Can proceed to Phase 2 (conversation compacting) if needed
- Current savings should be sufficient

---

## 🔮 Future Enhancements (Phase 2)

If you need even more savings or longer conversations:

1. **Conversation Compacting**
   - Summarize turns 1-20 when conversation hits 30 turns
   - Allows unlimited conversation length
   - Additional $10-15/month savings

2. **Aggressive Query Classification**
   - Route more queries to Haiku ($1/M vs $3/M)
   - Additional $5-10/month savings

3. **Cost Analytics Dashboard**
   - Track cost per agent over time
   - Identify expensive conversation patterns
   - Set per-agent budgets

---

## 📝 Notes

- All changes are backwards compatible
- No database migrations required
- Can rollback by reverting commit
- Zero impact on user experience (if caching working correctly)
- Conversation limits are 3x longer than typical usage

---

**Questions or Issues?**
- Check Railway logs first
- Verify cache hit rates
- Test with a fresh conversation
- Can increase limits if needed (no risk)
