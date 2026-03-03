# Matched Programs Specificity Fix

## Problem
The agent was being vague in the `matched_programs` field when saving to HubSpot, using generic descriptions instead of actual program names. This made the internal HubSpot note useless for the sales team preparing for calls.

**Example from recent test:**
```
BAD (what agent was doing):
- "Hiring subsidies for developer roles (Q2/Q3 intake, active)"
- "R&D programs for AI/ML development (active)"
- "Training reimbursement programs (fall intake, cyclical)"
```

**What sales team needs:**
```
GOOD (what agent should do):
- "IRAP YEP ($15K per hire, hiring subsidy, active)"
- "NSERC ($350K, R&D funding for AI/ML development, active)"
- "BC Employer Training Grant ($10K, training reimbursement for 12 staff, fall intake)"
```

## Root Cause
The agent was applying the "never name programs" rule too broadly — it correctly avoided naming programs in CLIENT-FACING chat, but was also being vague in INTERNAL HubSpot data.

The agent has access to actual program names from `search_getgranted` results. It just needs to be told to use them in the `save_lead_data` payload.

## Fix
**File:** `.claude/agents/lead-gen-variant-b.md` (lines 323)

Added explicit instruction in the `save_lead_data` tool description:
```
For matched_programs: Use ACTUAL program names from search_getgranted results (e.g., "IRAP YEP
($15K per hire, active)", "BC ETG ($10K, fall intake)"), NOT generic descriptions (e.g., "hiring
subsidies"). The HubSpot note is internal — sales team needs exact program names to prepare for
calls. The "never name programs" rule applies to CLIENT-FACING chat only, not to internal data.
```

## How It Works

### Before Fix:
```
Agent runs search_getgranted, gets results:
- IRAP YEP - $15K per hire
- BC ETG - $10K training reimbursement
- NSERC - $350K R&D funding

Agent saves to HubSpot:
matched_programs: ["Hiring subsidies (active)", "Training programs (fall)", "R&D funding (active)"]

Sales team reads note: "What programs? Which hiring subsidy? Which training program?"
```

### After Fix:
```
Agent runs search_getgranted, gets results:
- IRAP YEP - $15K per hire
- BC ETG - $10K training reimbursement
- NSERC - $350K R&D funding

Agent saves to HubSpot:
matched_programs: ["IRAP YEP ($15K per hire, active)", "BC ETG ($10K, fall intake)", "NSERC ($350K, R&D, active)"]

Sales team reads note: "Perfect — I'll prepare talking points for IRAP YEP, BC ETG, and NSERC"
```

## Testing

After deployment:
1. Run a conversation through to save_lead_data
2. Check the HubSpot note created for the contact
3. **Verify:** matched_programs field contains actual program names (e.g., "IRAP YEP", "BC ETG") not generic descriptions
4. **Verify:** Program names include amounts and status (e.g., "$15K per hire, active")
5. **Verify:** Client-facing chat still NEVER mentions program names (rule still applies there)

## Files Modified
1. `.claude/agents/lead-gen-variant-b.md` - Added specificity instruction for matched_programs (line 323)

## Result
Sales team now receives actionable HubSpot notes with exact program names, amounts, and status. They can prepare for calls knowing exactly which programs to discuss, while the client-facing chat remains appropriately vague.
