# Google Drive MCP Server - Quick Start

##  Initial Setup (Do Once)

### 1. Install & Build
```bash
cd mcp-servers/gdrive
npm install    # Installing now...
npm run build  # After install completes
```

### 2. Add OAuth Credentials
```bash
# Move your downloaded OAuth JSON from Google Cloud Console
mv ~/Downloads/client_secret_*.json credentials/gcp-oauth.keys.json
```

### 3. Authenticate
```bash
# Run OAuth flow (opens browser)
node dist/index.js auth

# Expected output:
# 🔐 Starting OAuth authentication flow...
# ✅ Authentication successful!
# 📁 Credentials saved
```

## Testing MCP Server

### Start Server (Test Mode)
```bash
node dist/index.js
# Should see: MCP Server running on stdio
# Press Ctrl+C to stop
```

### Check Credentials
```bash
ls -la credentials/
# Should see:
# gcp-oauth.keys.json (OAuth client)
# .gdrive-server-credentials.json (access tokens)
```

## Integration with Agent SDK

Already configured in:
- `config/agent-sdk-config.js` (MCP server config)
- `api/agent-sdk-handler.js` (passes config to SDK)

## Common Commands

```bash
# Re-authenticate (if tokens expire)
node dist/index.js auth

# Rebuild after code changes
npm run build

# Check if server starts without errors
node dist/index.js --help
```

## Folder Structure

```
mcp-servers/gdrive/
├── index.ts              # MCP server implementation
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
├── dist/                 # Compiled JS (after build)
│   └── index.js
├── credentials/          # OAuth files (gitignored)
│   ├── gcp-oauth.keys.json
│   └── .gdrive-server-credentials.json
└── node_modules/         # Dependencies (89 packages)
```

## What You'll Need

1. ✅ Google Cloud Project (created by you)
2. ✅ OAuth 2.0 Desktop App credentials (from Google Cloud)
3. ✅ Google Drive API enabled (in Google Cloud Console)
4. ✅ Knowledge base folder ID (your Google Drive folder)

## Next Steps After Setup

1. Test MCP server locally
2. Configure Agent SDK to use MCP server
3. Add `gdrive_search` and `gdrive_read_file` to agent tools
4. Deploy to Railway with encrypted credentials

## Help & Documentation

- Full Setup Guide: `docs/MCP_GOOGLE_DRIVE_SETUP.md`
- Credentials Help: `mcp-servers/gdrive/credentials/README.md`
- Original MCP Docs: `mcp-servers/gdrive/README.md`

## Troubleshooting

**npm install fails**
```bash
# Clear and reinstall
rm -rf node_modules package-lock.json
npm install
```

**Build fails**
```bash
# Check TypeScript version
npx tsc --version
# Should be ~5.6.2
```

**Auth fails**
```bash
# Verify credentials file exists and is valid JSON
cat credentials/gcp-oauth.keys.json | jq .
```

## Status

- ✅ Repository cloned
- ⏳ Dependencies installing (89 packages)
- ⏳ Waiting for your OAuth credentials
- ⏳ Authentication flow (after credentials)
- ⏳ Agent SDK integration
