# Lead-Gen Search Flow Analysis

## The Mismatch: Agent Expectations vs Infrastructure Reality

### What the Agent THINKS It's Doing

**From `.claude/agents/lead-gen.md` lines 83-98:**

```
When calling search_getgranted to build the estimate, ALWAYS call it twice:

Call 1: Active programs only (default behavior)
search_getgranted({ query: [activities], regions: [region] })

Call 2: Include inactive programs
search_getgranted({ query: [activities], regions: [region], include_inactive: true })

Use both results to present a 12-month funding outlook:
"Right now there are [N] active programs you could apply for, worth roughly $[X].
Over the next 12 months, based on programs that cycle through your region and industry,
you're looking at closer to $[Y] across [M] total programs."
```

**Agent's Mental Model:**
1. I manually build a query from the prospect's activities
2. I call search_getgranted with my query + region
3. I get back raw results
4. I need to count them, classify them (active/cyclical/inactive), calculate totals
5. I call it again with include_inactive: true for the 12-month view
6. I present both views to the prospect

---

### What the Infrastructure ACTUALLY Does

**From `src/tools/executor.js` lines 742-832:**

```javascript
if (agentType === 'lead-gen' && conversationId) {
  console.log('\n🏗️  INFRASTRUCTURE-ENHANCED SEARCH STARTING...');

  // Step 1: Build prospect data from session (NOT from agent's query parameter!)
  const prospectData = await buildProspectDataFromSession(conversationId);

  // Step 2: Categorize prospect (determine industry group, revenue tier, tier)
  categorization = categorizeProspect(prospectData);

  // Step 3: Run focused search using categorization
  //         - Builds its OWN queries (hiring, training, market expansion, R&D)
  //         - Calls search multiple times for different categories
  //         - Applies smart_tags scoring, intent hierarchy, activity boost, diversity cap
  //         - Applies eligibility penalties
  //         - Returns top 10 scored programs
  const searchResults = await runFocusedSearch(
    categorization,
    async (searchParams) => {
      return await searchGetGranted({
        query: searchParams.query,        // ← Infrastructure-built query, NOT agent's!
        purposes: searchParams.purposes,
        regions: [searchParams.province],
        industries: [],
        active_only: input.active_only,   // ← Agent's parameter IS used here
        // ... but everything else is ignored
      });
    },
    conversationId,
    prospectData  // For eligibility scoring
  );

  // Step 4: Merge baseline estimate with search results
  mergedEstimate = mergeEstimate(categorization, searchResults);

  // Step 5: Store categorization + estimate in conversation_memory

  // Step 6: Auto-capture grant names for HubSpot

  // Step 7: Format result for agent
  result = {
    success: true,
    grants: searchResults.programs_found.map(p => ({
      grant_name: p.grant_name,
      grant_amount: p.max_grant_amount,
      currently_accepting: p.currently_accepting,  // ← Pre-classified!
      intake_cycle: p.intake_cycle,                // ← Pre-classified!
      description: p.description,
      purposes: p.purposes,
      categories: p.categories
    })),
    count: searchResults.programs_found.length,
    message: `Found ${searchResults.programs_found.length} programs using infrastructure-enhanced search`
  };
}
```

**Infrastructure's Actual Behavior:**
1. ✅ Intercepts the agent's search_getgranted call
2. ❌ **IGNORES** the agent's query parameter entirely
3. ✅ Builds prospectData from session (revenue, employees, hiring plans, etc.)
4. ✅ Runs categorizeProspect() to determine industry group and baseline estimate
5. ✅ Runs runFocusedSearch() which:
   - Builds its own queries ("hiring manufacturing", "training manufacturing", etc.)
   - Calls search multiple times for different categories
   - Applies smart_tags scoring (intent match, genre match, funding amount)
   - Applies intent hierarchy bonus (+6 for Innovation, +5 for Markets, +3 for Training, +0 for Hiring)
   - Applies activity text keyword boost (+2-6 for matching planned_activities)
   - Applies eligibility penalties (-10 for revenue/incorporation, -8 for employees, etc.)
   - Applies diversity cap (max 3 per program family)
   - Returns TOP 10 scored and ranked programs
6. ✅ Stores categorization + merged_estimate in conversation_memory
7. ✅ Returns pre-scored, pre-filtered, pre-classified results to agent

---

## The Result: Complete Disconnect

### What Happens When Agent Calls search_getgranted

**Agent's Call:**
```javascript
search_getgranted({
  query: "hiring training expansion",
  regions: ["British Columbia"]
})
```

**What Infrastructure Does:**
```
🏗️  INFRASTRUCTURE-ENHANCED SEARCH STARTING...
  ✅ Built prospect data from session
  🏷️  Running categorization...
  ✅ Industry: Manufacturing → Group 2 (default match)
  ✅ Baseline estimate: $45K–$89K
  ✅ Service tier: starter (revenue < $1M, employees < 10)
  ✅ Grant categories: ["Hiring Programs", "Training Programs"]
  🔍 Running focused search...

  Search 1: Hiring Programs
    Query: "hiring manufacturing"  ← Infrastructure-built, NOT agent's!
    Results: 23 programs

  Search 2: Training Programs
    Query: "training manufacturing"  ← Infrastructure-built, NOT agent's!
    Results: 15 programs

  📊 Total unique programs: 28
  ✅ After amount filtering: 24 programs

  Scoring all 24 programs:
    - Base category matching: +3
    - Currently accepting: +2
    - Company size fit: +1
    - Smart tag boost: +0-15
    - Intent hierarchy: +0-6
    - Activity keyword boost: +0-6
    - Eligibility penalties: -0 to -10

  🎯 Applying diversity cap (max 3 per family in top 10)...
      🚫 Diversity cap: "SWPP - Magnet" pushed to #11 (SWPP family limit reached)
      🚫 Diversity cap: "SWPP - Riipen" pushed to #12 (SWPP family limit reached)

  Top 10 programs (by relevance_score):
    1. BC Employer Training Grant (score: 17)
    2. Canada-BC Job Grant (score: 14)
    3. SWPP - Venture for Canada (score: 14)
    4. SWPP - Palette Skills (score: 14)
    5. SWPP - Career Launcher (score: 13)
    6. Canada Summer Jobs (score: 11)
    7. CanExport SME (score: 10)
    8. Digital Adoption Program (score: 9)
    9. IRAP (score: 15) ← Innovation +6 intent hierarchy
    10. Mitacs Accelerate (score: 8)

✅ INFRASTRUCTURE-ENHANCED SEARCH COMPLETE
```

**What Agent Receives:**
```json
{
  "success": true,
  "grants": [
    {
      "grant_name": "BC Employer Training Grant",
      "grant_amount": "$10,000",
      "currently_accepting": true,
      "intake_cycle": "Year-round",
      "description": "...",
      "purposes": ["Training"],
      "categories": ["Skills Training"]
    },
    // ... 9 more programs (already scored, filtered, diversified)
  ],
  "count": 10,
  "message": "Found 10 programs using infrastructure-enhanced search"
}
```

---

## The Problem: Agent Doesn't Know

**The agent THINKS:**
- "I called search with my query and got 10 results"
- "I should call it again with include_inactive: true to get the 12-month view"
- "I need to count and classify these programs myself"
- "I need to calculate the funding totals myself"

**The agent DOESN'T KNOW:**
- The infrastructure ignored my query parameter completely
- The infrastructure already ran categorization and baseline estimation
- The infrastructure already ran focused search across multiple categories
- The infrastructure already scored, filtered, and ranked everything
- The infrastructure already applied diversity caps
- These are the TOP 10 programs, not all matching programs
- There's a baseline estimate and merged estimate already calculated in conversation_memory
- The categorization includes industry group, revenue tier, service tier, consultant assignment

---

## Current Agent Behavior

### Agent Still Calls search_getgranted Twice

**First Call:**
```javascript
search_getgranted({
  query: "hiring training",
  regions: ["BC"]
})
```
→ Infrastructure runs full pipeline, returns top 10 scored programs

**Second Call:**
```javascript
search_getgranted({
  query: "hiring training",
  regions: ["BC"],
  include_inactive: true
})
```
→ Infrastructure runs full pipeline AGAIN, returns top 10 scored programs (including inactive)

**Result:**
- Agent receives 10 programs from first call
- Agent receives 10 programs from second call (possibly overlapping)
- Agent manually counts and deduplicates
- Agent manually builds estimate by summing grant_amount values
- Agent presents "X active programs, Y total programs" view

**BUT:**
- The infrastructure already calculated a better estimate (categorization baseline)
- The infrastructure already merged search results with rate tables
- The infrastructure already stored merged_estimate in conversation_memory
- The agent is ignoring all of this and doing its own math

---

## Answers to Your Questions

### 1. Does infrastructure handle search automatically, or does agent manually build queries?

**Answer:** **Infrastructure handles it automatically**

- Agent builds a query like `"hiring training expansion"`
- Infrastructure **IGNORES** the agent's query
- Infrastructure builds prospectData from session
- Infrastructure runs categorizeProspect() to get industry group
- Infrastructure builds its OWN queries: `"hiring manufacturing"`, `"training manufacturing"`, etc.
- Infrastructure runs multiple searches across categories
- Infrastructure applies scoring, filtering, ranking, diversity caps
- Infrastructure returns top 10 programs to agent

**Agent's query parameter is completely unused in lead-gen mode.**

---

### 2. Does agent still need to classify results as active/cyclical/dead, or does infrastructure pre-classify?

**Answer:** **Infrastructure pre-classifies**

Results returned to agent include:
- `currently_accepting: true/false` (pre-classified)
- `intake_cycle: "Year-round" / "Quarterly" / "Seasonal" / null` (pre-classified)
- `status: "open" / "closed" / "cyclical"` (pre-classified)

**Agent doesn't need to classify - it's already done.**

---

### 3. Does agent build query keywords, or does infrastructure build them from form data?

**Answer:** **Infrastructure builds them**

- Agent provides: `query: "hiring training expansion"`
- Infrastructure uses: form data (industry, province, hiring_plans, training_budget, expansion_budget)
- Infrastructure builds: `["hiring manufacturing", "training manufacturing", "export manufacturing"]`
- Infrastructure tokenizes: planned_activities for activity keyword boost

**Agent's query is ignored; infrastructure uses form data.**

---

### 4. How many times does agent typically call search_getgranted in first message?

**Answer:** **Agent calls it TWICE (as instructed), but shouldn't**

**Current behavior:**
- Agent calls search_getgranted twice (active only, then include_inactive)
- Infrastructure runs full pipeline TWICE
- Agent manually deduplicates and counts
- Agent presents "X active now, Y total over 12 months"

**What SHOULD happen:**
- Agent calls search_getgranted ONCE
- Infrastructure runs pipeline once
- Agent retrieves categorization + merged_estimate from conversation_memory
- Agent presents baseline estimate from categorization (which already includes 12-month view)

**The second call is wasteful - the categorization baseline already provides the 12-month view.**

---

## Recommendation: Update Agent Prompt

The agent prompt is outdated. It should:

1. ✅ Call search_getgranted **ONCE** (not twice)
2. ✅ Accept that infrastructure handles query building, scoring, filtering
3. ✅ Retrieve `categorization` and `merged_estimate` from conversation_memory
4. ✅ Use the merged_estimate for the funding outlook (already includes baseline + search results)
5. ✅ Stop manually counting/calculating - infrastructure already did this

**Updated flow:**

```
Agent calls:
  search_getgranted({ regions: ["BC"] })  ← Minimal call, infrastructure handles rest

Infrastructure returns:
  - 10 scored, filtered, ranked programs
  - currently_accepting and intake_cycle pre-classified

Agent retrieves from memory:
  - categorization (industry group, baseline estimate, service tier, consultant)
  - merged_estimate (hiring, training, market_expansion, rd totals + confidence)

Agent presents:
  "Based on your profile, you're looking at $[merged_estimate.total_low]K–$[merged_estimate.total_high]K
   across [count] programs in hiring, training, and expansion categories."
```

No second call needed. No manual counting. No manual classification. Infrastructure already did everything.
