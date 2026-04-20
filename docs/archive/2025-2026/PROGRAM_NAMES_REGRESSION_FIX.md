# Program Names Regression Fix

## Problem
After Round 1 bug fixes were deployed, the agent stopped including specific program names in HubSpot notes and save_lead_data. This was a REGRESSION — it was working correctly before the fixes.

**Before fixes (correct):**
```
Programs matched: WorkBC Wage Subsidy Program ($12,000 for seasonal hiring), potential additional programs for training and youth hiring
```

**After fixes (broken):**
```
Programs matched: Hiring subsidies for entry-level contractors (multiple programs, $10-15K immediate), BC safety training support programs (seasonal intakes, $15-20K)
```

## Root Cause
Line 55 in the system prompt had an unscoped reference to "never naming specific grant programs" that created a blanket rule:

**Line 55 (BEFORE):**
```
This is a HARD RULE — treat it as seriously as never naming specific grant programs.
```

This made the agent interpret the "never name programs" rule as universal, applying it to BOTH client-facing chat AND internal data (memory_store, save_lead_data).

## Fix
**Line 55 (AFTER):**
```
This is a HARD RULE — treat it as seriously as never naming specific grant programs in client-facing chat.
```

Added "in client-facing chat" to scope the comparison appropriately.

## Verification
Ran comprehensive grep to confirm ALL program naming rules are now properly scoped:

```bash
grep -n "never name\|never mention.*program" .claude/agents/lead-gen-variant-b.md | grep -v "client-facing\|CLIENT-FACING\|INTERNAL"
```

Result: **No unscoped references found** ✅

All instances now explicitly state:
- "in client-facing chat or email" OR
- "in client-facing responses" OR
- "in your response to them" OR
- Reference "INTERNAL ONLY" or "CLIENT-FACING chat only"

## Files Modified
1. `.claude/agents/lead-gen-variant-b.md` - Fixed line 55 (added "in client-facing chat" scope)

## Result
The agent will now:
- ✅ Use vague categories in client-facing chat (e.g., "hiring subsidies")
- ✅ Use actual program names in memory_store (e.g., "IRAP YEP ($15K per hire, active)")
- ✅ Use actual program names in save_lead_data (e.g., "WorkBC Wage Subsidy Program ($12K)")
- ✅ Provide sales team with exact programs to prepare for calls

This was the LAST unscoped reference that was causing the regression.
