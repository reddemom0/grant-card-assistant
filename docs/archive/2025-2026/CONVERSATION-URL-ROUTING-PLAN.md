# Conversation URL Routing Implementation Plan

## Problem Statement

**Current Broken Behavior:**
1. User visits `/grant-cards` → Gets fresh conversation ✅
2. User sends first message → Conversation NOT saved to sidebar ❌
3. User refreshes page → Loses current conversation ❌
4. Sidebar doesn't populate with new conversations ❌

**Root Cause:**
When we fixed "always start fresh," we removed localStorage restoration but broke the conversation persistence mechanism. The conversationId exists only in JavaScript state, not in the URL, so refreshing loses it.

---

## Proposed Solution: Claude.ai-Style URL Routing

### New URL Structure

```
/grant-cards              → Redirect to /grant-cards/new
/grant-cards/new          → New conversation page (generates ID internally)
/grant-cards/chat/:id     → Specific conversation (loads from database)

/etg-agent                → Redirect to /etg-agent/new
/etg-agent/new           → New conversation page
/etg-agent/chat/:id      → Specific conversation

(Same pattern for all agents)
```

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ User visits /grant-cards                                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Frontend redirects to /grant-cards/new                       │
│ Generates conversationId internally (not in URL yet)        │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ User sends FIRST message                                     │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Backend:                                                     │
│ 1. Creates conversation with conversationId                 │
│ 2. Saves to PostgreSQL (for sidebar)                       │
│ 3. Saves to Redis (for conversation state)                 │
│ 4. Returns conversationId in response                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Frontend:                                                    │
│ window.location.href = `/grant-cards/chat/${conversationId}`│
│ (Redirect to permanent URL)                                 │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ User continues conversation at /grant-cards/chat/abc123      │
│ - ConversationId is in URL (source of truth)               │
│ - Refresh loads from URL                                    │
│ - Sidebar shows this conversation                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Update vercel.json Routes

**File:** `vercel.json`

**Add new routes:**
```json
{
  "rewrites": [
    // New conversation routes
    { "source": "/grant-cards/new", "destination": "/grant-cards.html" },
    { "source": "/grant-cards/chat/:id", "destination": "/grant-cards.html" },
    { "source": "/etg-agent/new", "destination": "/etg-agent.html" },
    { "source": "/etg-agent/chat/:id", "destination": "/etg-agent.html" },
    { "source": "/bcafe-agent/new", "destination": "/bcafe-agent.html" },
    { "source": "/bcafe-agent/chat/:id", "destination": "/bcafe-agent.html" },
    { "source": "/canexport-claims/new", "destination": "/canexport-claims.html" },
    { "source": "/canexport-claims/chat/:id", "destination": "/canexport-claims.html" },

    // Redirect base agent URLs to /new
    { "source": "/grant-cards", "destination": "/grant-cards/new" },
    { "source": "/etg-agent", "destination": "/etg-agent/new" },
    { "source": "/bcafe-agent", "destination": "/bcafe-agent/new" },
    { "source": "/canexport-claims", "destination": "/canexport-claims/new" },

    // Existing routes
    { "source": "/api/:path*", "destination": "/api/server.js" },
    ...
  ]
}
```

### Step 2: Update Frontend HTML Files

**Files to modify:**
- `grant-cards.html`
- `etg-agent.html`
- `bcafe-agent.html`
- `canexport-claims.html`

**Changes needed:**

#### A. Update `initializeConversationId()` function

```javascript
// Parse URL to determine mode
function getConversationMode() {
    const path = window.location.pathname;

    // Check if we're in a specific conversation: /grant-cards/chat/abc123
    if (path.includes('/chat/')) {
        const conversationId = path.split('/chat/')[1];
        return { mode: 'existing', conversationId };
    }

    // Check if we're at /new
    if (path.endsWith('/new')) {
        return { mode: 'new', conversationId: null };
    }

    // Default: redirect to /new
    return { mode: 'redirect', conversationId: null };
}

// Initialize or restore conversation ID
function initializeConversationId() {
    const { mode, conversationId: urlConversationId } = getConversationMode();

    if (mode === 'redirect') {
        // Redirect to /new if accessing base URL
        window.location.href = window.location.pathname + '/new';
        return null;
    }

    if (mode === 'existing') {
        // Load existing conversation from URL
        console.log('📂 Loading conversation from URL:', urlConversationId);
        conversationId = urlConversationId;
        localStorage.setItem('grant-cards-conversation-id', conversationId);

        // Load conversation history from server
        loadConversationHistory(conversationId).then(data => {
            if (data) {
                restoreConversationUI(data);
            }
        });

        return conversationId;
    }

    if (mode === 'new') {
        // Generate new conversation ID (not in URL yet)
        conversationId = generateConversationId();
        localStorage.setItem('grant-cards-conversation-id', conversationId);
        console.log('🆕 Starting new conversation:', conversationId);
        return conversationId;
    }
}
```

#### B. Add redirect after first message

```javascript
async function handleStreamingResponse(response, messageDiv) {
    // ... existing streaming logic ...

    // After successful first message response
    if (isFirstMessage) {
        // Redirect to permanent conversation URL
        const currentPath = window.location.pathname;
        if (currentPath.endsWith('/new')) {
            console.log('🔀 Redirecting to permanent conversation URL');
            window.history.replaceState({}, '', `/grant-cards/chat/${conversationId}`);
        }
        isFirstMessage = false;
    }
}
```

#### C. Add `loadConversationHistory()` function (if missing)

```javascript
async function loadConversationHistory(convId) {
    try {
        const response = await fetch(`/api/conversations/${convId}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.log('No conversation history found');
            return null;
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error loading conversation:', error);
        return null;
    }
}

function restoreConversationUI(conversationData) {
    console.log('Restoring conversation UI:', conversationData);

    // Hide welcome elements
    hideWelcomeElements();

    // Restore messages
    if (conversationData.messages && conversationData.messages.length > 0) {
        conversationData.messages.forEach(msg => {
            addMessage(msg.role, msg.content, false);
        });
    }
}
```

### Step 3: Update Backend API (api/server.js)

**Changes needed:**

#### A. Add GET endpoint for loading specific conversation

```javascript
// Around line 5200, add new endpoint:

// Get specific conversation by ID
if (req.method === 'GET' && url.pathname.match(/^\/api\/conversations\/[a-zA-Z0-9-]+$/)) {
  const conversationId = url.pathname.split('/').pop();
  console.log(`\n📥 GET /api/conversations/${conversationId}`);

  try {
    // Get user from JWT
    const token = req.cookies.granted_session;
    if (!token) {
      console.log('❌ No auth token');
      return res.writeHead(401).end(JSON.stringify({ error: 'Not authenticated' }));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    // Try Redis first
    let conversation = await redis.get(conversationId);

    // If not in Redis, try PostgreSQL
    if (!conversation) {
      const result = await pool.query(
        'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
        [conversationId, userId]
      );

      if (result.rows.length > 0) {
        conversation = result.rows[0];
      }
    }

    if (!conversation) {
      return res.writeHead(404).end(JSON.stringify({ error: 'Conversation not found' }));
    }

    // Parse messages if needed
    if (typeof conversation === 'string') {
      conversation = JSON.parse(conversation);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(conversation));

  } catch (error) {
    console.error('❌ Error loading conversation:', error);
    res.writeHead(500).end(JSON.stringify({ error: 'Failed to load conversation' }));
  }
  return;
}
```

#### B. Ensure conversationId is returned in streaming response

The backend already calls `saveConversation()`, but we need to ensure the conversationId is communicated back to the frontend. Check the streaming response handler:

```javascript
// Around line 3773, verify this logic exists:

// After saving conversation
await saveConversation(conversationId, userId, conversation, agentType);

// Optionally send conversationId in response (for first message)
res.write(`data: ${JSON.stringify({
  type: 'conversationId',
  conversationId: conversationId
})}\n\n`);
```

### Step 4: Update Sidebar to Show Agent-Filtered Conversations

**File:** All agent HTML files (sidebar section)

The sidebar already exists, but verify it's calling the correct endpoint:

```javascript
async function loadConversationHistory() {
    try {
        const agentType = 'grant-cards'; // Change per agent
        const response = await fetch(`/api/conversations?agentType=${agentType}`, {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) return;

        const conversations = await response.json();

        // Update sidebar UI
        const historyList = document.querySelector('.conversation-history');
        if (!historyList) return;

        historyList.innerHTML = '';

        conversations.forEach(conv => {
            const li = document.createElement('li');
            li.innerHTML = `
                <a href="/grant-cards/chat/${conv.id}">
                    <span class="conv-title">${conv.title || 'Untitled'}</span>
                    <span class="conv-date">${new Date(conv.created_at).toLocaleDateString()}</span>
                </a>
            `;
            historyList.appendChild(li);
        });

    } catch (error) {
        console.error('Error loading conversation history:', error);
    }
}
```

### Step 5: Testing Checklist

#### Test Case 1: New Conversation Flow
1. ✅ Visit `/grant-cards`
2. ✅ Redirects to `/grant-cards/new`
3. ✅ Page shows empty conversation
4. ✅ Send first message
5. ✅ URL changes to `/grant-cards/chat/abc123`
6. ✅ Conversation appears in sidebar
7. ✅ Refresh page → Conversation persists

#### Test Case 2: Resume Existing Conversation
1. ✅ Click conversation in sidebar
2. ✅ Navigates to `/grant-cards/chat/abc123`
3. ✅ Conversation history loads
4. ✅ Can continue conversation
5. ✅ Refresh page → Still works

#### Test Case 3: Multiple Conversations
1. ✅ Create conversation A
2. ✅ Click "New" or visit `/grant-cards/new`
3. ✅ Start conversation B
4. ✅ Both appear in sidebar
5. ✅ Can switch between them

#### Test Case 4: Cross-Agent Isolation
1. ✅ Create conversation in Grant Cards
2. ✅ Visit ETG Agent
3. ✅ Sidebar shows only ETG conversations (not Grant Cards)

---

## Benefits of This Approach

1. **URL = Source of Truth**
   - ConversationId in URL, not hidden in JavaScript
   - Bookmarkable conversations
   - Shareable links (if desired)

2. **Refresh-Safe**
   - Can reload any conversation from URL
   - No lost conversations

3. **Clear Lifecycle**
   - `/new` → Generate ID internally
   - First message → Redirect to `/chat/:id`
   - Explicit transition

4. **Sidebar Sync**
   - Every conversation saved to PostgreSQL
   - Sidebar loads from database
   - Filter by agent_type

5. **No localStorage Confusion**
   - URL is the authority
   - localStorage can be secondary cache

---

## Migration Notes

**Backward Compatibility:**
- Old URLs like `/grant-cards` will redirect to `/grant-cards/new`
- Existing conversations in database still accessible
- No data loss

**Deployment Strategy:**
1. Test on development branch
2. Deploy to preview environment
3. Test thoroughly
4. Merge to main
5. Deploy to production

---

**Status:** Ready for implementation on development branch
**Estimated Time:** 2-3 hours
**Risk Level:** Medium (requires coordinated frontend + backend changes)
