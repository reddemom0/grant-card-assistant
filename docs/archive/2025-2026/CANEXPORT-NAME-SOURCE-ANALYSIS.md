# CanExport Name Appearing in Chat - Source Analysis

## The Violation
Agent is naming "CanExport" directly in client-facing chat, violating <program_naming_rules>:
> "Never name any program in client-facing chat"

Example: "CanExport reimburses roughly 50% of eligible international expansion costs."

## STEP 1 Results: Where "CanExport" Appears in Data Fed to Agent

### 1. Agent Prompt Files (.claude/skills/lead-gen-variant-b/)
**File:** client-communication.md

**Line 389:**
```markdown
- After discussing CanExport: "What costs does it cover?", "How do I apply?", "What's the timeline?"
```
**Context:** This is in a list of example suggestion tile prompts. It's showing what USER questions might be after discussing exports, not telling the agent to name CanExport.

**Line 415:**
```markdown
✅ GOOD: "Yes, we're targeting the EU" / "What export funding is available?" / "Can a consultant help with export grants?"
```
**Context:** This is showing how to ask about export funding WITHOUT naming specific programs.

**Assessment:** These are examples of proper behavior (line 415) and hypothetical user questions (line 389). Not instructing the agent to name CanExport.

---

### 2. Infrastructure Code

#### **grant-categorization.js:553**
```javascript
highMeBudgetFlagNote = "High market expansion budget — suggest booking a call for market expansion planning. Could lead to CanExport engagement or Granted Export service.";
```
**Storage:** This gets stored in `categorization.high_me_budget_flag_note`

**Injection:** The entire `categorization` object is stored in `conversation_memory`:
```javascript
// executor.js:817
await dbQuery(
  `INSERT INTO conversation_memory (conversation_id, key, value)
   VALUES ($1, 'categorization', $2)
   ON CONFLICT (conversation_id, key)
   DO UPDATE SET value = $2`,
  [conversationId, JSON.stringify(categorization)]
);
```

**Visibility to Agent:** YES - `loadConversationMemories()` (memory.js:181-203) loads ALL conversation_memory entries and injects them as:
```
## Previously Stored Information
  • categorization: {"industry_group":1,"matched_industry":"Retail",...,"high_me_budget_flag_note":"High market expansion budget — suggest booking a call for market expansion planning. Could lead to CanExport engagement or Granted Export service.",...}
  • merged_estimate: {...}
```

This gets appended to the system prompt in `client.js:145-150`.

**🚨 CONFIRMED:** The agent CAN see "CanExport engagement" in the high_me_budget_flag_note.

---

#### **grant-search-pipeline.js:71** (Comment only)
```javascript
'Markets': 5,  // Uncommon, high value (CanExport $50K)
```
**Assessment:** Internal comment explaining intent hierarchy. Not visible to agent.

---

#### **grant-search-pipeline.js:122-123** (detectProgramFamily)
```javascript
if (name.includes('canexport')) {
  return 'CanExport';
}
```
**Assessment:** Internal diversity cap logic. Not visible to agent.

---

### 3. Search Results (matched_programs_detail)

**Storage in conversation_memory:**
```javascript
// executor.js:806
mergedEstimate = {
  ...
  matched_programs_detail: searchResults.programs_found  // Full grant objects
}
```

**Grant objects include:**
- `grant_name`: "CanExport SME - Market Research"
- `grant_type`: "Grant Type\n      Market Expansion"
- `smart_tags`: {...}
- `genre_scores`: {...}

**Injection:** These get stored in `merged_estimate.matched_programs_detail`, which is also in conversation_memory and visible to the agent via `loadConversationMemories()`.

**🚨 CONFIRMED:** The agent CAN see full grant names like "CanExport SME" in matched_programs_detail.

---

### 4. Strategic Context (strategic_context from lead-gen-context.js)

**Source:** `getStrategicContext()` in `lead-gen-context.js:171-284`

This searches `search_lead_gen_strategy` tool with a query built from:
- Industry
- Planned activities (if provided)
- Hiring/training/expansion flags (fallback)

**Question:** Does the strategic context knowledge base contain program names like "CanExport"?

Need to check: `src/tools/lead-gen-knowledge.js` and the actual knowledge base documents.

---

## Summary: Confirmed Sources Where Agent Sees "CanExport"

1. ✅ **conversation_memory → categorization → high_me_budget_flag_note**
   - Contains: "Could lead to CanExport engagement or Granted Export service"
   - Injected into system prompt via `loadConversationMemories()`

2. ✅ **conversation_memory → merged_estimate → matched_programs_detail**
   - Contains full grant objects with `grant_name: "CanExport SME - Market Research"`
   - Injected into system prompt via `loadConversationMemories()`

3. ❓ **Strategic context from knowledge base**
   - Need to verify if strategic consulting knowledge mentions program names

---

## Next: STEP 2

Need to check:
1. Strategic knowledge base documents - do they mention "CanExport" by name?
2. Whether the agent is also using its training data (Claude knows about Canadian grants)
3. What to change to prevent the agent from seeing/using program names

---

## STEP 1 COMPLETE - All Three Sources Confirmed

### ✅ **Source 1: high_me_budget_flag_note** (grant-categorization.js:553)
```javascript
"High market expansion budget — suggest booking a call for market expansion planning. 
Could lead to CanExport engagement or Granted Export service."
```
- Stored in `conversation_memory → categorization → high_me_budget_flag_note`
- Injected via `loadConversationMemories()`

---

### ✅ **Source 2: matched_programs_detail** (executor.js:806)
Full grant objects with explicit program names:
```json
{
  "grant_name": "CanExport SME - Market Research",
  "grant_type": "Grant Type\n      Market Expansion",
  "grant_amount": "$50,000",
  ...
}
```
- Stored in `conversation_memory → merged_estimate → matched_programs_detail`
- Injected via `loadConversationMemories()`

---

### ✅ **Source 3: Strategic Knowledge Base** (data/lead-gen-strategy-knowledge.json)

Multiple entries explicitly name programs with insider details:

**strategy_canexport_insider:**
```
"CanExport insider knowledge: Revenue threshold is $100K+ on last CRA T2 and GST return. 
If a startup is close, a strategic short fiscal year-end can accelerate eligibility. 
Businesses can apply for the US market and reapply for different international markets each 
year — there is no limit to how many times you can apply as long as you're targeting different 
markets. First-time applicants typically get $25-35K, not the full $50K. Critical to understand: 
CanExport is a 50% cost-share reimbursement model..."
```

**Other entries mention:**
- "CanExport requires $100K+ revenue"
- "CanExport at $25-50K typically dwarfs individual hiring grants"  
- "'CanExport opens in February — let's get your project plan ready now.'"
- "CanExport guidelines now explicitly prioritize military and defense-related projects"
- "IRAP: NRC program, practically requires $250K+ revenue"
- "SRED: federal tax credit reimbursing ~64% of R&D salaries"
- "Mitacs: funds research collaborations with universities"

**Flow:**
1. `getStrategicContext()` (lead-gen-context.js:171) builds query from prospect data
2. Calls `searchLeadGenStrategy()` which searches lead-gen-strategy-knowledge.json
3. Returns strategic recommendations that include program names
4. Gets stored in `conversation_memory → strategic_context`
5. Injected via `loadConversationMemories()`

---

## The Problem

The agent is being fed program names from THREE different sources:

1. **Internal flags** (high_me_budget_flag_note)
2. **Search results** (matched_programs_detail with full grant objects)
3. **Strategic knowledge** (explicit insider knowledge about program details)

All three sources are injected into the system prompt via `loadConversationMemories()`, which means the agent sees:

```
## Previously Stored Information
  • categorization: {...,"high_me_budget_flag_note":"Could lead to CanExport engagement",...}
  • merged_estimate: {...,"matched_programs_detail":[{"grant_name":"CanExport SME",...}],...}
  • strategic_context: "CanExport insider knowledge: Revenue threshold is $100K+..."
```

**The agent cannot comply with <program_naming_rules> ("Never name any program") when the data 
we're feeding it explicitly names programs and provides detailed insider knowledge about them.**

This is a **data contamination issue**, not a prompt compliance issue.

---

## Ready for STEP 2

The agent is violating the naming rule because we're feeding it program names in three places. 
Awaiting instructions on what to change.
