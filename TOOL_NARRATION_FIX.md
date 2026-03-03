# Tool Narration Fix - Complete Implementation

## Problem
The lead-gen agent was leaking internal tool narration into user-visible chat responses. Example:
```
Let me search what funding programs match your profile.
Let me broaden that search — landscaping-specific filters might be too narrow.
Let me store what I've found and give you the estimate.
Here's what I'm seeing for Coastal Pacific:
```

The first three lines should NEVER appear to users.

## Root Cause
Text was being streamed to the frontend in REAL-TIME in `streaming.js` (lines 84-91) BEFORE the filter in `client.js` could catch it. The existing filter only prevented narration from being saved to conversation history, but users already saw it.

## Solution - Three Layers

### Layer 1: System Prompt Reinforcement
**File:** `.claude/agents/lead-gen-variant-b.md`

Added explicit instruction in `<absolute_output_rule>` block:
```
NEVER narrate or announce your tool usage in responses. Do not say:
- "Let me search..." / "Let me look..." / "Let me store..." / "Let me broaden..."
- "Let me check..." / "Let me find..." / "Let me save..."
- "Searching for..." / "Storing that..." / "Looking up..."
- "I'll search..." / "I'll look..." / "I'll check..."
Just use tools silently and deliver the results naturally.
```

### Layer 2: Streaming Logic Fix (PRIMARY FIX)
**File:** `src/claude/streaming.js`

**Changes:**
1. Added `agentType` parameter to `streamToSSE()` function
2. Added text buffer and tool-use flag for lead-gen agents
3. Modified text_delta handling:
   - For lead-gen: Buffer text instead of streaming immediately
   - For other agents: Stream immediately (original behavior)
4. Modified message_delta handling:
   - On `stop_reason === 'end_turn'`: Stream the buffered text
   - On `stop_reason === 'tool_use'`: Discard the buffered text (tool narration)
   - Reset buffer for next iteration

**Key code:**
- Lines 16-27: Function signature and buffer initialization
- Lines 50-54: Mark tool_use iterations
- Lines 93-107: Buffer text instead of streaming for lead-gen
- Lines 211-228: Stream or discard based on stop_reason

### Layer 3: Regex Safety Net
**File:** `src/claude/client.js`

Added `stripToolNarration()` function that removes narration patterns using regex:
- Lines 32-62: Function definition with 13 narration patterns
- Lines 525-530: Apply safety net after text accumulation
- Logs when narration is stripped

**Patterns caught:**
- "Let me search/look/store/broaden/check/find/save..."
- "Searching/Storing/Looking up..."
- "I'll search/look/check..."

## How It Works

### For Lead-Gen Agents:
1. Agent outputs "Let me search..." text + tool_use
2. **Streaming layer buffers the text** (doesn't send to client yet)
3. When `stop_reason === 'tool_use'` arrives, **text is discarded**
4. Tool executes and agent continues
5. Agent outputs final response text
6. When `stop_reason === 'end_turn'` arrives, **final text is streamed**
7. **Safety net** strips any remaining narration patterns
8. Clean text saved to conversation history

### For Other Agents:
- Original behavior preserved: all text streams immediately
- No buffering or filtering

## Testing

After deployment, test with this conversation flow:
1. Start discovery ("15 employees, $2M revenue, hiring 4-5 seasonal")
2. Trigger grant search (agent searches for matching programs)
3. **Verify:** Response goes straight to estimate with NO "Let me search/store/broaden" lines
4. **Check logs:** Should see "🔇 Discarding tool narration" messages

## Files Modified
1. `.claude/agents/lead-gen-variant-b.md` - System prompt instruction
2. `src/claude/streaming.js` - Streaming logic with buffering
3. `src/claude/client.js` - Regex safety net + pass agentType to streamToSSE

## Result
Tool narration is now completely invisible to users through three layers of defense:
1. Prompt tells agent not to narrate (prevention)
2. Streaming layer buffers and discards narration (primary fix)
3. Regex safety net catches any remaining patterns (backup)
