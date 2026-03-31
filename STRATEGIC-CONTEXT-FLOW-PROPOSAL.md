# Strategic Context Lookup Flow - Where It Fits

## Current Flow (Before Changes)

```
┌─────────────────────────────────────────────────────────────────────┐
│ USER ACTION: Submits webform with prospect data                    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ AGENT INVOCATION: src/claude/client.js - invokeAgent()            │
│                                                                     │
│  Line 168-177: Load form context                                   │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ leadGenFormContext = await getLeadGenFormContext()        │    │
│  │  ├─ Loads contact info, company name, website            │    │
│  │  ├─ Loads prospect_data (province, revenue, employees)    │    │
│  │  ├─ Loads company_background (from Haiku extraction)      │    │
│  │  └─ Returns formatted <lead_info> + <company_background>  │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Line 441-479: Assemble system prompt blocks                       │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ systemBlocks = [                                          │    │
│  │   { text: baseAgentPrompt, cache_control },  // CACHED    │    │
│  │   { text: summaryForSystem },                // NOT CACHED│    │
│  │   { text: memories },                        // NOT CACHED│    │
│  │   { text: learningMemory },                  // NOT CACHED│    │
│  │   { text: leadGenFormContext }               // NOT CACHED│    │
│  │ ]                                                          │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Line 494+: Send to Claude API                                    │
│  Agent composes opening message                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## NEW Flow (With Strategic Context)

```
┌─────────────────────────────────────────────────────────────────────┐
│ USER ACTION: Submits webform with prospect data                    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ AGENT INVOCATION: src/claude/client.js - invokeAgent()            │
│                                                                     │
│  Line 168-177: Load form context                                   │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ leadGenFormContext = await getLeadGenFormContext()        │    │
│  │  ├─ Loads contact info, company name, website            │    │
│  │  ├─ Loads prospect_data (province, revenue, employees)    │    │
│  │  ├─ Loads company_background (from Haiku extraction)      │    │
│  │  └─ Returns formatted <lead_info> + <company_background>  │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                  │                                  │
│                                  ▼                                  │
│  NEW: Line ~178-195: Load strategic context (ONE-TIME)            │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ strategicContext = await getStrategicContext()            │    │
│  │                                                            │    │
│  │  ├─ Check conversation_memory for 'strategic_context'     │    │
│  │  │  If exists → return cached value                       │    │
│  │  │  If missing → continue below                            │    │
│  │  │                                                          │    │
│  │  ├─ Build query from prospect data:                       │    │
│  │  │   industry + planned_activities (tokenized)            │    │
│  │  │   OR industry + revenue_tier + activity flags          │    │
│  │  │   Example: "manufacturing hiring engineers training     │    │
│  │  │            CNC export European markets"                │    │
│  │  │                                                          │    │
│  │  ├─ Call search_lead_gen_strategy(query) with 3s timeout │    │
│  │  │   Returns: strategic recommendations, common patterns, │    │
│  │  │            program combinations, timing considerations │    │
│  │  │                                                          │    │
│  │  ├─ Store in conversation_memory as 'strategic_context'   │    │
│  │  │                                                          │    │
│  │  └─ Returns formatted <strategic_context> block           │    │
│  │                                                            │    │
│  │  Logging:                                                  │    │
│  │   "🧠 Strategic context loaded: [query] → [X chars]"      │    │
│  │   "🧠 Strategy lookup: Xms"                               │    │
│  │                                                            │    │
│  │  Error handling:                                           │    │
│  │   If lookup fails/times out → return null, proceed        │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                  │                                  │
│                                  ▼                                  │
│  Line 441-479: Assemble system prompt blocks                       │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ systemBlocks = [                                          │    │
│  │   { text: baseAgentPrompt, cache_control },  // CACHED    │    │
│  │   { text: summaryForSystem },                // NOT CACHED│    │
│  │   { text: memories },                        // NOT CACHED│    │
│  │   { text: learningMemory },                  // NOT CACHED│    │
│  │   { text: leadGenFormContext },              // NOT CACHED│    │
│  │   { text: strategicContext }       // NEW - NOT CACHED    │    │
│  │ ]                                                          │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Line 494+: Send to Claude API                                    │
│  Agent sees strategic context BEFORE composing opening message     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Option A: Add to lead-gen-context.js (Recommended)

**File:** `src/utils/lead-gen-context.js`

**Add new function after getLeadGenFormContext():**

```javascript
/**
 * Load strategic context for lead-gen session (one-time lookup)
 *
 * Builds query from prospect data and calls search_lead_gen_strategy
 * to provide strategic recommendations before agent composes opening message.
 *
 * Cached in conversation_memory to avoid repeated lookups.
 *
 * @param {string} conversationId - Lead-gen session ID
 * @returns {Promise<string|null>} Formatted strategic context, or null
 */
export async function getStrategicContext(conversationId) {
  try {
    // Check if already loaded
    const memoryResult = await query(
      `SELECT value FROM conversation_memory WHERE conversation_id = $1 AND key = 'strategic_context'`,
      [conversationId]
    );

    if (memoryResult.rows.length > 0) {
      console.log(`✓ Strategic context already loaded (cached)`);
      return memoryResult.rows[0].value;
    }

    // Load prospect data
    const sessionResult = await query(
      `SELECT prospect_data, company_background FROM lead_gen_conversations WHERE session_id = $1`,
      [conversationId]
    );

    if (sessionResult.rows.length === 0) {
      console.log(`⚠️  No session found for strategic context lookup`);
      return null;
    }

    const session = sessionResult.rows[0];
    const prospectData = session.prospect_data || {};
    const companyBg = session.company_background || {};

    // Build query from industry + planned_activities
    let queryParts = [];

    // Add industry
    const industry = companyBg.industry || prospectData.industry;
    if (industry) {
      queryParts.push(industry);
    }

    // Add planned_activities (tokenized)
    if (prospectData.planned_activities) {
      const tokens = tokenizeText(prospectData.planned_activities);
      queryParts.push(...tokens);
    } else {
      // Fallback: use revenue tier + activity flags
      if (prospectData.revenue_range) {
        queryParts.push(prospectData.revenue_range.replace(/[^a-zA-Z]/g, ' '));
      }
      if (prospectData.hiring_plans && prospectData.hiring_plans !== 'No plans to hire') {
        queryParts.push('hiring');
      }
      if (prospectData.training_budget && prospectData.training_budget !== 'Under $10K') {
        queryParts.push('training');
      }
      if (prospectData.expansion_budget && prospectData.expansion_budget !== 'Under $10K') {
        queryParts.push('export', 'markets');
      }
    }

    const strategyQuery = queryParts.join(' ').trim();

    if (!strategyQuery) {
      console.log(`⚠️  No data to build strategic query - skipping`);
      return null;
    }

    console.log(`🧠 Building strategic context with query: "${strategyQuery}"`);

    // Call search_lead_gen_strategy with 3s timeout
    const startTime = Date.now();
    const { searchLeadGenStrategy } = await import('../tools/lead-gen-knowledge.js');

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Strategic lookup timeout')), 3000)
    );

    const strategyResult = await Promise.race([
      searchLeadGenStrategy({ query: strategyQuery }),
      timeoutPromise
    ]);

    const elapsed = Date.now() - startTime;

    if (!strategyResult || !strategyResult.success) {
      console.log(`⚠️  Strategic lookup returned no results - proceeding without it`);
      return null;
    }

    const contextText = strategyResult.content || strategyResult.answer || '';
    const charCount = contextText.length;

    console.log(`🧠 Strategic context loaded: "${strategyQuery}" → ${charCount} chars`);
    console.log(`🧠 Strategy lookup: ${elapsed}ms`);

    // Format as XML block
    const formattedContext = `<strategic_context>\n${contextText}\n</strategic_context>\n`;

    // Store in conversation_memory
    await query(
      `INSERT INTO conversation_memory (conversation_id, key, value)
       VALUES ($1, 'strategic_context', $2)
       ON CONFLICT (conversation_id, key) DO UPDATE SET value = $2`,
      [conversationId, formattedContext]
    );

    return formattedContext;

  } catch (error) {
    if (error.message === 'Strategic lookup timeout') {
      console.warn(`⚠️  Strategic lookup timed out (>3s) - proceeding without it`);
    } else {
      console.warn(`⚠️  Strategic context lookup failed: ${error.message}`);
    }
    return null;
  }
}

/**
 * Tokenize text for query building
 */
function tokenizeText(text) {
  if (!text) return [];

  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'we', 'our', 'are'
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopwords.has(word));
}
```

**Update getLeadGenFormContext() to also return strategic context:**

No changes needed - keep functions separate for clarity.

---

### Update src/claude/client.js

**Around line 177 (after getLeadGenFormContext):**

```javascript
let leadGenFormContext = null;
let strategicContext = null;

if (agentType === 'lead-gen') {
  console.log(`📝 Loading lead-gen form context...`);
  leadGenFormContext = await getLeadGenFormContext(conversationId);
  if (leadGenFormContext) {
    console.log(`✓ Injected lead form data and company background into system prompt`);
  } else {
    console.log(`✓ No form context available (may be first message before form submission)`);
  }

  // NEW: Load strategic context (one-time, cached)
  if (leadGenFormContext) {  // Only if form data exists
    const { getStrategicContext } = await import('../utils/lead-gen-context.js');
    strategicContext = await getStrategicContext(conversationId);
  }
}
```

**Around line 479 (after leadGenFormContext injection):**

```javascript
// Add lead-gen form context (if present) - NOT CACHED
if (leadGenFormContext) {
  systemBlocks.push({
    type: 'text',
    text: leadGenFormContext  // ❌ NOT CACHED (conversation-specific)
  });
  console.log(`🔍 DEBUG: Lead-gen context injected into system prompt:\n${leadGenFormContext}`);
}

// NEW: Add strategic context (if present) - NOT CACHED
if (strategicContext) {
  systemBlocks.push({
    type: 'text',
    text: strategicContext  // ❌ NOT CACHED (conversation-specific, but one-time lookup)
  });
  console.log(`🔍 DEBUG: Strategic context injected into system prompt:\n${strategicContext}`);
}
```

---

## Key Design Decisions

1. **One-Time Lookup:** Strategic context is loaded once when form data first appears, then cached in conversation_memory

2. **Timeout:** 3-second timeout ensures fast page loads - if lookup fails, conversation proceeds without it

3. **Query Building:**
   - Primary: industry + planned_activities (tokenized)
   - Fallback: industry + revenue_tier + activity flags (hiring/training/export)

4. **Error Handling:** All failures are non-blocking - agent works fine without strategic context

5. **Location:** New function in `lead-gen-context.js` keeps related context-building code together

6. **Storage:** Cached in conversation_memory to avoid repeated lookups across conversation

---

## Example Query Building

**Scenario 1: User provides planned_activities**
```
Input:
  industry: "Manufacturing"
  planned_activities: "Hiring machinists and engineers, upgrading CNC training program, expanding into European markets"

Query Built:
  "manufacturing hiring machinists engineers upgrading cnc training program expanding european markets"
```

**Scenario 2: User leaves planned_activities empty**
```
Input:
  industry: "Manufacturing"
  revenue_range: "$500K – $1M"
  hiring_plans: "3 – 5 people"
  training_budget: "$10K – $25K"
  expansion_budget: "Under $10K"

Query Built:
  "manufacturing 500 hiring training"
```

---

## Expected Strategic Context Output

```xml
<strategic_context>
For manufacturing businesses in this profile, common funding combinations include:

1. **Talent Development:**
   - Canada-BC Job Grant for CNC/machining training
   - Employer Training Grant for technical skills upgrading
   - SWPP programs for co-op students in engineering

2. **Market Expansion:**
   - CanExport SME for European trade shows and export development
   - Digital Adoption Program for e-commerce infrastructure

3. **Timing Considerations:**
   - Q1-Q2: Training grants (fiscal year start)
   - Q3: Export programs (trade show season)
   - Year-round: Hiring subsidies

4. **Typical Estimate Range:**
   Companies with this profile typically access $75K-$150K in first-year funding across 4-6 programs.
</strategic_context>
```

---

## Testing Plan

1. Submit form with detailed planned_activities → verify strategic context loaded
2. Submit form with empty planned_activities → verify fallback query works
3. Submit form again in same session → verify cached context reused
4. Simulate timeout → verify agent proceeds without strategic context
5. Check logs for query, timing, and character count

---

Ready to implement?
