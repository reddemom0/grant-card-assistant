# Cost Optimization Strategies for Claude API
*Research-backed approaches from Anthropic Cookbook & Official Docs*

## Current State Analysis

**Oracle conversation (Feb 3, 2026):**
- Cost: $2.73
- API calls: 22
- Input tokens: 604K
- Output tokens: 32K
- Issue: Creating new cache for every conversation (17 caches in one day)

**Monthly projection:** $480/month
**Target:** $168/month (65% reduction)

---

## Strategy 1: Orchestrator-Workers Pattern ⭐ PRIORITY

**Source:** [Anthropic Cookbook - patterns/agents/orchestrator_workers.ipynb](https://github.com/anthropics/anthropic-cookbook/tree/main/patterns/agents)

**Concept:** Sonnet orchestrates, Haiku workers execute subtasks in parallel

**Savings:** 60-80% on complex multi-step queries

**Implementation:** See code in src/patterns/orchestrator-workers.js

**Example:**
```
User: "Show me qualified CanExport clients and previous applicants"

❌ CURRENT (Single agent):
→ Sonnet processes everything: $2.73

✅ OPTIMIZED (Orchestrator-workers):
→ Sonnet orchestrator plans: $0.15
→ 3 Haiku workers (parallel):
  - Query qualified clients: $0.10
  - Query previous applicants: $0.10
  - Cross-reference eligibility: $0.05
→ Sonnet synthesizes: $0.20
Total: $0.60 (78% savings)
```

---

## Strategy 2: Automatic Context Compaction

**Source:** [Anthropic Cookbook - tool-use-automatic-context-compaction](https://platform.claude.com/cookbook/tool-use-automatic-context-compaction)

**Problem:** Long conversations accumulate tokens linearly
- Message 1: 15K tokens
- Message 2: 30K tokens (includes message 1 history)
- Message 3: 45K tokens
- Message 10: 150K tokens 💸

**Solution:** Periodically summarize and compress history

**How it works:**
1. Monitor conversation token count
2. When exceeds threshold (e.g., 50K): inject summary request
3. Claude generates compressed summary (~2K tokens)
4. Replace full history with summary
5. Continue conversation with compressed context

**Verified savings:** 58.6% token reduction in similar workflows

**When to use:**
- Long conversations (10+ exchanges)
- Sequential tool use workflows
- Iterative analysis tasks

**Implementation:** See code in src/utils/context-compaction.js

---

## Strategy 3: Message Batches API (50% Discount)

**Source:** [Anthropic Official - Message Batches API](https://www.anthropic.com/news/message-batches-api)

**What:** Submit up to 10,000 queries, processed within 24 hours at 50% off

**Pricing:**
- Sonnet: $1.50 input / $7.50 output (vs $3/$15)
- Haiku: $0.50 input / $2.50 output (vs $1/$5)

**Use cases:**
- Nightly lead qualification
- Weekly CRM enrichment
- Monthly client segmentation
- Bulk eligibility analysis

**Example batch job:**
```javascript
// Submit 100 leads for overnight analysis
const batch = await anthropic.messages.batches.create({
  requests: leads.map(lead => ({
    custom_id: lead.id,
    params: {
      model: 'claude-haiku-4-5',
      messages: [{
        role: 'user',
        content: `Analyze CanExport eligibility: ${lead}`
      }]
    }
  }))
});
```

**Monthly savings:** $75-150 for recurring analysis tasks

---

## Strategy 4: Smart Query Routing

**Source:** [Anthropic Cookbook - patterns/agents/basic_workflows.ipynb](https://github.com/anthropics/anthropic-cookbook/tree/main/patterns/agents)

**Concept:** Route queries to appropriate model based on complexity

**Decision tree:**
- Simple data retrieval → Haiku ($1/M input)
- Eligibility analysis → Haiku with tools ($1/M input)
- Strategic recommendations → Sonnet ($3/M input)
- Complex reasoning → Sonnet ($3/M input)

**Implementation:**
```javascript
function selectModel(query) {
  const simplePatterns = [/show.*clients/, /list.*companies/, /find.*in hubspot/];
  const complexPatterns = [/analyz/, /strateg/, /recommend/, /how should/];

  if (complexPatterns.some(p => p.test(query))) return 'sonnet';
  if (simplePatterns.some(p => p.test(query))) return 'haiku';
  return 'sonnet'; // Default to quality
}
```

**Savings:** 40-60% by using right model for right task

---

## Strategy 5: Prompt Chaining

**Source:** [Anthropic Cookbook - patterns/agents/basic_workflows.ipynb](https://github.com/anthropics/anthropic-cookbook/tree/main/patterns/agents)

**Problem:** Monolithic queries send everything in one context

**Solution:** Break into sequential chains, each with minimal context

**Example:**
```
❌ MONOLITHIC:
"Query HubSpot, filter by eligibility, analyze strategy, recommend actions"
→ One massive 40K token context

✅ CHAINED:
Chain 1 (Haiku): Query HubSpot → 5K tokens
Chain 2 (Haiku): Filter results → 3K tokens
Chain 3 (Sonnet): Strategic analysis → 8K tokens
→ Total: 16K tokens (60% reduction)
```

**Savings:** 30-50% vs monolithic approach

---

## Strategy 6: 1-Hour Cache TTL

**Source:** [Anthropic Docs - Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

**Problem:** 5-minute cache expires too quickly for workday usage
- Team creates 20 conversations per day
- 5-min cache = 96 potential expirations per 8 hours
- Each expiration = new cache write ($3.75/M)

**Solution:** 1-hour cache for active work sessions
- Costs 2x to write ($6/M vs $3.75/M)
- But lasts 12x longer (60 min vs 5 min)
- Net savings: 60% fewer cache writes

**Math:**
- 5-min: 20 cache writes/day × $0.14 = $2.80/day
- 1-hour: 3 cache writes/day × $0.22 = $0.66/day
- **Save: $2.14/day = $47/month**

**Implementation:**
```javascript
cache_control: { type: "ephemeral", ttl: 3600 } // 1 hour
```

---

## Strategy 7: Fix Cache Duplication Issue ⚠️ CRITICAL

**Current problem:** Creating new cache for EVERY conversation

**Root cause:** Likely including conversation-specific data in cached content

**What should be cached (shared across conversations):**
- ✅ Agent system prompt
- ✅ Tool definitions
- ✅ Learning files
- ✅ Knowledge base content

**What should NOT be in cache (conversation-specific):**
- ❌ Conversation ID
- ❌ User ID
- ❌ Message history
- ❌ Timestamps

**Diagnosis needed:** Check src/api/server.js cache implementation

**Potential savings:** $63/month (eliminate 85% of redundant cache writes)

---

## Strategy 8: Token-Efficient Tool Use

**Source:** Built into Claude 4.5 models (automatic)

**Feature:** Reduces tool use output tokens by up to 70%

**Status:** Already enabled in Claude 4.5 (no action needed)

**Verify it's working:** Check if tool responses are concise, structured

---

## Combined Optimization Plan

### Phase 1: Quick Wins (Week 1) - 2 hours
1. ✅ Fix cache duplication issue → Save $63/mo
2. ✅ Enable 1-hour cache TTL → Save $47/mo
3. ✅ Implement query routing → Save $60/mo
**Total: $170/month saved**

### Phase 2: Architecture (Week 2) - 5 hours
4. ✅ Orchestrator-workers pattern → Save $90/mo
5. ✅ Auto-compaction for long chats → Save $40/mo
**Additional: $130/month saved**

### Phase 3: Automation (Week 3) - 3 hours
6. ✅ Batch API for nightly jobs → Save $40/mo
7. ✅ Prompt chaining → Save $30/mo
**Additional: $70/month saved**

### Total Potential Savings
**Current:** $480/month
**After optimization:** $110/month
**Savings:** $370/month ($4,440/year)

---

## Monitoring & Validation

### Metrics to track:
- Cost per conversation by agent type
- Average tokens per conversation
- Cache hit rate (target: 80%+)
- Cache creation vs reads ratio (target: 1:10+)
- Model distribution (Haiku vs Sonnet usage)

### Success criteria:
- ✅ Monthly API costs < $150
- ✅ Cache hit rate > 75%
- ✅ Average conversation cost < $0.50
- ✅ 80%+ queries use optimal model

---

## Resources

- [Anthropic Cookbook](https://github.com/anthropics/anthropic-cookbook)
- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Prompt Caching Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Message Batches API](https://www.anthropic.com/news/message-batches-api)
- [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)

---

*Document created: February 3, 2026*
*Next review: After Phase 1 implementation*
