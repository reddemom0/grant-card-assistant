# Google OAuth 404 Fix Guide

## Problem
Getting 404 error from Google during OAuth flow - this is a redirect_uri mismatch.

## Current Configuration (Correct in Code)

**auth-google.js** (line 12):
```javascript
const redirectUri = 'https://grant-card-assistant.vercel.app/api/auth-callback';
```

**auth-callback.js** (line 22):
```javascript
'https://grant-card-assistant.vercel.app/api/auth-callback'
```

✅ Both files correctly use: `https://grant-card-assistant.vercel.app/api/auth-callback`

## Issue: Google Cloud Console Not Configured

The redirect_uri is NOT authorized in your Google Cloud Console OAuth credentials.

## How to Fix

### Step 1: Go to Google Cloud Console

1. Visit: https://console.cloud.google.com/apis/credentials
2. Select your project (or the project containing your OAuth client)
3. Find your OAuth 2.0 Client ID under "OAuth 2.0 Client IDs"
4. Click on the client ID name to edit it

### Step 2: Add Authorized Redirect URI

In the OAuth client configuration page:

1. Scroll to **"Authorized redirect URIs"** section
2. Click **"+ ADD URI"**
3. Enter EXACTLY: `https://grant-card-assistant.vercel.app/api/auth-callback`
4. Click **"SAVE"** at the bottom

### Step 3: Verify Environment Variables in Vercel

Make sure these are set in Vercel:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
JWT_SECRET=your-jwt-secret
POSTGRES_URL=your-postgres-connection-string
```

To check/set in Vercel:
1. Go to: https://vercel.com/your-team/grant-card-assistant/settings/environment-variables
2. Verify all 4 variables exist
3. If missing, add them and redeploy

### Step 4: Test the Flow

1. Clear browser cookies/cache
2. Visit: https://grant-card-assistant.vercel.app/login.html
3. Click "Sign in with Google"
4. Should redirect to Google login
5. After auth, should redirect to `/dashboard.html`

## Additional Setup Needed

### Create Database Table

Your `auth-callback.js` expects a `users` table. Run this SQL in your Postgres database:

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  last_login TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_users_email ON users(email);
```

### Create Login Page

If you don't have `login.html`, create it:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Login - Granted Consulting</title>
</head>
<body>
    <h1>Sign In</h1>
    <a href="/api/auth-google">
        <button>Sign in with Google</button>
    </a>
</body>
</html>
```

## Testing Checklist

- [ ] Redirect URI added to Google Cloud Console
- [ ] Environment variables set in Vercel
- [ ] Database table created
- [ ] Login page exists
- [ ] Can click "Sign in with Google"
- [ ] Google auth screen appears (not 404)
- [ ] After auth, redirects to dashboard
- [ ] Cookie is set (`auth_token`)

## Common Issues

### 404 Error
**Cause**: Redirect URI not authorized in Google Cloud Console
**Fix**: Add the exact URI to authorized redirect URIs

### 401 Error
**Cause**: Wrong client_id or client_secret
**Fix**: Verify environment variables match Google Cloud Console

### 500 Error on Callback
**Cause**: Database connection issue or missing table
**Fix**: Check POSTGRES_URL and create users table

### "Invalid redirect_uri" Error
**Cause**: Typo in redirect URI (http vs https, trailing slash, etc.)
**Fix**: Must be EXACT: `https://grant-card-assistant.vercel.app/api/auth-callback`

## Current OAuth Flow

1. User visits `/login.html`
2. Clicks "Sign in with Google"
3. Browser goes to `/api/auth-google`
4. Redirects to Google OAuth page
5. User authorizes
6. **Google redirects to `/api/auth-callback`** ← This is where 404 happens
7. Callback exchanges code for tokens
8. Creates/updates user in database
9. Sets JWT cookie
10. Redirects to `/dashboard.html`

## Quick Fix Commands

After adding redirect URI to Google Cloud Console:

```bash
# No code changes needed - just redeploy to ensure everything is up to date
cd ~/grant-card-assistant
git pull origin main
vercel --prod
```

## Verification URLs

- OAuth config: https://console.cloud.google.com/apis/credentials
- Vercel env vars: https://vercel.com/settings/environment-variables
- Test login: https://grant-card-assistant.vercel.app/login.html
- Test callback directly: https://grant-card-assistant.vercel.app/api/auth-callback (should return 400 "No authorization code")

---

**Next Step**: Add `https://grant-card-assistant.vercel.app/api/auth-callback` to Google Cloud Console OAuth authorized redirect URIs, then test again.