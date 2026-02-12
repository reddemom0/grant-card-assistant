# Extended Thinking Optimization Plan

**Problem:** Extended thinking is enabled for 100% of queries, including greetings and simple continuations

**Impact:** Wasting $50-80/month on unnecessary thinking tokens

---

## Current State

Looking at logs, ALL queries classified as "complex":
- Greetings: "hi", "hello", "who are you?"
- Short continuations: "1", "4.", "yes"
- Simple questions: "show me companies"

**Why?** Classifier defaults to "complex" when uncertain (conservative approach)

---

## The Fix

### Add More "Simple" Patterns

**Greetings & Social:**
```javascript
/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure)$/i
/^(good morning|good afternoon|good evening)$/i
```

**Short Continuations:**
```javascript
/^[0-9]{1,2}\.?$/  // Numbers like "1", "2.", "10"
/^(continue|next|more|go ahead|proceed)$/i
```

**Simple List Requests:**
```javascript
/^(show|list|get|find) (me )?(all |the )?[a-z]+$/i
// Matches: "show companies", "list clients", "get leads"
```

**Character Count Threshold:**
- Queries under 15 characters AND no complex keywords → simple
- Exception: Don't downgrade queries with "analyze", "evaluate", "why", etc.

---

## Implementation

**File:** `src/claude/query-classifier.js`

**Changes:**
1. Add greeting patterns to `simplePatterns`
2. Add continuation patterns
3. Add character count check
4. Keep complex patterns as-is (they're good)

**Expected Result:**
- 30-40% of queries classified as "simple"
- Use Haiku (no extended thinking) for:
  - Greetings
  - Short responses
  - Simple data retrieval
- Keep Sonnet + Extended Thinking for:
  - Analysis
  - Writing
  - Complex reasoning

---

## Projected Savings

**Current:**
- 100% queries use extended thinking
- Thinking tokens: ~2000-5000 per complex query
- Cost: ~$0.10-0.25 extra per query

**After fix:**
- 60-70% queries use extended thinking (only when needed)
- 30-40% queries use Haiku (no thinking)
- Savings: $50-80/month

---

## Risk Assessment

**Low risk:**
- Simple queries (greetings, lists) don't need deep thinking
- Complex queries still get full power
- Easy to tune if we're too aggressive

**Testing:**
- Monitor for queries that should be complex but get classified as simple
- Adjust patterns based on real usage
- No impact on quality for truly complex work

