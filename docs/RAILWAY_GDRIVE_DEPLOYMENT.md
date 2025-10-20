# Railway Deployment Guide - Google Drive MCP

## Environment Variables to Add

### Step 1: Go to Railway Dashboard

1. Open: https://railway.app/dashboard
2. Select your project: "grant-card-assistant"
3. Go to "Variables" tab

### Step 2: Add Google Drive OAuth Credentials

**Variable Name**: `GOOGLE_DRIVE_OAUTH_JSON`

**Value**: Copy the ENTIRE contents of `mcp-servers/gdrive/credentials/gcp-oauth.keys.json` as a single-line JSON string.

```
{"installed":{"client_id":"YOUR_CLIENT_ID.apps.googleusercontent.com","project_id":"your-project-id","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_secret":"YOUR_CLIENT_SECRET","redirect_uris":["http://localhost"]}}
```

### Step 3: Add Google Drive User Credentials

**Variable Name**: `GOOGLE_DRIVE_CREDENTIALS_JSON`

**Value**: Copy the ENTIRE contents of `mcp-servers/gdrive/credentials/.gdrive-server-credentials.json` as a single-line JSON string.

```
{"access_token":"YOUR_ACCESS_TOKEN","refresh_token":"YOUR_REFRESH_TOKEN","scope":"https://www.googleapis.com/auth/drive.readonly","token_type":"Bearer","expiry_date":1234567890}
```

### Step 4: Save Variables

Click "Add Variable" or "Save" for each one.

### Step 5: Redeploy

Railway will automatically redeploy with the new environment variables.

## How It Works in Production

When Railway starts the server (`server.js`):

1. **Automatic Initialization**: `initializeGoogleDriveCredentials()` is called on startup
2. **Environment Detection**: Checks if running in production (Railway sets `NODE_ENV` or `RAILWAY_ENVIRONMENT`)
3. **Credential Setup**: Writes credentials from environment variables to `/tmp/` directory
4. **MCP Configuration**: Updates Agent SDK config with `/tmp/` credential paths
5. **MCP Server Start**: Agent SDK spawns MCP server subprocess with correct paths

All of this happens automatically - just add the environment variables and Railway will handle the rest!

## Verification

After deployment, test with:

```bash
curl -X POST https://grant-card-assistant-production.up.railway.app/api/agent \
  -H "Content-Type: application/json" \
  -d '{
    "agentType": "grant-card-generator",
    "conversationId": "test-gdrive-production",
    "userId": "test-user",
    "message": "Search our Google Drive for grant eligibility documents"
  }'
```

Expected: Agent should use `gdrive_search` and find documents from your Drive.

## Troubleshooting

### MCP Server Not Starting

Check Railway logs for:
- "MCP server starting..."
- "Credentials written to /tmp/"
- "Google Drive MCP ready"

### Credentials Not Found

Verify environment variables are set:
- `GOOGLE_DRIVE_OAUTH_JSON`
- `GOOGLE_DRIVE_CREDENTIALS_JSON`

Both should be valid JSON (test with: `echo $GOOGLE_DRIVE_OAUTH_JSON | jq .`)

### Permission Errors

- OAuth credentials must be for "Desktop app" type
- Scope must include `drive.readonly`
- User must have access to knowledge base folder

## Security Notes

- ✅ Credentials stored as Railway environment variables (encrypted)
- ✅ Written to `/tmp/` only (ephemeral, cleared on restart)
- ✅ Not accessible via API or logs
- ✅ Read-only Drive access only

## Credential Rotation

To rotate credentials (recommended every 90 days):

1. Re-run authentication locally: `cd mcp-servers/gdrive && node dist/index.js auth`
2. Update Railway environment variable: `GOOGLE_DRIVE_CREDENTIALS_JSON`
3. Redeploy

OAuth client credentials (`GOOGLE_DRIVE_OAUTH_JSON`) rarely need rotation.
