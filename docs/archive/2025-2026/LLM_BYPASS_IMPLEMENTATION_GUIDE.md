# LLM Bypass Implementation Guide

**Date:** February 4, 2026
**Goal:** Bypass LLM for obvious lookup queries while preserving conversation context
**Target:** 35% of Oracle queries (simple lookups)

---

## The Opportunity

**Current state:**
```javascript
User: "show companies in Ontario"
→ Claude API call ($0.02, 2-3 seconds)
→ Claude uses search_hubspot_companies tool
→ Returns formatted results
```

**Optimized state:**
```javascript
User: "show companies in Ontario"
→ Pattern match: obvious lookup
→ Direct tool execution ($0.00, <500ms)
→ Returns formatted results
```

**Savings:** $35/month + massive latency improvement

---

## The Critical Challenge: Follow-Up Queries

### The Problem

```javascript
User: "show companies in Ontario"
→ Bypass, return 15 companies

User: "which of those would be good for SR&ED"
→ "those" has no referent - LLM never saw the data! 💥
```

### The Wrong Solution ❌

Just saving to conversation history isn't enough:
```javascript
// This doesn't work for follow-ups
await saveMessage(conversationId, 'user', query);
await saveMessage(conversationId, 'assistant', formattedResults);
// LLM can see the conversation, but not the actual data to reason about
```

### The Right Solution ✅

**Option 1: Inject cached results into prompt (RECOMMENDED)**

Cache results and inject them when referenced:

```javascript
// 1. Initial bypass query
async function handleBypassQuery(query, conversationId) {
  // Execute tool directly
  const results = await executeToolDirect('search_hubspot_companies', {
    location: 'Ontario'
  });

  // Cache results with semantic key
  await cacheToolResults(conversationId, {
    key: 'companies_in_ontario',
    data: results,
    query: query,
    timestamp: Date.now(),
    expiresIn: 3600000 // 1 hour
  });

  // Save to conversation
  await saveMessage(conversationId, 'user', query);
  await saveMessage(conversationId, 'assistant', {
    content: formatResults(results),
    metadata: {
      bypassed: true,
      cached_key: 'companies_in_ontario',
      tool_used: 'search_hubspot_companies',
      results_count: results.length
    }
  });

  return formatResults(results);
}

// 2. Follow-up query handling
async function handleFollowUpQuery(query, conversationId) {
  // Check if query references previous results
  const referencesPattern = /\b(those|these|them|they|the companies|the leads)\b/i;

  if (referencesPattern.test(query)) {
    // Get recent cached results
    const recentCache = await getRecentCachedResults(conversationId, limit=3);

    if (recentCache.length > 0) {
      // Inject cached data into system prompt
      const contextInjection = `
## Recent Query Results (for context)

${recentCache.map(cache => `
### ${cache.query}
Executed: ${new Date(cache.timestamp).toLocaleString()}
Tool: ${cache.metadata.tool_used}
Results: ${JSON.stringify(cache.data, null, 2)}
`).join('\n')}

The user's current query may reference these results. Use this data to answer their question.
`;

      // Run LLM with injected context
      return await runLLMWithContext(query, conversationId, contextInjection);
    }
  }

  // Normal LLM flow
  return await runLLM(query, conversationId);
}
```

**Why this works:**
- Initial bypass: $0.00, instant
- Follow-up with reference: Full LLM call, but with actual data to reason about
- Cached results injected as context (adds ~500-1000 tokens)
- LLM can properly reason about "those companies"

**Token cost:**
- Injecting 15 company records: ~1000 tokens
- Cost: $0.003 (negligible)
- Total follow-up cost: ~$0.05 (vs bypassing both for $0)
- **Trade-off accepted:** First query free, follow-up normal cost but correct behavior

---

## Implementation Details

### Stage 1: Pattern Matching

```javascript
// In src/api/chat.js - BEFORE calling runAgent()

if (agentType === 'internal-oracle') {
  const bypassResult = await attemptBypass(message, conversationId, userId);

  if (bypassResult.bypassed) {
    // Return bypass result, skip LLM entirely
    return res.json(bypassResult.response);
  }
}

// Continue with normal LLM flow
```

### Stage 2: Bypass Decision Logic

```javascript
async function attemptBypass(query, conversationId, userId) {
  const lowerQuery = query.toLowerCase();

  // OBVIOUS BYPASS PATTERNS (instant, $0)
  const obviousBypass = [
    {
      pattern: /^(show|list|get)\s+(companies|contacts|deals)\s*$/i,
      tool: 'search_hubspot_companies',
      params: () => ({})
    },
    {
      pattern: /^(show|list|get)\s+(companies|contacts|deals)\s+(in|from)\s+([A-Za-z\s]+)$/i,
      tool: 'search_hubspot_companies',
      params: (match) => ({ location: match[4] })
    },
    {
      pattern: /^how many (companies|contacts|deals)/i,
      tool: 'search_hubspot_companies',
      params: () => ({ countOnly: true })
    },
  ];

  for (const bypass of obviousBypass) {
    const match = query.match(bypass.pattern);
    if (match) {
      return await executeBypass(bypass.tool, bypass.params(match), query, conversationId);
    }
  }

  // AMBIGUOUS QUERIES - might need judgment
  const needsJudgment = [
    /\b(good for|suitable for|qualified for|might|could|should)\b/i,
    /\b(analyze|assess|evaluate|recommend|prioritize)\b/i,
  ];

  if (needsJudgment.some(p => p.test(query))) {
    // Don't bypass - these need LLM reasoning
    return { bypassed: false };
  }

  // REFERENCE TO PREVIOUS RESULTS - needs context injection
  const referencesPattern = /\b(those|these|them|they|the companies|the leads)\b/i;
  if (referencesPattern.test(query)) {
    // Don't bypass, but flag for context injection
    return { bypassed: false, needsContextInjection: true };
  }

  // Not a bypass candidate
  return { bypassed: false };
}
```

### Stage 3: Execute Bypass

```javascript
async function executeBypass(toolName, params, query, conversationId) {
  const startTime = Date.now();

  try {
    // Execute tool directly (no LLM)
    const results = await toolExecutor.execute(toolName, params);

    // Generate cache key from query
    const cacheKey = generateCacheKey(query);

    // Cache results for follow-up queries
    await cacheToolResults(conversationId, {
      key: cacheKey,
      data: results,
      query: query,
      timestamp: Date.now(),
      tool: toolName,
      params: params
    });

    // Save to conversation history
    await saveMessage(conversationId, 'user', query);
    await saveMessage(conversationId, 'assistant', {
      content: formatResults(results),
      metadata: {
        bypassed: true,
        cached_key: cacheKey,
        tool_used: toolName,
        results_count: results.length,
        execution_time_ms: Date.now() - startTime
      }
    });

    // Format results for user
    const formattedResponse = formatResults(results);

    return {
      bypassed: true,
      response: {
        content: formattedResponse,
        metadata: {
          bypassed: true,
          tool_used: toolName,
          execution_time_ms: Date.now() - startTime,
          cost: 0
        }
      }
    };

  } catch (error) {
    console.error(`Bypass execution failed: ${error.message}`);
    // Fall back to normal LLM flow
    return { bypassed: false };
  }
}
```

### Stage 4: Context Injection for Follow-Ups

```javascript
async function runAgentWithContextInjection(query, conversationId, agentType, userId) {
  // Load conversation history
  const messages = await loadConversationMessages(conversationId);

  // Check for cached results from bypassed queries
  const cachedResults = await getRecentCachedResults(conversationId, limit=3);

  let systemPrompt = loadAgentPrompt(agentType);

  // Inject cached results if they exist
  if (cachedResults.length > 0) {
    const contextInjection = `
---

## Recent Query Results (Available for Reference)

${cachedResults.map(cache => `
### Previous Query: "${cache.query}"
**Executed:** ${new Date(cache.timestamp).toLocaleString()}
**Tool Used:** ${cache.tool}
**Results Count:** ${cache.data.length}

**Data:**
\`\`\`json
${JSON.stringify(cache.data, null, 2)}
\`\`\`
`).join('\n---\n')}

**Note:** The user's current query may reference these results (e.g., "those companies", "which of them"). Use this data to answer their question.

---
`;

    systemPrompt = systemPrompt + '\n\n' + contextInjection;
  }

  // Continue with normal LLM flow, but with enriched system prompt
  return await runAgent({
    agentType,
    query,
    conversationId,
    userId,
    systemPrompt, // Enriched with cached data
    messages
  });
}
```

---

## Caching Strategy

### What to Cache

```javascript
interface CachedResult {
  key: string;              // Semantic key: "companies_in_ontario"
  conversationId: string;
  data: any[];              // Actual results
  query: string;            // Original query
  timestamp: number;        // When cached
  tool: string;             // Tool used
  params: object;           // Tool parameters
  expiresAt: number;        // Expiration timestamp
}
```

### Cache Storage

**Option 1: Redis (RECOMMENDED)**
- Already using Redis for conversation state
- Fast lookups
- Built-in expiration

```javascript
// Store in Redis with 1-hour TTL
await redis.setex(
  `bypass_cache:${conversationId}:${cacheKey}`,
  3600, // 1 hour
  JSON.stringify(cachedResult)
);
```

**Option 2: In-memory Map**
- Simple, no external dependencies
- Cleared on server restart
- Good for development

### Cache Retrieval

```javascript
async function getRecentCachedResults(conversationId, limit = 3) {
  // Get all cache keys for this conversation
  const keys = await redis.keys(`bypass_cache:${conversationId}:*`);

  // Get all cached results
  const results = await Promise.all(
    keys.slice(0, limit).map(key => redis.get(key))
  );

  // Parse and sort by timestamp (most recent first)
  return results
    .filter(r => r !== null)
    .map(r => JSON.parse(r))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}
```

---

## Expected Performance

### Before Bypass
```
Query: "show companies in Ontario"
- LLM call: 2-3 seconds
- Cost: $0.02
- Tokens: ~8000 (input) + ~2000 (output)

Follow-up: "which of those would be good for SR&ED"
- LLM call: 2-3 seconds
- Cost: $0.05
- Tokens: ~10000 (input) + ~3000 (output)

Total: 4-6 seconds, $0.07
```

### After Bypass
```
Query: "show companies in Ontario"
- Direct tool execution: <500ms
- Cost: $0.00
- Tokens: 0

Follow-up: "which of those would be good for SR&ED"
- LLM call with injected context: 2-3 seconds
- Cost: $0.05 (+ ~$0.003 for injected data)
- Tokens: ~11000 (input, +1000 for data) + ~3000 (output)

Total: 2.5-3.5 seconds, $0.05
Savings: 40-50% faster, $0.02 saved
```

**Per 100 queries:**
- Cost savings: $2/100 queries = ~$35/month
- Latency improvement: 40-50% faster average response time
- **UX improvement > cost savings**

---

## Risks & Mitigations

### Risk 1: Query Misclassification
**Risk:** Pattern matches "show companies in Ontario that might be good for IRAP"
**Mitigation:** Explicit exclusion patterns for judgment keywords

### Risk 2: Stale Cache
**Risk:** Data changes, cached results become outdated
**Mitigation:** 1-hour TTL, include timestamp in display

### Risk 3: Follow-Up Breaks
**Risk:** User references bypassed data, LLM doesn't have context
**Mitigation:** Context injection for queries with reference words

### Risk 4: Over-Injection
**Risk:** Injecting too much cached data bloats prompt
**Mitigation:** Limit to 3 most recent results, ~3000 tokens max

---

## Rollout Plan

### Phase 1: Pattern Matching Only (Week 1)
- Implement bypass logic for obvious lookups
- No context injection yet
- Monitor: How often does bypass work? How often do follow-ups fail?

### Phase 2: Add Context Injection (Week 2)
- Implement caching layer
- Add context injection for reference queries
- Monitor: Do follow-ups work correctly?

### Phase 3: Expand Patterns (Week 3)
- Add more bypass patterns based on logs
- Fine-tune exclusions
- Monitor: Cost savings, latency improvement, user satisfaction

---

## Success Metrics

**Quantitative:**
- 35% of Oracle queries bypass LLM
- Average latency for bypassed queries: <500ms
- Cost savings: $30-40/month
- Follow-up success rate: >95%

**Qualitative:**
- Oracle feels more responsive
- Users don't notice when bypass happens (seamless)
- Follow-up queries work correctly

---

## Next Steps

1. **Test moderate tier first** (validates that Haiku can handle research)
2. **If moderate tier succeeds:** Implement bypass layer
3. **If moderate tier fails:** Bypass becomes more important (since moderate → complex)

**Priority order:**
1. Moderate tier validation (determines architecture viability)
2. LLM bypass implementation (concrete UX + cost win)
3. Phase 2 agent optimizations (incremental gains)
