# Phase 4 Testing Guide

## 🎯 What You're Testing

Phase 4 implements complete user authentication with Google OAuth and user-scoped conversations. This guide will walk you through testing every feature.

---

## 📋 Pre-Testing Checklist

### 1. Environment Variables (Verify in Vercel Dashboard)

Go to: https://vercel.com/your-project/settings/environment-variables

**Required Variables:**
- ✅ `GOOGLE_CLIENT_ID` - Your OAuth client ID
- ✅ `GOOGLE_CLIENT_SECRET` - Your OAuth client secret
- ✅ `JWT_SECRET` - Random secret string (generate with `openssl rand -base64 32`)
- ✅ `DATABASE_URL` - PostgreSQL connection string (Neon)
- ✅ `UPSTASH_REDIS_REST_URL` - Redis URL
- ✅ `UPSTASH_REDIS_REST_TOKEN` - Redis token
- ✅ `ANTHROPIC_API_KEY` - Claude API key

### 2. Google OAuth Console Setup

Go to: https://console.cloud.google.com/apis/credentials

**Authorized JavaScript origins:**
- `https://grant-card-assistant.vercel.app`
- `https://grant-card-assistant-git-development-your-name.vercel.app` (preview)

**Authorized redirect URIs:**
- `https://grant-card-assistant.vercel.app/api/auth-callback`
- `https://grant-card-assistant-git-development-your-name.vercel.app/api/auth-callback` (preview)

### 3. Deploy to Preview

```bash
# You've already pushed to development, so Vercel should auto-deploy
# Check your Vercel dashboard for the preview URL
```

---

## 🧪 Test Scenarios

### Test 1: Initial Login Flow ⭐ CRITICAL

**What you're testing:** Complete Google OAuth flow from start to finish

**Steps:**
1. Open **Chrome Incognito** window
2. Go to your preview URL: `https://grant-card-assistant-git-development-[your-name].vercel.app`
3. You should see the landing page with "Sign in with Google" button
4. Click "Sign in with Google"

**✅ Expected Results:**
- Redirects to Google OAuth page
- Shows Google account selection
- After selecting account, redirects back to `/dashboard`
- Dashboard shows your name and profile picture
- No redirect loops
- No console errors

**❌ If it fails:**
- Check console for errors (F12 → Console tab)
- Verify Google OAuth redirect URI matches exactly
- Check Vercel logs: `Deployment → Functions → View Logs`

---

### Test 2: Session Persistence

**What you're testing:** Cookie-based session survives page refreshes

**Steps:**
1. After logging in (Test 1), refresh the dashboard page (F5)
2. Navigate to different pages:
   - Click "Grant Cards" from dashboard
   - Visit `/etg-writer` directly in URL bar
   - Visit `/bcafe-writer` directly in URL bar
   - Visit `/canexport-claims` directly in URL bar

**✅ Expected Results:**
- Dashboard still shows your name/picture after refresh
- All agent pages are accessible
- User profile dropdown appears on all agent pages
- No redirects to login page

**❌ If it fails:**
- Open DevTools → Application → Cookies
- Verify `granted_session` cookie exists
- Check cookie properties: HttpOnly=true, Secure=true, SameSite=Lax
- Check cookie value is not empty

---

### Test 3: Unauthenticated Access Protection

**What you're testing:** Logged-out users can't access agent pages

**Steps:**
1. While logged in, click your profile dropdown
2. Click "Logout"
3. Try to visit agent pages directly:
   - Type in URL: `/grant-cards`
   - Type in URL: `/dashboard`
   - Type in URL: `/etg-writer`

**✅ Expected Results:**
- Logout redirects to `/` (landing page)
- Trying to access `/grant-cards` → redirects to `/`
- Trying to access `/dashboard` → redirects to `/`
- Trying to access `/etg-writer` → redirects to `/`
- Landing page shows "Sign in with Google" button

**❌ If it fails:**
- Check browser console for JavaScript errors
- Verify `granted_session` cookie was deleted
- Check DevTools → Application → Cookies (should be empty)

---

### Test 4: User Profile Display

**What you're testing:** User info displays correctly on all pages

**Steps:**
1. Log in (Test 1)
2. Visit each agent page:
   - `/grant-cards`
   - `/etg-writer`
   - `/bcafe-writer`
   - `/canexport-claims`
3. On each page, check the top-right user profile area

**✅ Expected Results:**
- Your Google profile picture displays (circular avatar)
- Your name displays next to avatar
- Clicking avatar shows dropdown with:
  - Your name/email
  - "Dashboard" link
  - "Logout" button
- Dropdown works on all pages

**❌ If it fails:**
- Open console, check for JWT decode errors
- Verify JWT token contains: `userId`, `email`, `name`, `picture`
- Check network tab for `/api/auth-callback` response

---

### Test 5: Conversation Creation & Persistence

**What you're testing:** User-scoped conversation storage

**Steps:**
1. Log in as User A (your Google account)
2. Go to `/grant-cards`
3. Send a message: "What is the ETG grant?"
4. Wait for response
5. Check conversation sidebar (left side)

**✅ Expected Results:**
- Message sends successfully
- Response appears (Claude AI reply)
- Conversation appears in left sidebar
- Conversation title shows first few words of your message
- Message count shows "2" (your message + AI response)

**❌ If it fails:**
- Check console for API errors
- Check Network tab → `/api/process-grant/stream`
- Verify `granted_session` cookie is sent with request
- Check Vercel function logs for errors

---

### Test 6: Conversation History Loading

**What you're testing:** Sidebar loads user's conversations

**Steps:**
1. Create 3-4 conversations in Grant Cards agent (different messages)
2. Refresh the page (F5)
3. Look at the left sidebar

**✅ Expected Results:**
- All your conversations appear in sidebar
- Sorted by most recent first
- Each shows title and message count
- Clicking a conversation loads it
- Currently active conversation is highlighted

**❌ If it fails:**
- Check browser console for errors
- Check Network tab → `/api/conversations` request
- Verify response includes all conversations
- Check PostgreSQL database for conversations table

---

### Test 7: Multi-User Isolation ⭐ CRITICAL

**What you're testing:** Users can't see each other's conversations

**Steps:**
1. **Browser 1 (Chrome):** Log in with your Google account (User A)
2. Create a conversation: "User A's private conversation"
3. Note the conversation appears in your sidebar
4. **Browser 2 (Firefox or Incognito):** Log in with DIFFERENT Google account (User B)
5. Check the sidebar in Browser 2

**✅ Expected Results:**
- User B's sidebar is EMPTY (no conversations yet)
- User B does NOT see User A's conversation
- User B creates their own conversation: "User B's conversation"
- User A's sidebar (Browser 1) does NOT show User B's conversation
- Each user has completely separate conversation history

**❌ If it fails - CRITICAL SECURITY ISSUE:**
- Check `/api/conversations` SQL query includes `WHERE user_id = $1`
- Verify JWT `userId` is being extracted correctly
- Check PostgreSQL: `SELECT * FROM conversations` should show different `user_id` values
- This is a security bug - conversations are leaking between users!

---

### Test 8: Conversation Switching

**What you're testing:** Clicking sidebar conversations loads them

**Steps:**
1. Create 3 conversations with different messages:
   - "What is ETG?"
   - "Tell me about BCAFE"
   - "How does CanExport work?"
2. Click on second conversation in sidebar
3. Click on third conversation
4. Click on first conversation

**✅ Expected Results:**
- Each click loads the correct conversation
- Messages display in correct order
- Current conversation is highlighted in sidebar
- Chat input remains at bottom
- No duplicate messages

**❌ If it fails:**
- Check `/api/conversation/{id}` endpoint
- Verify it returns correct messages for conversation ID
- Check that `user_id` is being validated in query

---

### Test 9: Conversation Deletion

**What you're testing:** Delete button removes conversations

**Steps:**
1. Create a test conversation
2. Hover over the conversation in sidebar
3. Click the delete/trash icon (🗑️)
4. Confirm deletion (if prompted)

**✅ Expected Results:**
- Conversation disappears from sidebar immediately
- If conversation was active, chat area clears
- Conversation is gone after page refresh
- Other conversations remain untouched

**❌ If it fails:**
- Check `/api/conversation/{id}` DELETE request
- Verify SQL: `DELETE FROM conversations WHERE id = $1 AND user_id = $2`
- Check that foreign key cascade deletes messages too

---

### Test 10: Logout & Re-login

**What you're testing:** Complete auth lifecycle

**Steps:**
1. Log in, create a conversation
2. Logout (profile dropdown → Logout)
3. Verify you're on landing page
4. Log in again with SAME Google account
5. Check conversation sidebar

**✅ Expected Results:**
- After logout, redirected to `/`
- Cannot access `/grant-cards` (redirects to `/`)
- After re-login, redirected to `/dashboard`
- Conversation sidebar shows previous conversations
- Your data persists across sessions

**❌ If it fails:**
- Check cookie deletion on logout
- Verify new JWT token is created on re-login
- Check PostgreSQL conversations are still there

---

### Test 11: Agent Page Access Control

**What you're testing:** All 4 agent pages require authentication

**Steps:**
1. Logout completely
2. Try to access each agent page directly (type URL):
   - `/grant-cards`
   - `/etg-writer`
   - `/bcafe-writer`
   - `/canexport-claims`

**✅ Expected Results:**
- All 4 pages redirect to `/` (login)
- No agent page content is visible
- "Sign in with Google" button appears
- After login, you CAN access all pages

---

### Test 12: Dashboard Navigation

**What you're testing:** Dashboard links work correctly

**Steps:**
1. Log in, go to `/dashboard`
2. Click each agent card:
   - Grant Card Assistant
   - CanExport Claims Assistant
   - ETG Business Case Specialist
   - BC Agriculture Export Specialist

**✅ Expected Results:**
- Each card navigates to correct agent page
- Agent page loads with user profile visible
- "Coming Soon" agents show alert, don't navigate

---

### Test 13: Cross-Browser Session Isolation

**What you're testing:** Sessions are separate per browser

**Steps:**
1. **Chrome:** Log in as User A, create conversation "Chrome A"
2. **Firefox:** Log in as SAME User A
3. Check sidebar in Firefox

**✅ Expected Results:**
- Firefox sidebar shows "Chrome A" conversation (same user)
- Creating conversation in Firefox appears in Chrome after refresh
- Same user's data syncs across browsers (because same user_id)

---

### Test 14: JWT Token Expiration (Long-term)

**What you're testing:** 7-day token expiration works

**Steps:**
1. Log in
2. Note the time
3. **Wait 7 days** (or manually expire cookie in DevTools)
4. Try to access `/grant-cards`

**✅ Expected Results:**
- After 7 days, redirected to login
- Must log in again to access agents

**🔧 To test now:**
- DevTools → Application → Cookies
- Edit `granted_session` cookie
- Change Max-Age to 1 second
- Wait 2 seconds
- Try to access `/grant-cards` → should redirect to `/`

---

## 🐛 Common Issues & Fixes

### Issue 1: OAuth Redirect Loop
**Symptom:** Keeps redirecting between `/` and `/dashboard`

**Cause:** Cookie not being set or wrong cookie name

**Fix:**
- Check DevTools → Application → Cookies
- Verify `granted_session` cookie exists
- Check cookie domain matches your site
- Verify Secure flag is set (requires HTTPS)

### Issue 2: "Unauthorized" Error
**Symptom:** All API requests return 401

**Cause:** JWT token not being sent or invalid

**Fix:**
- Check Network tab, verify `Cookie: granted_session=...` header
- Verify JWT_SECRET environment variable is set in Vercel
- Check backend logs for JWT verification errors

### Issue 3: Can See Other User's Conversations
**Symptom:** User B sees User A's conversations

**Cause:** CRITICAL - Missing user_id in SQL queries

**Fix:**
- Check API code: `/api/conversations` should have `WHERE user_id = $1`
- Verify `getUserIdFromJWT()` is being called
- This is a security bug - must be fixed immediately!

### Issue 4: Profile Picture Not Showing
**Symptom:** Avatar is blank circle

**Cause:** JWT doesn't contain `picture` field

**Fix:**
- Check JWT payload in console: `getUserInfo()`
- Verify Google OAuth scopes include `profile`
- Check auth-callback.js includes `picture` in JWT

### Issue 5: Conversation Sidebar Empty
**Symptom:** Created conversations don't appear in sidebar

**Cause:** Not saving to PostgreSQL or Redis issue

**Fix:**
- Check Network tab → `/api/process-grant/stream` response
- Check Vercel logs for database errors
- Verify `DATABASE_URL` environment variable is set
- Check PostgreSQL connection

---

## 📊 Success Criteria

Phase 4 is working correctly if:

✅ **Authentication:**
- [ ] Google OAuth login works
- [ ] JWT token is set as `granted_session` cookie
- [ ] Cookie persists across page refreshes
- [ ] Logout clears session

✅ **Access Control:**
- [ ] Unauthenticated users cannot access agent pages
- [ ] All 4 agent pages redirect to `/` when logged out
- [ ] Dashboard is only accessible when logged in

✅ **User Profile:**
- [ ] Name and avatar display on all pages
- [ ] Dropdown menu works on all pages
- [ ] Dashboard link works from all pages
- [ ] Logout works from all pages

✅ **Conversation Management:**
- [ ] Can create conversations in all agents
- [ ] Conversations appear in sidebar
- [ ] Conversations load when clicked
- [ ] Conversations persist after refresh
- [ ] Can delete conversations

✅ **User Isolation (CRITICAL):**
- [ ] User A cannot see User B's conversations
- [ ] User B cannot see User A's conversations
- [ ] Each user has separate conversation history
- [ ] Deleting conversation only affects owner

---

## 🚀 After Testing

### If Everything Works:
1. Merge `development` → `main`
2. Vercel will auto-deploy to production
3. Test production URL one more time
4. Announce Phase 4 is live! 🎉

### If Issues Found:
1. Document the issue in detail
2. Check relevant section in troubleshooting
3. Fix the issue in development branch
4. Retest
5. Push fix, redeploy preview

---

## 🔍 Debugging Tools

### Browser Console
```javascript
// Check if authenticated
document.cookie.includes('granted_session')

// Decode JWT token
function getUserInfo() {
  const cookies = document.cookie.split(';');
  const authCookie = cookies.find(c => c.trim().startsWith('granted_session='));
  if (!authCookie) return null;
  const token = authCookie.split('=')[1];
  const payload = token.split('.')[1];
  return JSON.parse(atob(payload));
}
getUserInfo()
```

### Network Tab
- Watch for `/api/auth-google` → should redirect to Google
- Watch for `/api/auth-callback` → should set cookie
- Watch for `/api/conversations` → should return user's conversations
- Watch for `/api/process-grant/stream` → should stream AI responses

### Vercel Logs
```bash
# In terminal
vercel logs grant-card-assistant --follow

# Or in Vercel dashboard:
# Deployment → Functions → View Logs
```

### PostgreSQL Check
```sql
-- Check users table
SELECT id, email, name FROM users;

-- Check conversations by user
SELECT c.id, c.user_id, c.title, u.email
FROM conversations c
JOIN users u ON c.user_id = u.id
ORDER BY c.created_at DESC;

-- Check messages count
SELECT c.id, c.title, COUNT(m.id) as message_count
FROM conversations c
LEFT JOIN messages m ON m.conversation_id = c.id
GROUP BY c.id;
```

---

## 📞 Need Help?

If you encounter issues during testing:

1. **Check Documentation:**
   - `OAUTH-FLOW-AUDIT.md` - OAuth flow details
   - `PHASE-4-BACKEND-API-AUDIT.md` - API security details
   - `PHASE-4-DATABASE-STATUS.md` - Database schema

2. **Check Logs:**
   - Browser console (F12)
   - Network tab (F12 → Network)
   - Vercel function logs

3. **Common Fixes:**
   - Clear cookies and try again
   - Hard refresh (Ctrl+Shift+R)
   - Check environment variables in Vercel
   - Verify Google OAuth redirect URIs

---

**Good luck with testing! 🚀**

Phase 4 represents a major milestone - complete user authentication with conversation isolation. Take your time testing, especially the multi-user scenarios.
