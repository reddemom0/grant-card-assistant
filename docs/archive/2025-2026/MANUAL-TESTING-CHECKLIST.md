# Tool Usage - Manual Testing Checklist

**Quick Reference for Manual Validation**

---

## Prerequisites

- [ ] Development server running: `npm run dev`
- [ ] Redis running (for conversation storage)
- [ ] Browser console open (F12)
- [ ] Terminal with server logs visible

---

## Test 1: Single Turn with Web Search ⏱️ 5 min

### Steps

1. **Navigate**: http://localhost:3000/grant-cards
2. **Query**: "What are the latest CanExport SME requirements?"
3. **Wait**: For response to complete

### ✅ Expected Server Logs

```
🌐 WEB SEARCH INITIATED: web_search
   Tool ID: toolu_...
   Query: "..."
🔧 Tool use block captured: web_search
📄 WEB SEARCH RESULT: Found N results
💾 Stored response with X content blocks
```

### ✅ Expected Frontend

- Clean text response visible
- No JSON visible
- No "tool_use" or "thinking" text showing

### ✅ Expected Redis

```bash
redis-cli GET "conversation:grant-cards-<timestamp>" | jq '.[-1].content | map(.type)'
# Should show: ["thinking", "tool_use", "web_search_tool_result", "text"]
# OR similar array of content blocks
```

### 📝 Results

- [ ] Server logs show tool capture
- [ ] Frontend shows clean text only
- [ ] Redis contains content block array
- [ ] Content blocks include tool_use and tool_result

---

## Test 2: Multi-Turn Context ⏱️ 10 min

### Turn 1

**Query**: "Search for BC Employee Training Grant requirements"

**Expected**:
- [ ] 🌐 WEB SEARCH log appears
- [ ] Tool blocks captured
- [ ] Clean response shown

### Turn 2

**Query**: "What are the application deadlines?"

**Expected**:
- [ ] 🌐 WEB SEARCH log **DOES NOT** appear (using previous context)
- [ ] Response references "the information I found" or similar
- [ ] Clean response shown

### Turn 3

**Query**: "How does this compare to CanExport?"

**Expected**:
- [ ] 🌐 WEB SEARCH log appears (new topic, new search)
- [ ] Tool blocks captured for new search
- [ ] Response compares both programs

### 📝 Results

- [ ] Turn 1: Search performed
- [ ] Turn 2: Previous context used (no redundant search)
- [ ] Turn 3: New search for new topic
- [ ] All turns show clean text to user

---

## Test 3: Streaming Endpoint ⏱️ 5 min

### Steps

1. **Navigate**: http://localhost:3000/etg-agent
2. **Query**: "What are the current ETG funding limits?"
3. **Observe**: Streaming response

### ✅ Expected Server Logs

```
🔥 Making streaming Claude API call with Extended Thinking
🔧 Tools available: web_search
🌐 STREAMING TOOL USED: web_search
🔧 Tool use block captured: web_search
📄 WEB SEARCH RESULT: Received results
💾 Stored response with X content blocks
```

### 📝 Results

- [ ] Streaming works correctly
- [ ] Tool blocks captured during streaming
- [ ] Full content blocks stored in conversation
- [ ] Clean text shown to user

---

## Test 4: Content Block Inspection ⏱️ 5 min

### Get Conversation ID

From browser console or response JSON, note the `conversationId`

### Inspect Redis

```bash
# View full conversation
redis-cli GET "conversation:<conversationId>"

# View last assistant message content
redis-cli GET "conversation:<conversationId>" | jq '.[-1]'

# View content block types
redis-cli GET "conversation:<conversationId>" | jq '.[-1].content[] | .type'
```

### ✅ Expected Output

```json
// Content should be ARRAY of objects
[
  {
    "type": "thinking",
    "thinking": "..."
  },
  {
    "type": "tool_use",
    "id": "toolu_...",
    "name": "web_search",
    "input": { "query": "..." }
  },
  {
    "type": "web_search_tool_result",
    "content": [ ... ]
  },
  {
    "type": "text",
    "text": "..."
  }
]
```

### 📝 Results

- [ ] Content is array (not string)
- [ ] Contains tool_use block with id, name, input
- [ ] Contains web_search_tool_result block
- [ ] Contains text block
- [ ] Optionally contains thinking block

---

## Test 5: Display Verification ⏱️ 3 min

### Steps

1. Make query that uses web search
2. Open browser console (F12)
3. Check Network tab → Response

### ✅ Expected Response

```json
{
  "response": "Clean text answer...",
  "conversationId": "...",
  "performance": { ... }
}
```

**NOT**:
```json
{
  "response": [
    { "type": "thinking", ... },
    { "type": "tool_use", ... }
  ]
}
```

### 📝 Results

- [ ] Response is string (not array)
- [ ] Clean text only
- [ ] No content blocks visible
- [ ] No JSON structures in display

---

## Test 6: All Four Agents ⏱️ 15 min

Test each agent endpoint:

### Grant Cards (Non-Streaming)
- [ ] URL: /grant-cards
- [ ] Query: "Latest CanExport requirements"
- [ ] Tool blocks captured
- [ ] Clean display

### ETG Writer (Streaming)
- [ ] URL: /etg-agent
- [ ] Query: "ETG funding limits"
- [ ] Tool blocks captured
- [ ] Clean display

### BCAFE Writer (Non-Streaming)
- [ ] URL: /bcafe-agent
- [ ] Query: "BCAFE eligibility"
- [ ] Tool blocks captured
- [ ] Clean display

### CanExport Claims (Non-Streaming)
- [ ] URL: /canexport-claims
- [ ] Query: "Claims documentation requirements"
- [ ] Tool blocks captured
- [ ] Clean display
- [ ] Domain filtering active (check logs for allowed_domains)

---

## Quick Verification Commands

### Check Implementation

```bash
# Verify extractTextFromResponse exists
grep -n "function extractTextFromResponse" api/server.js

# Verify callClaudeAPI returns content blocks
grep -n "return data.content" api/server.js

# Verify streaming captures tool blocks
grep -n "currentToolUseBlock" api/server.js

# Verify display extraction
grep -n "extractTextFromResponse(response)" api/server.js
```

### Check Redis Structure

```bash
# List all conversations
redis-cli KEYS "conversation:*"

# Get specific conversation
redis-cli GET "conversation:grant-cards-<timestamp>"

# Check content types in last message
redis-cli GET "conversation:grant-cards-<timestamp>" | \
  jq '.[-1].content[] | .type'
```

---

## Success Criteria

### All Tests Pass If:

✅ **Server Logs**:
- Tool usage logged (`🌐 WEB SEARCH INITIATED`)
- Tool blocks captured (`🔧 Tool use block captured`)
- Content blocks stored (`💾 Stored response with N content blocks`)

✅ **Redis**:
- Conversations contain content block arrays
- Tool_use blocks have id, name, input
- Web_search_tool_result blocks present
- Text blocks present

✅ **Frontend**:
- Only text visible to users
- No JSON or content blocks showing
- No tool_use or thinking text visible

✅ **Multi-Turn**:
- Turn 1: Uses web search
- Turn 2: References previous search (no redundant search)
- Turn 3: New search for new topic

---

## Common Issues & Solutions

### Issue: No tool blocks in conversation

**Check**: Server logs - is web search being triggered?
**Solution**: Ensure query requires external information

### Issue: Tool blocks visible to user

**Check**: `extractTextFromResponse()` being called?
**Solution**: Verify display extraction in endpoint

### Issue: Redundant searches in follow-up questions

**Check**: Are previous tool blocks in conversation history?
**Solution**: Verify conversation storage and retrieval

### Issue: Redis shows string instead of array

**Check**: Is `callClaudeAPI()` returning `data.content`?
**Solution**: Verify API function changes deployed

---

## Test Results Summary

**Tester**: _______________
**Date**: _______________
**Time**: _______________

| Test | Pass | Fail | Notes |
|------|------|------|-------|
| 1. Single Turn | ☐ | ☐ | |
| 2. Multi-Turn | ☐ | ☐ | |
| 3. Streaming | ☐ | ☐ | |
| 4. Content Blocks | ☐ | ☐ | |
| 5. Display | ☐ | ☐ | |
| 6. All Agents | ☐ | ☐ | |

**Overall Result**: ☐ PASS ☐ FAIL

**Notes**:
```





```

---

**Ready for Production?**: ☐ YES ☐ NO ☐ NEEDS REVIEW

**Approved by**: _______________
**Date**: _______________

---

**Next Step**: If all tests pass, proceed with deployment to production.
