# Program Names Scope Fix - Complete Implementation

## Problem
The agent was stripping program names from EVERYTHING — chat, email, memory_store, AND save_lead_data. The "never name programs" rule was written too broadly, and the agent interpreted it as universal when it should only apply to client-facing outputs.

**Result:**
- ❌ Client-facing chat: Correctly vague (good)
- ❌ Client-facing email: Correctly vague (good)
- ❌ HubSpot notes: Generic descriptions like "hiring subsidies" instead of "IRAP YEP" (bad)
- ❌ Memory store: Generic descriptions instead of actual program names (bad)

## Root Cause
Multiple instruction blocks said "never name programs" without specifying they only apply to client-facing outputs:
- `<program_naming_rules>`: "Never name any program"
- `<estimate_presentation>`: "Never name inactive programs"
- `<strategic_reframing>`: "never name the program"
- `<google_test>`: "Applies everywhere"

The agent took these literally and applied them to ALL outputs including internal data.

## Fix - Edited 4 Existing Rules

### 1. Main Rule - `<program_naming_rules>` (line 179)
**BEFORE:**
```
Never name any program — active or inactive. Use categories, counts, and dollar ranges only.
```

**AFTER:**
```
Never name any program in client-facing chat or email — active or inactive. Use categories, counts, and dollar ranges only.
For inactive programs: you may reference their count, total value, category, and intake timing. You may NOT name them, give per-program amounts, or share reopening dates/URLs.
(Internal data like memory_store and save_lead_data should use actual program names from search results — sales team needs them.)
```

### 2. Estimate Presentation (line 168)
**BEFORE:**
```
Never name inactive programs individually — count them and total their amounts only. Active programs referenced at category level only (no program names).
```

**AFTER:**
```
In client-facing responses, never name inactive programs individually — count them and total their amounts only. Active programs referenced at category level only (no program names in chat/email).
```

### 3. Strategic Reframing (lines 68, 73)
**BEFORE:**
```
Frame it as a smart business decision, but do not name the program.
...
One suggestion per message, one sentence, never name the program behind it.
```

**AFTER:**
```
Frame it as a smart business decision, but do not name the program in your response to them.
...
One suggestion per message, one sentence, never name the program in client-facing chat.
```

### 4. Google Test (line 193)
**BEFORE:**
```
Applies everywhere. Applies everywhere — estimates, pushback, strategic questions, CTA.
```

**AFTER:**
```
Applies to all client-facing outputs — estimates, pushback, strategic questions, CTA.
```

## How It Works

### Before Fix:
```
Agent runs search_getgranted:
- Results: "IRAP YEP", "BC ETG", "NSERC"

Agent interprets "never name programs" universally:
- Chat: "hiring subsidies" ✅ (correct)
- Email: "training programs" ✅ (correct)
- memory_store: "hiring subsidies" ❌ (wrong - should be actual names)
- save_lead_data: "R&D funding" ❌ (wrong - should be actual names)

Sales team: "Which programs? What should I prepare for the call?"
```

### After Fix:
```
Agent runs search_getgranted:
- Results: "IRAP YEP", "BC ETG", "NSERC"

Agent interprets scoped rules:
- Chat: "hiring subsidies" ✅ (client-facing = vague)
- Email: "training programs" ✅ (client-facing = vague)
- memory_store: "IRAP YEP ($15K per hire, active)" ✅ (internal = actual names)
- save_lead_data: "BC ETG ($10K, fall intake)" ✅ (internal = actual names)

Sales team: "Perfect — I'll prepare IRAP YEP and BC ETG talking points for the call"
```

## Testing

After deployment:
1. Run a conversation through to save_lead_data
2. **Check memory_store calls in logs:**
   - Look for programs_matched field
   - **Verify:** Contains actual program names (e.g., "IRAP YEP", "BC ETG")
   - **Verify:** NOT generic descriptions (e.g., "hiring subsidies")
3. **Check save_lead_data call in logs:**
   - Look for matched_programs field
   - **Verify:** Contains actual program names with amounts (e.g., "IRAP YEP ($15K per hire, active)")
4. **Check client-facing chat:**
   - Review all messages sent to user
   - **Verify:** NO program names appear anywhere in chat responses
5. **Check HubSpot note:**
   - View created contact in HubSpot
   - **Verify:** Programs matched section shows actual names

## Files Modified
1. `.claude/agents/lead-gen-variant-b.md` - Edited 4 existing rules to scope them to client-facing outputs (lines 68, 73, 168, 179, 181, 193)

## Result
The "never name programs" rule now correctly applies ONLY to client-facing outputs (chat and email). Internal data (memory_store and save_lead_data) now uses actual program names from search results, giving the sales team the information they need to prepare for calls.

**No new instruction blocks added — just clarified existing rules with minimal edits.**
