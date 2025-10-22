# HubSpot & Google Drive API Setup Guide

This guide explains how to connect HubSpot CRM and Google Drive to your Railway deployment.

---

## 🔧 HubSpot CRM Integration

### Step 1: Get HubSpot Access Token

1. **Log in to HubSpot**
   - Go to https://app.hubspot.com/
   - Log in with your HubSpot account

2. **Navigate to Private Apps**
   - Click on settings icon (gear icon in top right)
   - In the left sidebar, go to: **Integrations** → **Private Apps**

3. **Create a Private App**
   - Click "Create a private app"
   - Give it a name: `Grant Card Assistant`
   - Description: `AI assistant for grant management`

4. **Configure Scopes** (required permissions):
   - **Contacts**: `crm.objects.contacts.read`, `crm.objects.contacts.write`
   - **Companies**: `crm.objects.companies.read`, `crm.objects.companies.write`
   - **Deals**: `crm.objects.deals.read`, `crm.objects.deals.write`

5. **Generate Token**
   - Click "Create app"
   - Copy the access token (starts with `pat-na1-...`)
   - ⚠️ **Save this token securely** - you won't be able to see it again!

### Step 2: Add to Railway

1. Go to your Railway dashboard: https://railway.app/
2. Select your project: `grant-card-assistant-production`
3. Go to **Variables** tab
4. Add new variable:
   ```
   HUBSPOT_ACCESS_TOKEN=pat-na1-YOUR-TOKEN-HERE
   ```
5. Click "Save" - Railway will auto-redeploy

### Step 3: Test HubSpot Connection

Once deployed, test it by asking an agent:
```
"Search for contacts matching 'john'"
```

The agent should use the `search_hubspot_contacts` tool and return results.

---

## 📁 Google Drive Integration

### Step 1: Create Google Cloud Project

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com/
   - Sign in with your Google account

2. **Create a new project**
   - Click "Select a project" → "New Project"
   - Project name: `Grant Card Assistant`
   - Click "Create"

### Step 2: Enable Google Drive API

1. **Navigate to APIs & Services**
   - In the left menu: **APIs & Services** → **Library**

2. **Enable APIs**
   - Search for "Google Drive API" → Click it → Click "Enable"
   - Search for "Google Docs API" → Click it → Click "Enable"

### Step 3: Create OAuth 2.0 Credentials

1. **Go to Credentials**
   - Left menu: **APIs & Services** → **Credentials**

2. **Configure OAuth Consent Screen**
   - Click "OAuth consent screen" tab
   - User Type: **Internal** (if using Google Workspace) or **External**
   - App name: `Grant Card Assistant`
   - User support email: Your email
   - Developer contact: Your email
   - Click "Save and Continue"
   - Scopes: Add these scopes:
     - `https://www.googleapis.com/auth/drive.readonly`
     - `https://www.googleapis.com/auth/documents.readonly`
   - Click "Save and Continue"

3. **Create OAuth Client**
   - Click "Credentials" tab
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: **Web application**
   - Name: `Grant Card Assistant`
   - Authorized redirect URIs: `http://localhost:3000/oauth2callback`
   - Click "Create"
   - **Copy the Client ID and Client Secret**

### Step 4: Get Refresh Token

You need to authorize the app once to get a refresh token. Here's how:

1. **Create a test script** on your local machine:

```javascript
// get-google-token.js
import { google } from 'googleapis';
import http from 'http';
import url from 'url';
import open from 'open';

const CLIENT_ID = 'YOUR_CLIENT_ID_HERE';
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET_HERE';
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Generate the url that will be used for authorization
const authorizeUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/documents.readonly'
  ]
});

console.log('Visit this URL to authorize the app:');
console.log(authorizeUrl);

// Open browser automatically
open(authorizeUrl);

// Create a simple HTTP server to receive the callback
const server = http.createServer(async (req, res) => {
  if (req.url.indexOf('/oauth2callback') > -1) {
    const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
    const code = qs.get('code');

    res.end('Authentication successful! You can close this window.');
    server.close();

    // Get the access token and refresh token
    const { tokens } = await oauth2Client.getToken(code);

    console.log('\n✅ Success! Add these to Railway:');
    console.log('\nGOOGLE_DRIVE_CLIENT_ID=' + CLIENT_ID);
    console.log('GOOGLE_DRIVE_CLIENT_SECRET=' + CLIENT_SECRET);
    console.log('GOOGLE_DRIVE_REFRESH_TOKEN=' + tokens.refresh_token);
  }
});

server.listen(3000, () => {
  console.log('\nWaiting for authorization...\n');
});
```

2. **Run the script**:
```bash
npm install googleapis open
node get-google-token.js
```

3. **Authorize the app**:
   - Browser should open automatically
   - Sign in with your Google account
   - Click "Allow" to grant permissions
   - You'll see the tokens printed in the terminal

4. **Copy the tokens** (you'll need these for Railway)

### Step 5: Add to Railway

1. Go to your Railway dashboard
2. Select your project: `grant-card-assistant-production`
3. Go to **Variables** tab
4. Add these three variables:
   ```
   GOOGLE_DRIVE_CLIENT_ID=YOUR-CLIENT-ID.apps.googleusercontent.com
   GOOGLE_DRIVE_CLIENT_SECRET=YOUR-CLIENT-SECRET
   GOOGLE_DRIVE_REFRESH_TOKEN=YOUR-REFRESH-TOKEN
   ```
5. Click "Save" - Railway will auto-redeploy

### Step 6: Test Google Drive Connection

Once deployed, test it by asking an agent:
```
"Read this document: https://docs.google.com/document/d/FILE_ID/edit"
```

The agent should use the `read_google_drive_file` tool and return the document contents.

---

## 🧪 Testing Both Integrations

### Test HubSpot

**Supported tools:**
1. `search_hubspot_contacts` - Search for contacts
2. `get_hubspot_contact` - Get contact by ID
3. `search_hubspot_companies` - Search for companies
4. `search_grant_applications` - Search deals/applications
5. `get_grant_application` - Get application by ID

**Example prompts:**
```
"Find contacts with email containing 'john@example.com'"
"Search for companies in the technology industry"
"Show me all grant applications for the ETG program"
```

### Test Google Drive

**Supported tools:**
1. `search_google_drive` - Search Drive for files
2. `read_google_drive_file` - Read file contents

**Example prompts:**
```
"Search my Google Drive for files about 'grant templates'"
"Read this document: https://docs.google.com/document/d/1gxWNvpEvpM4dNP3N60dbnPvlOS5yRQkhISYodcUb6SE/edit"
```

---

## 🔍 Troubleshooting

### HubSpot Issues

**"HubSpot access token not configured"**
- Check that `HUBSPOT_ACCESS_TOKEN` is set in Railway
- Make sure it starts with `pat-na1-`
- Verify the token hasn't expired

**"401 Unauthorized"**
- Token might be invalid or expired
- Regenerate the token in HubSpot Private Apps

**"403 Forbidden"**
- Check that your Private App has the correct scopes enabled

### Google Drive Issues

**"Google Drive credentials not configured"**
- Check that all three env vars are set in Railway:
  - `GOOGLE_DRIVE_CLIENT_ID`
  - `GOOGLE_DRIVE_CLIENT_SECRET`
  - `GOOGLE_DRIVE_REFRESH_TOKEN`

**"invalid_grant" error**
- Refresh token might be expired
- Re-run the authorization script to get a new token

**"403 Forbidden" or "File not found"**
- Make sure the file is shared with the Google account that authorized the app
- Check that the file ID is correct
- Verify the file isn't in the trash

**"Insufficient permissions"**
- Make sure you enabled both Google Drive API and Google Docs API
- Check that your OAuth consent screen has the correct scopes

---

## 🔒 Security Best Practices

1. **Never commit tokens to git**
   - Tokens are in `.env` which is in `.gitignore`
   - Only add tokens to Railway environment variables

2. **Rotate tokens periodically**
   - HubSpot: Regenerate private app token every 90 days
   - Google: Refresh tokens don't expire but can be revoked

3. **Use minimum required permissions**
   - Only enable the scopes your app needs
   - Don't grant write access if you only need read access

4. **Monitor usage**
   - Check Railway logs for unauthorized access attempts
   - Review HubSpot/Google API usage regularly

---

## 📊 Current Status

Check if integrations are working:

```bash
# View Railway logs
railway logs

# Look for these messages:
✓ HubSpot contact search: found X results
✓ Google Drive file read: filename.docx (1234 chars)
```

If you see errors about "not configured", the environment variables aren't set correctly.

---

## 🆘 Need Help?

If you run into issues:

1. Check Railway logs: `railway logs --tail`
2. Verify environment variables are set in Railway dashboard
3. Test APIs directly using curl/Postman to isolate issues
4. Make sure APIs are enabled in Google Cloud Console
5. Check HubSpot Private App is active and has correct scopes

---

## ✅ Verification Checklist

Before going live, verify:

- [ ] HubSpot token is set in Railway
- [ ] HubSpot search returns results
- [ ] Google Drive client ID is set
- [ ] Google Drive client secret is set
- [ ] Google Drive refresh token is set
- [ ] Google Drive file reads work
- [ ] No errors in Railway logs
- [ ] Agents can use tools successfully
