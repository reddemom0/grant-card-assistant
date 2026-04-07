# Extended Thinking Optimization Plan (REVISED)

**Date:** February 4, 2026
**Status:** Ready for implementation
**Estimated Savings:** $50-80/month

---

## Problem Identified

**100% of queries use Sonnet + Extended Thinking**, including:
- Greetings: "hi", "hello"
- Continuations: "1", "yes", "continue"
- Simple queries: "show companies"

**Root cause:** Query classifier defaults to "complex" for almost everything

---

## Key Insights from Anthropic Docs

1. **Haiku 4.5 supports extended thinking!** (we can use Haiku + thinking for moderate tasks)
2. **Selective use:** "Use extended thinking for particularly complex tasks that benefit from step-by-step reasoning"
3. **Three-tier strategy is optimal** (not two-tier)

---

## Revised Three-Tier Strategy

### Tier 1: Simple (Haiku, No Thinking)
**Target:** 30-40% of queries

**Patterns:**
- Greetings: `^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|got it)$`
- Short continuations: `^[0-9]{1,2}\.?$` (numbers like "1", "2", "10")
- Simple commands: `^(continue|next|more|go ahead|proceed)$`
- Character threshold: `< 15 chars AND no complex keywords`

**Configuration:**
```javascript
model: 'claude-haiku-4-5',
thinking: undefined,  // No thinking
temperature: 0.3,
maxTokens: 8000,
maxIterations: 6
```

**Cost per query:** ~$0.02

---

### Tier 2: Moderate (Haiku WITH Thinking) ← KEY OPTIMIZATION
**Target:** 40-50% of queries

**Patterns:**
- Writing: `write|create|generate|draft|compose`
- Document review: `review|check|verify` (but NOT audit/compliance)
- Basic analysis: `analyze|assess` + simple subjects
- Summarization: `summarize|summary|extract`
- Eligibility: `eligible|eligibility|qualify` (but NOT for claims audit agent)

**Configuration:**
```javascript
model: 'claude-haiku-4-5',
thinking: {
  type: 'enabled',
  budget_tokens: 4000  // Lower budget for moderate tasks
},
temperature: 1.0,  // Required for thinking
maxTokens: 12000,
maxIterations: 10
```

**Cost per query:** ~$0.04 (cheaper than Sonnet without thinking!)

**Why this works:**
- Haiku + thinking costs less than Sonnet alone
- Docs confirm Haiku 4.5 supports extended thinking
- Good quality for most analysis/writing tasks

---

### Tier 3: Complex (Sonnet WITH Thinking)
**Target:** 10-20% of queries

**Patterns:**
- Deep reasoning: `why|how|explain|reasoning|rationale`
- Complex analysis: `compliance|audit|regulations` + analysis
- Strategic work: `recommend|strategy|should.*consider`
- Multi-step: `and then|after that|first.*then|both.*and`
- Math/coding: Complex calculations, code generation
- Claims auditing: ANY query to canexport-claims agent

**Configuration:**
```javascript
model: 'claude-sonnet-4-5',
thinking: {
  type: 'enabled',
  budget_tokens: 10000  // Full budget for complex reasoning
},
temperature: 1.0,
maxTokens: 16000,
maxIterations: 20
```

**Cost per query:** ~$0.12

---

## Implementation Changes

### File: `src/claude/query-classifier.js`

**1. Add new complexity tiers:**
```javascript
export function classifyQuery(message, agentType) {
  const lowerMessage = message.toLowerCase();

  // Tier 3: COMPLEX (Sonnet + thinking)
  if (isComplexQuery(lowerMessage, agentType)) {
    return 'complex';
  }

  // Tier 2: MODERATE (Haiku + thinking)
  if (isModerateQuery(lowerMessage, agentType)) {
    return 'moderate';
  }

  // Tier 1: SIMPLE (Haiku, no thinking)
  return 'simple';
}
```

**2. Update model selection:**
```javascript
export function getModelForQuery(complexity) {
  if (complexity === 'complex') {
    return 'claude-sonnet-4-5-20250929';
  }

  // Both moderate and simple use Haiku
  return 'claude-haiku-4-5-20251001';
}
```

**3. Update thinking config:**
```javascript
export function getThinkingConfig(complexity) {
  if (complexity === 'simple') {
    return undefined;  // No thinking
  }

  if (complexity === 'moderate') {
    return {
      type: 'enabled',
      budget_tokens: 4000  // Lower budget
    };
  }

  // Complex: full thinking budget
  return {
    type: 'enabled',
    budget_tokens: 10000
  };
}
```

**4. Update iteration limits:**
```javascript
export function getIterationLimit(complexity) {
  if (complexity === 'simple') return 6;
  if (complexity === 'moderate') return 10;
  return 20;  // Complex
}
```

---

## Pattern Definitions

### Simple Patterns
```javascript
const simplePatterns = [
  // Greetings & social
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|got it)$/i,
  /^(good morning|good afternoon|good evening)$/i,

  // Continuations
  /^[0-9]{1,2}\.?$/,  // "1", "2.", "10"
  /^(continue|next|more|go ahead|proceed)$/i,

  // Simple retrieval
  /^(show|list|get|find) (me )?(all |the )?[a-z]+$/i,

  // Status checks
  /^(what|what's|whats) (is )?the status/i,
];

// Also check: < 15 characters AND no complex keywords
```

### Moderate Patterns
```javascript
const moderatePatterns = [
  // Writing
  /\b(write|create|generate|draft|compose)\b/i,

  // Document review (not deep audit)
  /\b(review|check|verify)\b/i,

  // Basic analysis
  /\b(analyze|analyse|assess)\b/i,

  // Summarization
  /\b(summarize|summary|extract|parse)\b/i,

  // Eligibility (general)
  /\b(eligible|eligibility|qualify|qualifies)\b/i,
];
```

### Complex Patterns
```javascript
const complexPatterns = [
  // Deep reasoning
  /\b(why|how|explain|reasoning|rationale)\b/i,

  // Compliance & audit
  /\b(compliance|compliant|audit|regulations?)\b/i,

  // Strategic recommendations
  /\b(recommend|recommendation|strategy|strategic|should.*consider)\b/i,

  // Multi-step operations
  /\b(and then|after that|first.*then|both.*and)\b/i,

  // Comparisons
  /\b(compare|comparison|versus|vs\.|difference)\b/i,
];
```

---

## Expected Results

### Before Fix
- 100% queries: Sonnet + Extended Thinking
- Average cost: $0.12/query
- Monthly: $600 (5000 queries)

### After Fix
- 35% simple (Haiku, no thinking): $0.02 × 1750 = $35
- 45% moderate (Haiku + thinking): $0.04 × 2250 = $90
- 20% complex (Sonnet + thinking): $0.12 × 1000 = $120
- **Monthly total: $245**

### Savings
**$355/month (59% reduction on this component)**

Combined with cache fix + compaction:
- Current baseline: $600/month
- After cache fix: $110/month
- After extended thinking fix: **$55/month**
- After orchestrator (later): **$10-30/month**

---

## Risk Assessment

**Low Risk:**
- Simple queries clearly don't need thinking (greetings, continuations)
- Moderate queries (writing, basic analysis) work well with Haiku + thinking
- Complex queries still get full Sonnet + thinking power

**Testing Plan:**
1. Deploy classification changes
2. Monitor for 24 hours
3. Check for queries misclassified as simple that should be moderate/complex
4. Tune patterns based on real usage

**Easy Rollback:**
- If issues, increase moderate → complex threshold
- All logic in one file (query-classifier.js)

---

## Anthropic Docs Alignment

Our approach follows Anthropic's recommendations:

✅ **"Use extended thinking for particularly complex tasks"** - We reserve it for moderate + complex

✅ **"Task selection: Use extended thinking for complex tasks that benefit from step-by-step reasoning like math, coding, and analysis"** - Our complex tier matches this

✅ **Budget optimization: Start at minimum and increase incrementally** - We use 4000 for moderate, 10000 for complex

✅ **Haiku supports extended thinking** - We leverage this for moderate tier

---

## Next Steps

1. Update `src/claude/query-classifier.js` with three-tier classification
2. Test with sample queries from each tier
3. Deploy and monitor for 24 hours
4. Tune patterns based on real usage
5. Document savings

**Implementation time:** 2 hours
**Expected savings:** $50-80/month immediately

