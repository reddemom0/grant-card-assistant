# Agent-Specific Model Optimization Strategy

**Date:** February 4, 2026
**Goal:** Determine which agents should use Haiku vs Sonnet based on their complexity requirements
**Approach:** Agent-aware classification instead of one-size-fits-all

---

## Executive Summary

Current 3-tier classification applies universally to all agents. However, different agents have fundamentally different complexity profiles:

- **Compliance agents** (canexport-claims): ALWAYS need maximum precision → Sonnet
- **Research agents** (internal-oracle): Mostly lookups and synthesis → Haiku capable
- **Writing agents** (etg-writer, canexport-writer): Strategic work needs Sonnet, drafting could use Haiku
- **Program-specific writers** (bcafe, buybc): Clear criteria allow Haiku for many tasks

**Opportunity:** Further cost optimization by tailoring model selection to agent capabilities and risk tolerance.

---

## Agent Analysis Matrix

### 🔴 TIER S: Always Sonnet (Compliance-Critical)

#### 1. canexport-claims (Claims Auditor)
**Current:** Already defaults to 'complex' (line 88-90 in query-classifier.js) ✅

**Why Always Sonnet:**
- **High-stakes compliance:** Wrong audits = financial penalties, reputational damage
- **Regulatory precision:** Must catch subtle compliance violations
- **Multi-document cross-referencing:** Funding agreements, invoices, receipts
- **Zero-error tolerance:** Claims auditing requires maximum accuracy

**Complexity Profile:**
- 95% of queries require deep reasoning
- Even "simple" questions like "is this eligible?" need funding agreement analysis
- Multi-step verification against program rules

**Recommendation:** KEEP current behavior (always 'complex')

---

#### 2. readiness-strategist (Grant Readiness Assessments)
**Current:** Uses universal 3-tier classification

**Why Should Default to Sonnet:**
- **Strategic assessment:** Requires deep understanding of client situation
- **Recommendation generation:** "Should they apply?" needs reasoning
- **Multi-grant comparison:** Comparing opportunities requires synthesis
- **High client value:** Readiness assessments sold as premium service
- **Document generation:** Creates 4-document packages requiring consistency

**Complexity Profile:**
- 80% strategic work requiring deep reasoning
- 15% moderate (drafting sections after strategy set)
- 5% simple (status checks, continuations)

**Recommendation:** Agent should default to 'complex' unless explicit simple patterns

**Proposed Override:**
```javascript
// In classifyQuery()
if (agentType === 'readiness-strategist') {
  // Only use simple for greetings/continuations
  if (isGreetingOrContinuation(lowerMessage)) return 'simple';

  // Everything else is complex (strategic work)
  return 'complex';
}
```

---

### 🟡 TIER A: Mostly Sonnet (Strategic Writing)

#### 3. canexport-writer (CanExport Application Writer)
**Current:** Uses universal 3-tier classification

**Why Mostly Sonnet:**
- **Strategic consulting:** Supports Granted team with strategic guidance
- **Application strategy:** "Should client pursue this?" requires reasoning
- **Compliance awareness:** Must understand program requirements deeply
- **Multi-step applications:** Coordinating across multiple application phases
- **Client-facing deliverables:** High quality bar

**When Haiku Could Work:**
- Simple lookups: "What's the CanExport deadline?"
- Retrieval tasks: "Find the budget template"
- Continuations in established workflow

**Complexity Profile:**
- 70% complex (strategy, recommendations, compliance)
- 20% moderate (drafting after strategy set)
- 10% simple (lookups, continuations)

**Recommendation:** Default to 'complex' but allow moderate for drafting tasks

**Proposed Override:**
```javascript
if (agentType === 'canexport-writer') {
  if (isComplexQuery(lowerMessage, agentType)) return 'complex';

  // Drafting/writing tasks can use moderate
  if (/\b(draft|write|create section)\b/i.test(lowerMessage)) return 'moderate';

  if (isSimpleQuery(lowerMessage, agentType)) return 'simple';

  // Default to complex for strategic work
  return 'complex';
}
```

---

#### 4. etg-writer (ETG Business Case Specialist)
**Current:** Uses universal 3-tier classification

**Why Mostly Sonnet:**
- **Competitive analysis:** Researching BC training alternatives requires reasoning
- **Strategic positioning:** "Why is this training better?" needs deep thinking
- **"Better job" outcome definitions:** Complex eligibility analysis
- **Business case argumentation:** Persuasive writing requires strategic thinking
- **Multi-step workflow:** Eligibility → Q1-3 → Alternatives → Q4-7

**When Haiku Could Work:**
- Eligibility checks (straightforward yes/no after loading rules)
- Budget calculations (mathematical, not strategic)
- Drafting sections after strategy established

**Complexity Profile:**
- 65% complex (competitive analysis, strategic recommendations)
- 25% moderate (drafting, eligibility checks)
- 10% simple (lookups, continuations)

**Recommendation:** Allow moderate for drafting and eligibility

**Proposed Override:**
```javascript
if (agentType === 'etg-writer') {
  if (isComplexQuery(lowerMessage, agentType)) return 'complex';

  // Eligibility and drafting can use moderate
  if (/\b(eligible|eligibility|check.*requirements|draft section)\b/i.test(lowerMessage)) {
    return 'moderate';
  }

  if (isSimpleQuery(lowerMessage, agentType)) return 'simple';

  // Default to complex for competitive analysis and strategy
  return 'complex';
}
```

---

#### 5. grant-card-generator (Grant Intelligence Analyst)
**Current:** Uses universal 3-tier classification

**Why Mostly Sonnet:**
- **Multi-task specialist:** 7 different task types with varying complexity
- **Document extraction:** Analyzing grant documents requires precision
- **Strategic insights:** "Granted Insights" require competitive intelligence
- **Gap analysis:** "Missing Info" requires reasoning about what's absent
- **Client-facing output:** Grant cards are public-facing, high quality bar

**When Haiku Could Work:**
- Simple extraction tasks (deadline, funding amount)
- Preview generation (straightforward summarization)
- Categories/tags (classification task)

**Complexity Profile (by task type):**
- **Complex (Sonnet):** Grant Criteria (full analysis), Granted Insights (strategic), Missing Info (gap analysis)
- **Moderate (Haiku + thinking):** Preview, Requirements, Categories
- **Simple (Haiku):** Lookups, continuations

**Recommendation:** Task-aware classification

**Proposed Override:**
```javascript
if (agentType === 'grant-card-generator') {
  // Complex tasks always need Sonnet
  if (/\b(grant criteria|granted insights|missing info|gap analysis)\b/i.test(lowerMessage)) {
    return 'complex';
  }

  // Moderate tasks can use Haiku + thinking
  if (/\b(preview|requirements|categories|tags)\b/i.test(lowerMessage)) {
    return 'moderate';
  }

  // Use standard classification for other queries
  if (isComplexQuery(lowerMessage, agentType)) return 'complex';
  if (isSimpleQuery(lowerMessage, agentType)) return 'simple';

  // Default to moderate (most extraction tasks)
  return 'moderate';
}
```

---

### 🟢 TIER B: Balanced (Can Use Haiku for Many Tasks)

#### 6. bcafe-writer (BC Agriculture Export Specialist)
**Current:** Uses universal 3-tier classification

**Why Haiku Works for Many Tasks:**
- **Clear program criteria:** BCAFE has well-documented requirements
- **Structured application:** Following established templates
- **Eligibility verification:** Straightforward checklist-based
- **Merit optimization:** Formula-driven (weighted criteria)

**When Sonnet Needed:**
- Strategic recommendations: "Should client pursue Stream 1 or 2?"
- Competitive market analysis: "How does this compare to competitors?"
- Complex eligibility edge cases: "Does this activity qualify?"

**Complexity Profile:**
- 40% complex (strategy, competitive analysis)
- 45% moderate (application drafting, merit optimization)
- 15% simple (eligibility lookups, continuations)

**Recommendation:** Default to 'moderate' instead of 'complex'

**Proposed Override:**
```javascript
if (agentType === 'bcafe-writer') {
  // Strategic work needs Sonnet
  if (/\b(recommend|strategy|should.*pursue|competitive analysis)\b/i.test(lowerMessage)) {
    return 'complex';
  }

  // Standard classification for other patterns
  if (isComplexQuery(lowerMessage, agentType)) return 'complex';
  if (isSimpleQuery(lowerMessage, agentType)) return 'simple';

  // Default to moderate (most work is structured application writing)
  return 'moderate';
}
```

---

#### 7. buybc-writer (Buy BC Partnership Specialist)
**Current:** Uses universal 3-tier classification

**Why Haiku Works for Many Tasks:**
- **Structured program:** Clear eligibility and merit criteria
- **Template-based:** Following established application format
- **First-come, first-served:** Less competitive analysis needed
- **Clear cost-share formulas:** Mathematical, not strategic

**When Sonnet Needed:**
- Strategic positioning for merit criteria (40% weighted work plan)
- Competitive differentiation
- Complex edge case eligibility

**Complexity Profile:**
- 35% complex (strategic merit optimization)
- 50% moderate (application writing, work plan drafting)
- 15% simple (eligibility checks, lookups)

**Recommendation:** Default to 'moderate' instead of 'complex'

**Proposed Override:**
```javascript
if (agentType === 'buybc-writer') {
  // Strategic merit optimization needs Sonnet
  if (/\b(merit|work plan|competitive|differentiat.*)\b/i.test(lowerMessage)) {
    return 'complex';
  }

  // Standard classification
  if (isComplexQuery(lowerMessage, agentType)) return 'complex';
  if (isSimpleQuery(lowerMessage, agentType)) return 'simple';

  // Default to moderate (structured application work)
  return 'moderate';
}
```

---

### 🔵 TIER C: Mostly Haiku (Research & Retrieval)

#### 8. internal-oracle (Knowledge Base & Research)
**Current:** Uses universal 3-tier classification

**Why Haiku Works for Most Tasks:**
- **Primary use case: Lookups** ("Find companies in HubSpot", "Show grant deadlines")
- **Research tasks:** Web search + synthesis (Haiku handles this well)
- **Lead enrichment:** Gathering company data from web sources
- **Document retrieval:** Finding files in Google Drive, HubSpot
- **Simple synthesis:** Combining data from multiple sources

**When Sonnet Needed:**
- Deep strategic analysis: "Why did this client choose competitor?"
- Complex recommendations: "Should we pursue this market segment?"
- Multi-step reasoning across many data sources

**Complexity Profile:**
- 20% complex (strategic analysis, deep reasoning)
- 35% moderate (research + synthesis, lead enrichment)
- 45% simple (lookups, retrieval, basic searches)

**Recommendation:** Default to 'moderate' or 'simple' based on query

**Proposed Override:**
```javascript
if (agentType === 'internal-oracle') {
  // Only use Sonnet for explicit strategic/reasoning queries
  if (isComplexQuery(lowerMessage, agentType)) return 'complex';

  // Research and synthesis can use Haiku + thinking
  if (/\b(research|find|enrich|analyze|synthesize)\b/i.test(lowerMessage)) {
    return 'moderate';
  }

  // Most lookups are simple
  if (/\b(show|list|get|what is|who is|where is)\b/i.test(lowerMessage)) {
    return 'simple';
  }

  // Default to simple (most queries are retrieval)
  return 'simple';
}
```

---

#### 9. orchestrator (Multi-Agent Coordinator)
**Current:** New agent, not in production yet

**Why Mostly Haiku:**
- **Planning tasks:** Breaking down work into subtasks (moderate complexity)
- **Delegation:** Choosing which agent to use (straightforward logic)
- **Synthesis:** Combining agent outputs (moderate synthesis)

**When Sonnet Needed:**
- Complex workflow orchestration with many dependencies
- Strategic decision-making about approach
- Deep cross-agent reasoning

**Complexity Profile:**
- 30% complex (complex workflow planning)
- 50% moderate (planning, synthesis)
- 20% simple (status, continuations)

**Recommendation:** Default to 'moderate'

**Proposed Override:**
```javascript
if (agentType === 'orchestrator') {
  // Complex workflows need Sonnet
  if (/\b(complex.*workflow|multi.*step.*strategy)\b/i.test(lowerMessage)) {
    return 'complex';
  }

  // Standard classification
  if (isComplexQuery(lowerMessage, agentType)) return 'complex';
  if (isSimpleQuery(lowerMessage, agentType)) return 'simple';

  // Default to moderate (most orchestration is planning + synthesis)
  return 'moderate';
}
```

---

## Implementation Strategy

### Phase 1: Conservative Overrides (Immediate)

Add agent-specific overrides for the clearest cases:

1. **canexport-claims** - Already done ✅
2. **readiness-strategist** - Default to complex
3. **internal-oracle** - Default to simple/moderate

**Impact:** $20-30/month savings (Oracle is heavily used)

---

### Phase 2: Strategic Agents (Week 2)

Add overrides for strategic writing agents:

4. **canexport-writer** - Default complex, allow moderate for drafting
5. **etg-writer** - Default complex, allow moderate for drafting

**Impact:** $10-15/month savings

---

### Phase 3: Program-Specific Writers (Week 3)

Add overrides for program-specific agents:

6. **bcafe-writer** - Default to moderate
7. **buybc-writer** - Default to moderate
8. **grant-card-generator** - Task-aware classification

**Impact:** $15-20/month savings

---

## Total Projected Savings

**Current state after 3-tier fix:**
- Universal classification: $245/month

**After agent-specific optimization:**
- Tier S agents (20% of queries): $0.12 × 1000 = $120
- Tier A agents (25% of queries): $0.08 × 1250 = $100 (mix of complex/moderate)
- Tier B agents (30% of queries): $0.04 × 1500 = $60
- Tier C agents (25% of queries): $0.03 × 1250 = $38 (mix of moderate/simple)

**Total: $318/month → Savings: ~$27/month additional**

**Combined with 3-tier fix: $600 → $218/month (64% reduction)**

---

## Risk Assessment

**Low Risk:**
- Oracle default to simple/moderate: Very low risk (mostly lookups)
- Program writers default to moderate: Low risk (clear criteria)

**Medium Risk:**
- Strategic agents allowing moderate: Monitor quality on drafting tasks
- Grant card generator task-aware: Test across all 7 task types

**High Risk:**
- Readiness strategist: Keep complex for now (high client value)
- Claims auditor: Already correctly set to complex

---

## Monitoring Plan

For each agent override:

1. **Deploy** agent-specific override
2. **Monitor** for 48 hours:
   - Check logs for classification distribution
   - Review response quality (spot-check 5-10 responses)
   - Watch for user feedback/corrections
3. **Tune** patterns based on observations
4. **Measure** cost impact vs baseline

---

## Next Steps

1. Implement Phase 1 overrides (readiness-strategist, internal-oracle)
2. Test with sample queries for each agent
3. Deploy and monitor for 48 hours
4. Proceed to Phase 2 if quality maintained

**Implementation time:** 2-3 hours per phase
**Expected savings:** $20-30/month immediately (Phase 1)
