# Grant Card Assistant - Architecture Review & Debugging

## Issue Report
**Problem**: ETG, BCAFE, and CanExport Claims pages cannot send messages. Only Grant Card Generator page works.
**Additional Symptom**: User avatar shows "Loading..." and conversations sidebar doesn't work on broken pages.

## Architecture Overview

### Frontend Structure

**Working Page:**
- `grant-cards.html` ✅ WORKS

**Broken Pages:**
- `etg-agent.html` ❌ BROKEN
- `bcafe-agent.html` ❌ BROKEN
- `canexport-claims.html` ❌ BROKEN

### Key Components

#### 1. Server Routing (`server.js`)
```javascript
app.get('/grant-cards*', (req, res) => res.sendFile('grant-cards.html', { root: '.' }));
app.get('/etg-writer*', (req, res) => res.sendFile('etg-agent.html', { root: '.' }));
app.get('/bcafe-writer*', (req, res) => res.sendFile('bcafe-agent.html', { root: '.' }));
app.get('/canexport-claims*', (req, res) => res.sendFile('canexport-claims.html', { root: '.' }));
```
✅ **Status**: All routes configured correctly

#### 2. Static File Serving
```javascript
app.use(express.static('.')); // Serves from project root
```
✅ **Status**: Configured correctly
✅ **ChatClient file exists**: `/public/js/chat-client.js` (6,772 bytes)

#### 3. Agent Definitions (`.claude/agents/`)
```
✅ grant-card-generator.md
✅ etg-writer.md
✅ bcafe-writer.md
✅ canexport-claims.md
✅ orchestrator.md
```
✅ **Status**: All agent definition files exist

#### 4. Backend Agent Loading (`src/agents/load-agents.js`)
- Automatically discovers all `.md` files in `.claude/agents/`
- Validates agent types dynamically
- No hardcoded agent list

✅ **Status**: Correctly configured to recognize all agents

#### 5. Chat API Endpoint (`/api/chat`)
**Handler**: `src/api/chat.js` → `handleChatRequest()`
**Flow**:
1. Validates `agentType`, `message`
2. Creates or retrieves conversation
3. Calls `runAgent()` from `src/claude/client.js`
4. Streams SSE response

✅ **Status**: Code looks correct

#### 6. ChatClient Class (`public/js/chat-client.js`)
**Exports**: `window.ChatClient`
**Methods**:
- `sendMessage({ message, agentType, conversationId, userId, attachments })`
- Handles SSE streaming
- Event callbacks: `onTextDelta`, `onToolUse`, `onComplete`, `onError`

✅ **Status**: Class properly implemented and exported

### Frontend Configuration Comparison

#### Grant Cards (WORKING)
```javascript
<script src="/public/js/chat-client.js"></script>
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
const chatClient = new ChatClient(API_BASE);

// Agent type references (3 total):
1. loadConversationsList: agentType=grant-card-generator
2. sendMessage: agentType: 'grant-card-generator'
3. handleURLMessage: agentType: 'grant-card-generator'
```

#### CanExport Claims (BROKEN)
```javascript
<script src="/public/js/chat-client.js"></script>
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
const chatClient = new ChatClient(API_BASE);

// Agent type references (2 total):
1. loadConversationsList: agentType=canexport-claims
2. sendMessage: agentType: 'canexport-claims'
❌ MISSING: handleURLMessage function (no URL detection feature)
```

#### ETG Writer (BROKEN)
```javascript
<script src="/public/js/chat-client.js"></script>
Agent type references (3 total):
1. loadConversationsList: agentType=etg-writer
2. sendMessage: agentType: 'etg-writer'
3. handleURLMessage: agentType: 'etg-writer' (IF this function exists)
```

#### BCAFE Writer (BROKEN)
```javascript
<script src="/public/js/chat-client.js"></script>
Agent type references (3 total):
1. loadConversationsList: agentType=bcafe-writer
2. sendMessage: agentType: 'bcafe-writer'
3. handleURLMessage: agentType: 'bcafe-writer' (IF this function exists)
```

## Findings

### ✅ Correctly Configured
1. Server routes all exist
2. Static file serving configured
3. All agent definition files exist
4. ChatClient.js properly exported
5. All HTML pages include chat-client.js script
6. Agent types match between frontend and `.md` files

### ⚠️ Potential Issues

1. **Missing handleURLMessage** in some pages
   - Grant Cards has 3 agentType references
   - CanExport Claims only has 2 (missing URL handling)
   - Need to verify ETG and BCAFE

2. **Credentials Configuration**
   ```javascript
   // In fetch requests, check if credentials: 'include' is set
   fetch(`${API_BASE}/api/chat`, {
       credentials: 'include'  // ← Required for auth cookies
   })
   ```

3. **Authentication State**
   - User avatar shows "Loading..." suggests `getUserInfo()` failing
   - May indicate authentication cookie not being read
   - Check if `granted_session` cookie exists

## Debugging Plan

### Step 1: Direct API Test
Test the backend API endpoints directly to isolate frontend vs backend issues:

```bash
# Test agent availability
curl https://grant-card-assistant-production.up.railway.app/api/agents

# Test chat endpoint (requires auth)
curl -X POST https://grant-card-assistant-production.up.railway.app/api/chat \
  -H "Content-Type: application/json" \
  -H "Cookie: granted_session=<your-token>" \
  -d '{"agentType":"canexport-claims","message":"Test message"}'
```

### Step 2: Browser Console Inspection
Open browser DevTools (F12) on broken pages and check:

1. **Console Errors**
   ```
   Look for:
   - "ChatClient is not defined"
   - Failed to load /public/js/chat-client.js
   - CORS errors
   - 401 Unauthorized
   - 404 Not Found
   ```

2. **Network Tab**
   - Is `/public/js/chat-client.js` loading? (Status 200?)
   - Is `/api/chat` request being sent?
   - What's the response status?

3. **Application Tab → Cookies**
   - Does `granted_session` cookie exist?
   - Is it being sent with requests?

### Step 3: JavaScript Execution Order
Check if `chatClient` is initialized before being used:

```javascript
// In browser console, run:
console.log(typeof ChatClient);  // Should be 'function'
console.log(typeof chatClient);   // Should be 'object'
console.log(API_BASE);            // Should be '' or 'http://localhost:3001'
```

### Step 4: Code Comparison Tool
Create a detailed diff between working and broken pages:

```bash
# Compare sendMessage implementations
diff -u <(grep -A 50 "async function sendMessage" grant-cards.html) \
        <(grep -A 50 "async function sendMessage" canexport-claims.html)

# Compare initialization code
diff -u <(grep -A 50 "DOMContentLoaded" grant-cards.html) \
        <(grep -A 50 "DOMContentLoaded" canexport-claims.html)
```

## Recommended Fixes

### Fix 1: Unified JavaScript Module (DRY)
**Problem**: Duplicate code across 4 HTML files makes maintenance error-prone
**Solution**: Extract common JavaScript to shared file

```javascript
// Create: /public/js/agent-common.js
class AgentInterface {
    constructor(agentType, apiBase) {
        this.agentType = agentType;
        this.chatClient = new ChatClient(apiBase);
        this.conversationId = null;
        // ... all common functionality
    }
}

// In each HTML page:
<script src="/public/js/chat-client.js"></script>
<script src="/public/js/agent-common.js"></script>
<script>
    const agent = new AgentInterface('canexport-claims', API_BASE);
    agent.initialize();
</script>
```

### Fix 2: Add Detailed Logging
Add comprehensive logging to identify where execution fails:

```javascript
console.log('1. Script loaded');
console.log('2. ChatClient available?', typeof ChatClient);
console.log('3. Creating chatClient instance...');
const chatClient = new ChatClient(API_BASE);
console.log('4. chatClient created:', chatClient);
console.log('5. Initializing conversation...');
```

### Fix 3: Graceful Error Handling
Wrap all critical code in try-catch with user-friendly messages:

```javascript
try {
    await chatClient.sendMessage({...});
} catch (error) {
    console.error('Send message failed:', error);
    alert('Failed to send message. Please check browser console for details.');
    // Show error to user
}
```

## Next Steps

1. **IMMEDIATE**: Open CanExport Claims page in browser and check console for errors
2. **VERIFY**: Test API endpoints directly with curl/Postman
3. **COMPARE**: Run detailed diff between working and broken pages
4. **FIX**: Based on findings, either:
   - Copy exact working code from grant-cards.html, OR
   - Create unified JavaScript module for all agents
5. **TEST**: Verify fixes on all broken pages
6. **DEPLOY**: Push fixes to Railway

## Files to Review

### Frontend
- `/Users/Chris/grant-card-assistant/grant-cards.html` ✅ WORKING
- `/Users/Chris/grant-card-assistant/etg-agent.html` ❌ BROKEN
- `/Users/Chris/grant-card-assistant/bcafe-agent.html` ❌ BROKEN
- `/Users/Chris/grant-card-assistant/canexport-claims.html` ❌ BROKEN
- `/Users/Chris/grant-card-assistant/public/js/chat-client.js` ✅ EXISTS

### Backend
- `/Users/Chris/grant-card-assistant/server.js` - Main server entry point
- `/Users/Chris/grant-card-assistant/src/api/chat.js` - Chat endpoint handler
- `/Users/Chris/grant-card-assistant/src/claude/client.js` - Agent execution
- `/Users/Chris/grant-card-assistant/src/agents/load-agents.js` - Agent discovery
- `/Users/Chris/grant-card-assistant/src/middleware/auth.js` - Authentication

### Agent Definitions
- `/Users/Chris/grant-card-assistant/.claude/agents/*.md` - All agent prompts
