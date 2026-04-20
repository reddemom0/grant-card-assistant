# Program Name Contamination Fix - Complete Changes

## Problem
Agent was naming programs like "CanExport" in client-facing chat because program names were being injected into its context via three sources:

1. high_me_budget_flag_note in categorization
2. matched_programs_detail in merged_estimate (full grant objects with names)
3. Strategic knowledge base (explicit program names with insider details)

All three were visible via `loadConversationMemories()` which injected them into the system prompt.

**The agent needs these names internally (for HubSpot, memory_store, lead scoring) but must not repeat them in chat.**

---

## Solution: Three Targeted Fixes

### FIX A: Remove Program Name from high_me_budget_flag_note
**File:** `src/services/grant-categorization.js:553`

**BEFORE:**
```javascript
highMeBudgetFlagNote = "High market expansion budget — suggest booking a call for market expansion planning. Could lead to CanExport engagement or Granted Export service.";
```

**AFTER:**
```javascript
highMeBudgetFlagNote = "High market expansion budget — suggest booking a call for market expansion planning. Strong fit for export-focused grant programs and Granted Export service.";
```

**Change:** Replaced "CanExport engagement" → "export-focused grant programs"

---

### FIX B: Add Warning Wrapper to Conversation Memories
**File:** `src/tools/memory.js:198-202`

**BEFORE:**
```javascript
return `\n\n## Previously Stored Information\n${memoryList}\n`;
```

**AFTER:**
```javascript
return `\n\n## Previously Stored Information

INTERNAL REFERENCE DATA — The following contains exact program names for internal record-keeping (HubSpot, memory_store). These names must NEVER appear in client-facing chat or email. Use category-level descriptions only when speaking to the prospect.

${memoryList}\n`;
```

**Change:** Added explicit warning about program names being for internal use only. This covers `matched_programs_detail` which contains full grant objects with `grant_name: "CanExport SME - Market Research"` etc.

**Why Not Strip Program Names:** The agent needs exact grant names for `save_lead_data` (HubSpot integration). The wrapper tells the agent the names are for internal reference only.

---

### FIX C: Add Warning Wrapper to Strategic Context
**File:** `src/utils/lead-gen-context.js:263-268`

**BEFORE:**
```javascript
// Format as XML block
const formattedContext = `<strategic_context>\n${contextText}\n</strategic_context>\n`;
```

**AFTER:**
```javascript
// Format as XML block with internal reference warning
const formattedContext = `<strategic_context>
INTERNAL STRATEGIC CONTEXT — Contains program-level intelligence for estimation accuracy. Program names below are for internal reference only and must not be shared with the prospect.

${contextText}
</strategic_context>\n`;
```

**Change:** Added explicit warning inside strategic_context block. The knowledge base contains entries like "CanExport insider knowledge: Revenue threshold is $100K+..." which is valuable for estimation accuracy but should not be quoted verbatim to prospects.

**Why Not Modify Knowledge Base:** The consulting team needs those program names for internal reference and accurate estimation. The wrapper separates "knowledge for system" from "knowledge for prospect."

---

## Expected Behavior After Fix

### What the Agent Now Sees:
```
## Previously Stored Information

INTERNAL REFERENCE DATA — The following contains exact program names for internal 
record-keeping (HubSpot, memory_store). These names must NEVER appear in 
client-facing chat or email. Use category-level descriptions only when speaking 
to the prospect.

  • categorization: {...,"high_me_budget_flag_note":"Strong fit for export-focused grant programs",...}
  • merged_estimate: {...,"matched_programs_detail":[{"grant_name":"CanExport SME",...}],...}
  • strategic_context: <strategic_context>
INTERNAL STRATEGIC CONTEXT — Contains program-level intelligence for estimation 
accuracy. Program names below are for internal reference only and must not be 
shared with the prospect.

CanExport insider knowledge: Revenue threshold is $100K+...
</strategic_context>
```

### What the Agent Should Do:

**✅ CORRECT (Client-Facing Chat):**
- "There's a federal export program that reimburses roughly 50% of eligible international expansion costs, up to $50K."
- "The main export program requires $100K+ in Canadian revenue from your last tax return."

**❌ INCORRECT (Naming Programs):**
- "CanExport reimburses roughly 50% of eligible international expansion costs."
- "You should apply to CanExport when it opens in February."

**✅ CORRECT (Internal Tools - save_lead_data):**
```javascript
{
  matched_programs: ["CanExport SME - Market Research", "SWPP - BC", "ETG - Foundational"],
  estimated_funding_range: "$30K-$60K"
}
```

---

## Testing

1. Fill out form with high market expansion budget ($50K+)
2. Leave planned_activities empty (triggers genre-score search)
3. Start conversation
4. Agent should:
   - ✅ Build accurate estimate using program names from matched_programs_detail
   - ✅ Store exact program names in HubSpot via save_lead_data
   - ❌ NOT name "CanExport" or any specific program in client-facing chat
   - ✅ Use category-level descriptions: "export program", "hiring grants", "training reimbursement"

---

## Files Modified

1. `src/services/grant-categorization.js` (line 553) - Removed "CanExport" from flag note
2. `src/tools/memory.js` (lines 198-202) - Added INTERNAL REFERENCE DATA warning
3. `src/utils/lead-gen-context.js` (lines 263-268) - Added INTERNAL STRATEGIC CONTEXT warning

---

## Philosophy

**Internal vs External Knowledge Separation:**

The agent operates in two modes simultaneously:
1. **Internal Mode:** Uses exact program names for estimation, HubSpot records, memory storage
2. **External Mode:** Speaks to prospect using category-level descriptions

The fix makes this distinction explicit in the data we feed the agent, rather than relying on the agent to infer it from rules alone.
