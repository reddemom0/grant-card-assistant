# New Conversation Button & /new Page Fixes

## Issues Fixed

### 1. ❌ "New Conversation" Button Not Working
**Error**: `Uncaught ReferenceError: startNewConversation is not defined`

**Cause**: The button had `onclick="startNewConversation()"` but the function didn't exist in the JavaScript.

**Fix**: Added `startNewConversation()` function to `etg-agent.html`:
```javascript
function startNewConversation() {
    if (confirm('Start a new conversation? This will clear the current chat.')) {
        window.location.href = '/etg-writer/new';
    }
}
```

Also added `exportConversationAsMarkdown()` function which was also missing.

**Files Changed**: `etg-agent.html`

---

### 2. ❌ No /new Page When Clicking Agent Card
**Issue**: Clicking agent card from dashboard didn't show clear "new conversation" page

**Cause**: Dashboard was linking to `/etg-writer` instead of `/etg-writer/new`

**Fix**: Updated dashboard agent links to explicitly use `/new` URLs:
- ETG Writer: `/etg-writer` → `/etg-writer/new`
- BCAFE Writer: `/bcafe-writer` → `/bcafe-writer/new`
- CanExport Claims: `/canexport-claims.html` → `/canexport-claims/new`

**Files Changed**: `dashboard.html`

---

## How It Works Now

### URL Structure
The agent interface supports multiple URL patterns:

1. **`/agent-name`** → New conversation (base route)
2. **`/agent-name/new`** → New conversation (explicit)
3. **`/agent-name/chat/{uuid}`** → Load existing conversation

The frontend (`agent-interface.js:95-123`) handles all three:
```javascript
if (path.includes('/chat/')) {
    // Load existing conversation
    this.conversationId = path.split('/chat/')[1];
    await this.loadConversationHistory();
} else {
    // New conversation
    this.conversationId = null;
}
```

### Conversation Flow

**Starting Fresh**:
1. User clicks agent card on dashboard
2. Navigates to `/etg-writer/new`
3. Welcome screen appears
4. User sends first message
5. Backend creates conversation with UUID
6. URL updates to `/etg-writer/chat/{uuid}`

**Continuing Existing**:
1. User clicks conversation in history sidebar
2. Navigates to `/etg-writer/chat/{uuid}`
3. All previous messages load from database
4. User can continue conversation

**Starting New from Existing**:
1. User clicks "🔄 New Conversation" button
2. Confirmation: "Start a new conversation? This will clear the current chat."
3. Navigates to `/etg-writer/new`
4. Fresh welcome screen
5. Old conversation preserved in history

---

## Testing Checklist

### Test 1: Dashboard to Agent (NEW!)
- [ ] Go to dashboard: `https://your-app.railway.app/dashboard`
- [ ] Click "ETG Business Case Writer" card
- [ ] **Expected**: URL is `/etg-writer/new`
- [ ] **Expected**: See welcome screen with quick actions
- [ ] **Expected**: No error in console

### Test 2: New Conversation Button (FIXED!)
- [ ] While in an agent page with messages
- [ ] Click "🔄 New Conversation" button
- [ ] **Expected**: Confirmation dialog appears
- [ ] Click "OK"
- [ ] **Expected**: URL changes to `/etg-writer/new`
- [ ] **Expected**: Welcome screen appears
- [ ] **Expected**: Old conversation still in history sidebar

### Test 3: Send Message Flow
- [ ] On `/etg-writer/new` page
- [ ] Type a message and send
- [ ] **Expected**: URL changes to `/etg-writer/chat/{some-uuid}`
- [ ] **Expected**: Response streams in
- [ ] **Expected**: Messages persist after refresh

### Test 4: History Sidebar (ALREADY WORKING)
- [ ] Click "☰ History" button
- [ ] **Expected**: Sidebar opens
- [ ] **Expected**: See your conversation(s) listed
- [ ] Click on a conversation
- [ ] **Expected**: Navigate to `/etg-writer/chat/{uuid}`
- [ ] **Expected**: All messages load

### Test 5: Export Button (BONUS FIX!)
- [ ] In a conversation with messages
- [ ] Click "📥 Export" button
- [ ] **Expected**: Downloads markdown file
- [ ] **Expected**: File name: `etg-conversation-YYYY-MM-DD.md`
- [ ] **Expected**: Contains all messages formatted

---

## What Was Deployed

### Commit 1: ETG Agent Functions
```
fix: Add startNewConversation and exportConversationAsMarkdown functions
```
Added missing JavaScript functions that were called by HTML buttons.

### Commit 2: Dashboard Links
```
fix: Update dashboard to link to /new URLs for agent pages
```
Changed dashboard agent card links to use explicit `/new` URLs.

---

## Technical Details

### Server Routing (Already Working)
The server has wildcard routes that match all variations:
```javascript
app.get('/etg-writer*', (req, res) => {
  res.sendFile('etg-agent.html', { root: '.' });
});
```

This matches:
- `/etg-writer` ✅
- `/etg-writer/new` ✅
- `/etg-writer/chat/550e8400-e29b-...` ✅

### Frontend Initialization
The `agent-interface.js` checks the URL on page load:
1. If contains `/chat/` → Load existing conversation from DB
2. Otherwise → Start fresh (conversationId = null)

### Conversation Persistence
- User sends first message → Backend creates conversation in DB
- Backend returns conversationId in SSE stream
- Frontend captures ID and updates URL
- All subsequent messages save to same conversation

---

## Verification Commands

### Check Railway Logs
After deployment, check for successful initialization:
```
✅ ETG Business Case Writer initialized successfully
✅ Event listeners setup complete
```

Should NOT see:
```
❌ Uncaught ReferenceError: startNewConversation is not defined
```

### Test in Browser Console
Open DevTools → Console and try:
```javascript
// Should be defined
typeof startNewConversation
// Expected: "function"

typeof exportConversationAsMarkdown
// Expected: "function"

// Check agent interface
window.agentInterface
// Expected: AgentInterface object
```

---

## Previous Fixes (Context)

This builds on the earlier fix for conversation history:

**Yesterday's Fix**: Database column mismatch
- Auth middleware queried non-existent columns (`role`, `is_active`, `last_login`)
- Caused all conversation history requests to fail with 401
- Fixed by removing references to those columns

**Today's Fix**: Missing JavaScript functions
- HTML buttons called functions that didn't exist
- Dashboard linked to wrong URLs
- Fixed by adding functions and updating links

---

## Files Modified (This Session)

1. **etg-agent.html** (+29 lines)
   - Added `startNewConversation()` function
   - Added `exportConversationAsMarkdown()` function

2. **dashboard.html** (3 changes)
   - Updated ETG writer link to `/etg-writer/new`
   - Updated BCAFE writer link to `/bcafe-writer/new`
   - Updated CanExport claims link to `/canexport-claims/new`

---

## Status

✅ **Conversation history loading** - Fixed yesterday
✅ **New Conversation button** - Fixed today
✅ **Export button** - Fixed today
✅ **Dashboard /new links** - Fixed today

🚀 **Ready to test on Railway!**

Wait 2-3 minutes for Railway to deploy, then run through the testing checklist above.
