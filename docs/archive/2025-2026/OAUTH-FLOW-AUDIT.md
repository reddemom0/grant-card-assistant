# Google OAuth Flow - Complete Audit

## 🚨 CRITICAL ISSUE FOUND: Cookie Name Mismatch

### Problem
**Backend sets:** `granted_session` cookie
**Frontend expects:** `auth_token` cookie

This breaks authentication! Users can log in but frontend can't read the session.

---

## 1. OAuth Initiation ✅ CORRECT

### Frontend (index.html:569)
```html
<a href="/api/auth-google" class="google-login-btn">
  Sign in with Google
</a>
```

### Backend Handler (api/auth-google.js)
```javascript
export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = 'https://grant-card-assistant.vercel.app/api/auth-callback';

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent('profile email')}&` +
    `access_type=offline&` +
    `prompt=select_account`;

  res.redirect(googleAuthUrl);
}
```

**Status:** ✅ **Working**
- Redirects to Google OAuth
- Requests `profile` and `email` scopes
- Uses correct redirect URI

**Routing (vercel.json:4-6):**
```json
{
  "src": "/api/auth-google",
  "dest": "/api/auth-google.js"
}
```

---

## 2. OAuth Callback Handler ✅ MOSTLY CORRECT

### Backend Handler (api/auth-callback.js)

**Step 1: Exchange Code for Tokens** ✅
```javascript
// Line 22-30
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://grant-card-assistant.vercel.app/api/auth-callback'
);

const { tokens } = await oauth2Client.getToken(code);
oauth2Client.setCredentials(tokens);
```

**Step 2: Get User Info from Google** ✅
```javascript
// Line 32-34
const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
const { data: userInfo } = await oauth2.userinfo.get();
```

Returns:
```javascript
{
  id: "google-user-id",
  email: "user@example.com",
  name: "User Name",
  picture: "https://profile-pic-url"
}
```

**Step 3: Create/Update User in Database** ✅
```javascript
// Line 40-43
const userResult = await client.query(
  'INSERT INTO users (google_id, email, name, picture)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (google_id)
   DO UPDATE SET name = $2, picture = $4
   RETURNING id, email, name, picture',
  [userInfo.id, userInfo.email, userInfo.name, userInfo.picture]
);

const user = userResult.rows[0];
```

**PostgreSQL Table:**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Step 4: Generate JWT Token** ✅
```javascript
// Line 48-57
const token = jwt.sign(
  {
    userId: user.id,        // UUID from database
    email: user.email,
    name: user.name,
    picture: user.picture
  },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }       // 7 day expiration
);
```

**Step 5: Set HTTP-Only Cookie** ⚠️ **WRONG NAME**
```javascript
// Line 60-62
res.setHeader('Set-Cookie',
  `granted_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
);
```

**Cookie Properties:**
- ✅ `HttpOnly` - JavaScript cannot access (XSS protection)
- ✅ `Secure` - Only sent over HTTPS
- ✅ `SameSite=Lax` - CSRF protection
- ✅ `Path=/` - Available on all routes
- ✅ `Max-Age=604800` - 7 days (matches JWT expiration)
- ❌ **Name is `granted_session`** - Frontend expects `auth_token`!

**Step 6: Redirect to Dashboard** ✅
```javascript
// Line 64-70
const userDataEncoded = encodeURIComponent(JSON.stringify({
  name: user.name,
  email: user.email,
  picture: user.picture
}));
res.redirect(`/dashboard.html#user=${userDataEncoded}`);
```

**Routing (vercel.json:8-10):**
```json
{
  "src": "/api/auth-callback",
  "dest": "/api/auth-callback.js"
}
```

---

## 3. Backend JWT Extraction ✅ CORRECT (But Wrong Cookie Name)

### getUserIdFromJWT() Function (api/server.js:288-317)

```javascript
function getUserIdFromJWT(req) {
  const cookies = req.headers.cookie || '';

  // ❌ Looking for granted_session cookie
  const tokenMatch = cookies.match(/granted_session=([^;]+)/);

  if (!tokenMatch) {
    return null;
  }

  const token = tokenMatch[1];

  // Verify JWT signature
  const decoded = jwt.verify(token, JWT_SECRET);

  // Extract userId (UUID from database)
  const userId = decoded.userId;

  return userId;
}
```

**Backend expects:** `granted_session` cookie
**Backend sets:** `granted_session` cookie ✅ Consistent

---

## 4. Frontend Auth Checking ❌ WRONG COOKIE NAME

### All Agent Pages Check for `auth_token`

**Example from grant-cards.html (line 1796-1806):**
```javascript
function checkAuth() {
  const cookies = document.cookie.split(';');

  // ❌ Looking for auth_token cookie (but backend sets granted_session!)
  const authToken = cookies.find(c => c.trim().startsWith('auth_token='));

  if (!authToken) {
    console.log('No auth token found, redirecting to login...');
    window.location.href = '/';
    return false;
  }

  return true;
}
```

**Files with Wrong Cookie Name:**
1. ❌ `grant-cards.html:1796` - checks `auth_token`
2. ❌ `etg-agent.html` - checks `auth_token`
3. ❌ `bcafe-agent.html:1937` - checks `auth_token`
4. ❌ `canexport-claims.html:2046` - checks `auth_token`
5. ❌ `dashboard.html:864` - checks `auth_token`
6. ❌ `index.html:866` - checks `auth_token`

### getUserInfo() Functions ❌ WRONG COOKIE NAME

**Example from grant-cards.html (line 1809-1824):**
```javascript
function getUserInfo() {
  const cookies = document.cookie.split(';');

  // ❌ Looking for auth_token (should be granted_session)
  const authCookie = cookies.find(c => c.trim().startsWith('auth_token='));

  if (!authCookie) return null;

  const token = authCookie.split('=')[1];

  // Decode JWT payload (base64)
  const payload = token.split('.')[1];
  const decoded = JSON.parse(atob(payload));

  return decoded;  // { userId, email, name, picture }
}
```

### Logout Functions ❌ WRONG COOKIE NAME

**Example from grant-cards.html (line 1843-1851):**
```javascript
async function logout() {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) {
    console.error('Logout request failed:', e);
  }

  // ❌ Deleting auth_token (should be granted_session)
  document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  window.location.href = '/';
}
```

---

## 5. Session Management Summary

### Cookie Lifecycle

**1. Login Flow:**
```
User clicks "Sign in with Google" (index.html)
  ↓
GET /api/auth-google
  ↓
Redirect to Google OAuth
  ↓
User approves
  ↓
Google redirects to /api/auth-callback?code=...
  ↓
Exchange code for tokens
Get user info from Google
Create/update user in PostgreSQL
Generate JWT token
Set granted_session cookie ← ✅ Backend sets this
Redirect to /dashboard
```

**2. Authenticated Requests:**
```
User visits /grant-cards
  ↓
Frontend checkAuth() looks for auth_token ← ❌ Wrong name!
  ↓
Cookie not found (because it's named granted_session)
  ↓
Redirect to / (login page)
```

**Current Behavior:**
- ❌ User logs in successfully
- ❌ Cookie is set as `granted_session`
- ❌ Frontend looks for `auth_token`
- ❌ Frontend thinks user is not logged in
- ❌ Redirects to login page
- ❌ **Infinite loop or broken auth**

---

## 6. Environment Variables Required

### Backend OAuth (api/auth-callback.js)
```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
JWT_SECRET=random-secret-string
DATABASE_URL=postgresql://...
```

### Google OAuth Console Setup
**Authorized JavaScript origins:**
- `https://grant-card-assistant.vercel.app`
- `http://localhost:3000` (for local dev)

**Authorized redirect URIs:**
- `https://grant-card-assistant.vercel.app/api/auth-callback`
- `http://localhost:3000/api/auth-callback` (for local dev)

---

## 7. Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User clicks "Sign in with Google" (index.html)          │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. GET /api/auth-google                                     │
│    - Redirects to Google OAuth                              │
│    - Requests: profile, email scopes                        │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. User approves on Google                                  │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Google redirects to /api/auth-callback?code=...          │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Exchange code for tokens (Google API)                    │
│    - POST to https://oauth2.googleapis.com/token            │
│    - Get access_token & id_token                            │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Get user info (Google API)                               │
│    - GET https://www.googleapis.com/oauth2/v2/userinfo      │
│    - Returns: { id, email, name, picture }                  │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. Create/update user in PostgreSQL                         │
│    INSERT INTO users (google_id, email, name, picture)      │
│    ON CONFLICT (google_id) DO UPDATE                        │
│    RETURNING id (UUID)                                       │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 8. Generate JWT token                                        │
│    Payload: { userId, email, name, picture }                │
│    Sign with JWT_SECRET                                      │
│    Expiration: 7 days                                        │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 9. Set HTTP-only cookie                                      │
│    Name: granted_session ← ❌ WRONG (frontend expects       │
│                               auth_token)                    │
│    Value: JWT token                                          │
│    HttpOnly: true (XSS protection)                           │
│    Secure: true (HTTPS only)                                 │
│    SameSite: Lax (CSRF protection)                           │
│    Max-Age: 604800 seconds (7 days)                          │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 10. Redirect to /dashboard.html                              │
│     With user data in URL hash (temporary display)           │
└─────────────────────┬───────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ 11. Dashboard loads                                          │
│     - checkAuth() looks for auth_token ← ❌ WRONG NAME      │
│     - Cookie not found (it's granted_session)               │
│     - Redirects to / (login)                                 │
│     - ❌ BROKEN AUTH LOOP                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 THE FIX

### Option 1: Change Frontend to Use `granted_session` (Recommended)

**Files to update (6 files):**
1. `grant-cards.html`
2. `etg-agent.html`
3. `bcafe-agent.html`
4. `canexport-claims.html`
5. `dashboard.html`
6. `index.html`

**Find and replace:**
```javascript
// OLD (wrong)
const authToken = cookies.find(c => c.trim().startsWith('auth_token='));
const authCookie = cookies.find(c => c.trim().startsWith('auth_token='));
document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';

// NEW (correct)
const authToken = cookies.find(c => c.trim().startsWith('granted_session='));
const authCookie = cookies.find(c => c.trim().startsWith('granted_session='));
document.cookie = 'granted_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
```

### Option 2: Change Backend to Use `auth_token` (Not Recommended)

**Files to update (2 files):**
1. `api/auth-callback.js:61` - Cookie name in Set-Cookie header
2. `api/server.js:292` - Cookie name in regex match

**Why not recommended:**
- Backend already uses `granted_session` consistently
- `SESSION_COOKIE_NAME` constant defined (line 160)
- More files to update if backend changes

---

## 🎯 Recommended Action

**Update all 6 frontend HTML files** to use `granted_session` cookie name.

This is a **critical bug** that breaks authentication. Once fixed:
- ✅ Users can log in with Google
- ✅ Frontend recognizes authenticated session
- ✅ Users can access all agent pages
- ✅ Logout works correctly
- ✅ JWT token properly verified on backend

---

## Verification After Fix

**Test Flow:**
1. Visit `/` → see Google login button
2. Click "Sign in with Google"
3. Complete OAuth flow
4. Redirected to `/dashboard`
5. Dashboard shows user name/avatar ✅
6. Visit `/grant-cards` → works (not redirected) ✅
7. Create conversation ✅
8. Logout → redirected to `/` ✅
9. Try to visit `/grant-cards` → redirected to `/` ✅

---

## Files Reference

| File | Purpose | Cookie Name |
|------|---------|-------------|
| `api/auth-google.js` | OAuth initiation | - |
| `api/auth-callback.js:61` | OAuth callback | `granted_session` ✅ |
| `api/server.js:160` | Cookie constant | `granted_session` ✅ |
| `api/server.js:292` | JWT extraction | `granted_session` ✅ |
| `grant-cards.html:1796` | Auth check | `auth_token` ❌ |
| `etg-agent.html` | Auth check | `auth_token` ❌ |
| `bcafe-agent.html:1937` | Auth check | `auth_token` ❌ |
| `canexport-claims.html:2046` | Auth check | `auth_token` ❌ |
| `dashboard.html:864` | Auth check | `auth_token` ❌ |
| `index.html:866` | Auth check | `auth_token` ❌ |

---

**Priority:** 🚨 **CRITICAL - MUST FIX BEFORE DEPLOY**

**Estimated Fix Time:** 5 minutes (find/replace in 6 files)
