# Repeated Questions Fix - Complete Implementation

## Problem
The agent was re-asking questions that prospects had already answered, damaging trust and causing drop-off.

**Examples from live testing:**
1. User: "incorporated, revenue is about 2 million"
   Agent later: "I still need the revenue and incorporation details"

2. User: "nope" (no other growth plans)
   Agent later: "Beyond these 5 summer hires, any other growth plans on the horizon?"

3. User: "seasonal, april to october... incorporated, revenue is about 2 million"
   Agent later: "And I still need the revenue and incorporation details"

## Root Cause
- Agent had instructions to check stored information, but they weren't strong enough
- Agent followed a scripted question checklist without verifying what it already knew
- "REQUIRED BEFORE SEARCHING" instruction may have been interpreted as "ask for these even if you have them"

## Solution - Three Reinforcements

### 1. Strengthened Core Rule (lines 26-56)
**File:** `.claude/agents/lead-gen-variant-b.md`

Replaced weak `<stored_information_check>` with much stronger `<no_repeat_questions>` rule:
- Made it a "CRITICAL RULE" with explicit consequences
- Listed THREE places to check (conversation history, stored info, current message)
- Listed all information types that must be checked (revenue, incorporation, employees, etc.)
- Added exact examples from the test failures
- Added language: "treat it as seriously as never naming specific grant programs"
- Added: "Violating this rule will cause prospects to abandon the conversation immediately"

**Key additions:**
```
Before asking ANY question during discovery, estimate, or follow-up, you MUST check THREE places:
1. The conversation history — did they already mention this in ANY previous message?
2. The "Previously Stored Information" section in your context — did you already save this via memory_store?
3. The current message — did they just tell you this in their most recent reply?

If the answer exists in ANY of these places, DO NOT ask for it again.
```

### 2. Discovery-Specific Check (lines 128-134)
**File:** `.claude/agents/lead-gen-variant-b.md`

Added explicit pre-question checklist in Phase 2:
```
BEFORE ASKING EACH DISCOVERY QUESTION, CHECK:
- Lead form data (name, email, company, website) — already provided
- Company background (may include industry, location, services) — scraped from website
- Previously stored memories (via memory_store) — check what you've already saved
- Earlier messages in this conversation — what have they already told you?

Only ask for information you don't already have. If the prospect volunteers multiple
pieces of info in one message, acknowledge them all and skip those questions entirely.
```

### 3. Clarified "REQUIRED" Instruction (line 136)
**File:** `.claude/agents/lead-gen-variant-b.md`

Modified potentially conflicting instruction:
```
REQUIRED BEFORE SEARCHING: revenue (or stage), incorporation status, province, activity
details with timeline. If you already have these from previous messages or stored
memories, proceed to search without re-asking.
```

This prevents the agent from interpreting "REQUIRED" as "ask for these even if you have them."

## How It Works

### Before Fix:
1. Agent asks: "What's your revenue?"
2. User: "incorporated, revenue is about 2 million"
3. Agent stores some info but later says: "I still need the revenue and incorporation details"
4. User abandons conversation (feels like agent isn't listening)

### After Fix:
1. Agent asks: "What's your revenue?"
2. User: "incorporated, revenue is about 2 million"
3. Agent checks: ✅ They just said $2M revenue ✅ They just said incorporated
4. Agent: "Got it — $2M revenue and incorporated. How many employees do you have?"
5. User continues (feels heard and understood)

## Testing Scenarios

### Test 1: Multi-Answer Message
**Setup:** User provides multiple pieces of info in one message
```
User: "we're incorporated, 15 employees, about $2M revenue, hiring 5 people this summer"
```

**Expected Behavior:**
- Agent acknowledges ALL four pieces of information
- Agent skips questions about incorporation, employees, revenue, and hiring plans
- Agent moves on to questions about other details (timeline, activities, etc.)
- Agent NEVER re-asks for revenue, incorporation, employee count, or hiring plans

### Test 2: "No Other Plans" Response
**Setup:** User says they have no other growth plans
```
Agent: "Any other growth plans this year?"
User: "nope"
```

**Expected Behavior:**
- Agent stores that no other plans exist
- Agent NEVER asks again: "Beyond X, any other growth plans?"
- Agent moves forward to next phase (estimate or CTA)

### Test 3: Already Stored Information
**Setup:** User provides info, agent stores it via memory_store, conversation continues
```
User: "seasonal, april to october... incorporated, revenue is about 2 million"
Agent: [stores revenue=$2M, incorporated=true]
... several messages later ...
```

**Expected Behavior:**
- When ready to search, agent checks stored memories
- Agent sees revenue and incorporation already stored
- Agent proceeds to search WITHOUT asking: "I still need the revenue and incorporation details"

## Files Modified
1. `.claude/agents/lead-gen-variant-b.md` - Three reinforcements of no-repeat rule

## Result
The agent now has three layers of instruction preventing repeated questions:
1. **Core rule** (lines 26-56): Critical-level instruction with consequences
2. **Discovery reminder** (lines 128-134): Pre-question checklist
3. **Clarified requirements** (line 136): Explicit instruction to not re-ask if already known

The language is significantly stronger and more explicit than the previous version, with real examples from failed test cases.
