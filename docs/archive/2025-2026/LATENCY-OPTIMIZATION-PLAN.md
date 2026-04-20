# Latency Optimization Plan - CanExport Claims Agent

**Current Performance:** 62.4s for simple status check query
**Target Performance:** <15s for simple queries

---

## Current Configuration

```javascript
// src/claude/client.js:26
const MODEL = 'claude-sonnet-4-20250514'; // Sonnet 4.5
const MAX_TOKENS = 16000;
const THINKING_BUDGET = 10000;
// No temperature setting (defaults to 1.0)
// Streaming: enabled ✓
```

---

## Optimization Strategy (Anthropic Best Practices + Architectural Fixes)

### ⚡ TIER 1: Quick Wins (70% latency reduction)

#### 1.1 **Use Claude Haiku 4.5 for Simple Queries**
**Impact:** 50-70% faster per API call
**Effort:** Low

**Current:** All queries use Sonnet 4.5 (slower, more capable)
**Optimized:** Route queries by complexity

```javascript
// Add query classification
function getModelForQuery(message, agentType) {
  // Simple queries → Haiku 4.5 (much faster)
  const simplePatterns = [
    /has .* been approved/i,
    /what is the status/i,
    /when .* submitted/i,
    /find .* application/i,
    /show me .* deal/i,
  ];

  // Complex queries → Sonnet 4.5 (more capable)
  const complexPatterns = [
    /audit/i,
    /analyze/i,
    /review .* claim/i,
    /check .* eligibility/i,
  ];

  const isSimple = simplePatterns.some(p => p.test(message));
  const isComplex = complexPatterns.some(p => p.test(message));

  if (isSimple && !isComplex) {
    return 'claude-haiku-4-5'; // 3-5x faster
  }

  return 'claude-sonnet-4-20250514'; // Default to quality
}

// In runAgent():
const model = getModelForQuery(message, agentType);
const stream = await anthropic.messages.create({
  model: model,
  // ...
});
```

**Expected Improvement:**
- Status checks: 62s → 25s (60% faster)
- Complex audits: No change (still use Sonnet)

---

#### 1.2 **Fix Memory Tool Error**
**Impact:** Save 4.5s + 2 wasted iterations
**Effort:** Low

**Current Error:**
```
"error": "EISDIR: illegal operation on a directory, read"
```

**Location:** src/tools/memory.js - the `view` command with path `/memories`

**Fix:** The tool is trying to read `/memories` as a file, but it's a directory. Need to:
1. List files in directory, or
2. Return an error message that guides the agent properly

```javascript
// Example fix in memory.js
if (command === 'view') {
  if (path === '/memories') {
    // Don't try to read a directory - return structure instead
    return {
      success: true,
      message: 'Use view with specific file path like /memories/key_name',
      type: 'directory'
    };
  }
  // ... existing file read logic
}
```

---

#### 1.3 **Optimize Search Strategy in Agent Prompt**
**Impact:** Reduce 7 searches → 2 searches (save 5 iterations = ~20s)
**Effort:** Low

**Current:** Agent tries random variations until it finds the right company name

**Fix:** Add explicit search strategy to agent system prompt:

```markdown
## HubSpot Search Strategy

When searching for grant applications by company name:

1. **FIRST**: Use `search_hubspot_companies` to find the exact company name in HubSpot
   - Example: User asks about "Seagate" → Search companies → Get "Seagate Mass Timber Inc."

2. **THEN**: Use that exact name in `search_grant_applications`
   - Use the exact company name from step 1, not variations
   - This ensures you find all applications for that company

DO NOT:
- Try multiple company name variations
- Search without the company name first
- Assume the user's company name exactly matches HubSpot's format
```

**Expected Improvement:**
- 7 searches → 2 searches (5 fewer iterations)
- ~20s time savings

---

#### 1.4 **Reduce Output Verbosity**
**Impact:** Reduce token count growth, faster subsequent calls
**Effort:** Low

**Current:** max_tokens=16000, no temperature setting, no output guidance

**Fix:**
```javascript
// Add temperature for more focused responses
const stream = await anthropic.messages.create({
  model: model,
  max_tokens: 8000, // Reduce from 16000 for simple queries
  temperature: 0.3, // Lower = more focused, less verbose (default: 1.0)
  // ...
});
```

**Also add to system prompt:**
```markdown
## Response Guidelines

- Be concise and direct
- For status checks: state the answer in 2-3 sentences
- Only include relevant details
- Avoid repeating information
```

---

### 🔧 TIER 2: Medium-term Improvements (additional 15-20% reduction)

#### 2.1 **Truncate Large Tool Results**
**Impact:** Prevent token explosion (19k → ~5k)
**Effort:** Medium

**Current:** When search returns 50 applications, all 50 are added to conversation

**Fix:**
```javascript
// In src/tools/executor.js or tool definitions
function truncateToolResult(result, toolName, maxItems = 10) {
  if (toolName === 'search_grant_applications' && result.applications) {
    const apps = result.applications;
    if (apps.length > maxItems) {
      return {
        ...result,
        applications: apps.slice(0, maxItems),
        truncated: true,
        totalCount: apps.length,
        message: `Showing top ${maxItems} of ${apps.length} results. Refine search if needed.`
      };
    }
  }
  return result;
}
```

---

#### 2.2 **Add Fuzzy Company Name Matching**
**Impact:** First search attempt succeeds more often
**Effort:** Medium

**Current:** "Seagate Mass Timber" doesn't match "Seagate Mass Timber Inc."

**Fix:** Pre-process company names in HubSpot searches:
```javascript
function fuzzyCompanyMatch(userInput) {
  // Remove common suffixes
  return userInput
    .replace(/\s+(Inc\.?|LLC|Ltd\.?|Corporation|Corp\.?)$/i, '')
    .trim();
}
```

---

#### 2.3 **Implement Conversation Pruning**
**Impact:** Keep token count manageable
**Effort:** Medium

**Current:** Full conversation history grows unbounded (333 → 19,501 tokens)

**Fix:** Keep only last N tool calls + results:
```javascript
// After each iteration, prune old tool results
function pruneConversationHistory(messages, keepLast = 5) {
  // Keep user message + last N assistant/tool exchanges
  // Remove old tool_use/tool_result pairs from middle
  // Always keep system prompt cached
}
```

---

### 🚀 TIER 3: Advanced Improvements (Future)

#### 3.1 **Multi-Tool Requests**
**Impact:** Reduce iterations by 50%
**Effort:** High (requires Claude API feature or prompt engineering)

**Concept:** Allow agent to request multiple tools in one turn
```javascript
// Instead of:
// Turn 1: search_companies("Seagate")
// Turn 2: search_applications("Seagate Mass Timber Inc.")

// Do:
// Turn 1: [search_companies("Seagate"), search_applications(use_result_from_first)]
```

---

#### 3.2 **Result Caching**
**Impact:** Instant responses for repeated queries
**Effort:** Medium

**Implementation:** Cache HubSpot results in Redis for 5-10 minutes
```javascript
// Before HubSpot API call:
const cacheKey = `hubspot:${toolName}:${hash(params)}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

// After HubSpot API call:
await redis.setex(cacheKey, 300, JSON.stringify(result));
```

---

## Implementation Priority

### Phase 1: Immediate (This Week)
1. ✅ Fix memory tool EISDIR error
2. ✅ Add search strategy to agent prompt
3. ✅ Add model routing (Haiku vs Sonnet)
4. ✅ Set temperature=0.3 for focused responses

**Expected: 62s → 17s (73% faster)**

### Phase 2: Short-term (Next Week)
5. Truncate large tool results
6. Add fuzzy company matching
7. Implement conversation pruning

**Expected: 17s → 12s (additional 30% faster)**

### Phase 3: Future
8. Multi-tool requests
9. Result caching

**Expected: 12s → 8s (additional 33% faster)**

---

## Measurement Plan

Track these metrics for each query:
```javascript
{
  totalDuration: 62400,
  iterations: 12,
  modelUsed: 'claude-sonnet-4-20250514',
  totalInputTokens: 19501,
  totalOutputTokens: 2000,
  toolCalls: {
    search_grant_applications: 7,
    search_hubspot_companies: 1,
    get_grant_application: 1,
    memory: 2
  },
  hubspotDuration: 3600,
  claudeDuration: 55500
}
```

Log this to database for tracking improvements over time.

---

## Success Criteria

**Simple Queries (status checks, lookups):**
- Target: <15s (currently 62s)
- Model: Haiku 4.5
- Max iterations: 4

**Complex Queries (audits, analysis):**
- Target: <30s
- Model: Sonnet 4.5
- Max iterations: 8

**Token Management:**
- Input tokens should not exceed 10k per query
- Conversation history capped at 20k tokens
