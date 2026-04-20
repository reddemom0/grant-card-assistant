# Other Growth Plans Question - Added to Discovery

## Problem
The agent never asked "any other growth plans this year?" during discovery before running the grant search. This matters because the answer directly changes the funding estimate - if they mention a second or third fundable activity, the number goes up.

In testing, the agent went straight from basic details to searching without probing for additional activities.

## Fix
**File:** `.claude/agents/lead-gen-variant-b.md` (line 138)

Added one required gate in Phase 2 discovery, right after "REQUIRED BEFORE SEARCHING":

```
Before searching, always ask: "Any other plans this year beyond [what they mentioned]?
Hiring, training, new equipment, expansion? I want to catch everything that could be funded."
Only skip if they already volunteered this info or explicitly said "no other plans."
```

## How It Works

### Before Fix:
1. User: "We're hiring 3 students this summer"
2. Agent collects revenue, incorporation, timeline
3. Agent searches immediately (misses potential other activities)
4. Estimate: $10K (only counted hiring)

### After Fix:
1. User: "We're hiring 3 students this summer"
2. Agent collects revenue, incorporation, timeline
3. **Agent asks: "Any other plans beyond the hiring? Training, equipment, expansion?"**
4. User: "Yes, we're also buying new equipment"
5. Agent searches with both activities
6. Estimate: $25K (hiring + equipment)

## Test Cases

**Test 1: Single Activity Mentioned**
- User mentions only hiring
- Agent goes through discovery
- **Verify:** Agent asks about other plans BEFORE searching
- User says "nope"
- Agent proceeds to estimate without re-asking

**Test 2: Multiple Activities Volunteered**
- User mentions hiring AND training in first message
- Agent collects details
- **Verify:** Agent acknowledges both, asks "anything else beyond these two?"
- Respects no-repeat-questions rule

## Files Modified
1. `.claude/agents/lead-gen-variant-b.md` - Added one line to Phase 2 discovery (line 138)

## Result
Agent now consistently asks about additional growth plans before searching, ensuring more accurate funding estimates by catching all fundable activities.
