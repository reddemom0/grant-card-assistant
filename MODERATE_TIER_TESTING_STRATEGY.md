# Moderate Tier Testing Strategy

**Date:** February 4, 2026
**Goal:** Validate whether Haiku+thinking can match Sonnet quality for Oracle's research/enrichment queries
**Hypothesis:** The moderate tier (26% of queries) is where the cost optimization lives—or dies

---

## The Strategic Question

**Current state:** Oracle uses 3-tier classification:
- 35% Simple (lookups) → Haiku, no thinking
- 26% Moderate (research/enrichment) → Haiku + thinking
- 40% Complex (synthesis/strategic) → Sonnet + thinking

**The bet:** Can Haiku+thinking (4000 token budget) handle moderate queries without quality degradation?

**Why this matters:**
- **If YES:** Moderate tier saves $20-30/month, maintains user trust
- **If NO:** Moderate tier must default to complex, losing most of the optimization

---

## Why Moderate Tier is the Risk

### Simple Tier (35%) - Low Risk
- Pure lookups: "show companies", "list leads"
- Minimal reasoning required
- Should be near-instant (potential LLM bypass)
- **Risk: LOW** - Hard to mess up a lookup

### Complex Tier (40%) - Already Using Sonnet
- Synthesis across sources: "combine HubSpot and Drive data"
- Strategic reasoning: "why did they choose competitor?"
- Recommendations: "which leads to prioritize?"
- **Risk: NONE** - Already getting maximum power

### Moderate Tier (26%) - THE UNCERTAIN ONE ⚠️
- Research: "research Acme Corp for CanExport"
- Enrichment: "enrich these 10 leads"
- Analysis: "analyze this prospect for eligibility"
- **Risk: HIGH** - Quality delta could be noticeable

**User's insight:** "If thinking-enabled Haiku can handle even half of what would otherwise escalate to Sonnet, you're meaningfully shifting the cost curve. But if the quality delta is noticeable, you risk users losing trust in Oracle's research outputs."

---

## Testing Approach

### What We're Testing
**12 real moderate-tier queries** covering:
- Research tasks (company background, market info)
- Enrichment tasks (lead data gathering)
- Analysis tasks (eligibility assessment, basic evaluation)

### How We're Testing
**Blind A/B comparison:**
1. Run each query through both Haiku+thinking and Sonnet+thinking
2. Randomize which is "Response A" vs "Response B"
3. Evaluate both on **actionability** without knowing which model
4. Reveal models only after scoring complete

### Why Blind Testing
- Prevents confirmation bias ("I expect Sonnet to be better")
- Forces objective evaluation
- Makes score differences meaningful

---

## The Key Metric: Actionability

**NOT measuring:**
- Completeness (table stakes)
- Accuracy (table stakes)
- Speed (Haiku will obviously be faster)

**MEASURING:**
- **Actionability:** "Would you trust this enough to act on it without checking?"

**Why actionability?**
- User's insight: "Completeness and accuracy are table stakes—the real question is whether the output changes what someone does next."
- This is the trust metric
- If you wouldn't act on it without checking, the quality isn't there

### Scoring Scale
- **5 - Highly Actionable:** Complete, accurate, I'd act immediately
- **4 - Mostly Actionable:** Good quality, might double-check one thing
- **3 - Somewhat Actionable:** Decent but need to verify key points
- **2 - Barely Actionable:** Incomplete/concerning gaps, significant checking needed
- **1 - Not Actionable:** Wrong approach, missing critical info, can't trust

---

## Decision Criteria

Based on evaluation results:

### ✅ SHIP MODERATE TIER
- **Condition:** Haiku avg ≥ 4.0 AND wins/ties ≥ 80%
- **Meaning:** Quality maintained, users can trust it
- **Action:** Keep moderate tier using Haiku+thinking
- **Savings:** $20-30/month

### ⚠️ NEEDS TUNING (The Gray Zone)
- **Condition:** Haiku avg 3.5-4.0 OR wins/ties 70-80%
- **Meaning:** Close but not quite there
- **The Judgment Call:** Good enough to ship with caveats, or not good enough to risk user trust?

**Factors to consider:**
- **User forgiveness:** How tolerant are users of occasional quality gaps?
- **Rollback ease:** Can we easily revert if quality complaints surface?
- **Monitoring capability:** Can we track quality issues in production?
- **Stakes:** Oracle research informs sales decisions - moderate stakes

**Options:**
1. **Ship with monitoring** (if score ≥ 3.7)
   - Deploy moderate tier
   - Add quality monitoring (track follow-up questions, user corrections)
   - Be ready to rollback quickly if issues surface
   - Acceptable risk for ~$20-30/month savings + UX improvement

2. **Increase thinking budget and retest** (if score 3.5-3.7)
   - Bump Haiku thinking from 4000 → 6000 tokens
   - Rerun test with 5-10 boundary cases
   - Cost still lower than Sonnet ($0.05 vs $0.12)

3. **Split moderate tier** (if score 3.5-3.7)
   - Create "moderate-light" (pure research, Haiku 4k) vs "moderate-heavy" (research+judgment, Haiku 6k or Sonnet)
   - Tighten moderate-light patterns to exclude boundary cases

4. **Default to complex** (if score < 3.5)
   - Conservative approach
   - Moderate tier queries use Sonnet
   - Focus optimization effort on bypass layer instead

### ❌ DEFAULT TO COMPLEX
- **Condition:** Haiku avg < 3.5 OR wins/ties < 70%
- **Meaning:** Quality gap too large, users would notice
- **Action:** Moderate tier queries default to complex (Sonnet)
- **Impact:** Lose most of the moderate tier optimization

---

## What We're Looking For

When evaluating each response pair:

1. **Appropriate Information Sources**
   - Did it identify the right tools to use?
   - Are the data sources relevant?

2. **Complete Tool Usage**
   - Are all necessary tools called?
   - Are tool inputs correct and complete?

3. **Sensible Approach**
   - Does the reasoning make sense?
   - Would the approach answer the query?

4. **Useful Output** (if tools were executed)
   - Would the results be actionable?
   - Is anything critical missing?

---

## Running the Test

### Step 1: Execute Test Harness
```bash
cd /Users/Chris/grant-card-assistant
node scripts/test-moderate-tier-quality.js
```

This will:
- Run 15 moderate queries through both models (30 API calls total)
- Save results to `/Users/Chris/Downloads/moderate-tier-test-results.json`
- Take ~15-20 minutes (3s rate limiting + API latency variance)

### Step 2: Blind Evaluation
1. Open `scripts/evaluate-moderate-tier-results.html` in browser
2. Load the results JSON file
3. Score each response pair on actionability (1-5)
4. Review statistics when all scored

### Step 3: Make Decision
Based on scores:
- **Ship it:** If Haiku maintains quality
- **Tune it:** If close but needs adjustment
- **Complex default:** If quality gap is significant

---

## Beyond Cost: The UX Win

**User's insight:** "The $35/month savings is real but modest. The bigger win is latency—direct tool execution should be near-instant versus 2-3 seconds through the LLM. That UX improvement probably matters more than the cost."

**For moderate tier specifically:**
- Haiku is ~40-60% faster than Sonnet
- For research queries, speed matters
- "Research this company" → 1.5 seconds vs 3 seconds
- Better UX even if cost savings are modest

---

## Future Optimizations (If Moderate Tier Succeeds)

### LLM Bypass for Simple Tier
- Pattern match obvious lookups
- Execute tools directly (no LLM)
- Savings: $35/month + near-instant responses
- **Challenge:** Maintain conversation context

### Hybrid Classification
- Obvious bypass: Instant ($0)
- Ambiguous queries: Cheap Haiku classification ($0.005)
- Economics: Save $1.90 per 100 queries

### Conversation Context Preservation
- Even bypassed queries save to conversation state
- Cache tool results for follow-up queries
- Accept that bypassed queries can't handle complex follow-ups

---

## Success Metrics

**Cost optimization:**
- Current Oracle costs: ~$60/month (5000 queries × avg $0.12)
- Target with moderate tier: ~$40/month (33% reduction)
- If bypass implemented: ~$30/month (50% reduction)

**Quality maintenance:**
- Actionability scores ≥ 4.0
- User trust maintained
- No increase in follow-up questions

**UX improvement:**
- 40-60% faster response time for moderate queries
- Near-instant for simple lookups (if bypassed)
- Oracle feels more responsive

---

## Next Steps

1. **Run the test** (scripts/test-moderate-tier-quality.js)
2. **Blind evaluate** (scripts/evaluate-moderate-tier-results.html)
3. **Make decision** based on data
4. **If successful:** Proceed to Phase 2 agent optimizations (ETG, CanExport, etc.)
5. **If needs tuning:** Adjust thinking budgets and retry
6. **If fails:** Revert moderate tier to complex, focus on bypass optimization instead

---

**The Bottom Line:**

This test determines whether the entire 3-tier classification strategy holds for Oracle. If moderate tier can't maintain quality with Haiku+thinking, we'll know to be more conservative with other agents.

**Testable hypothesis validated with data > assumptions about what "should" work.**
