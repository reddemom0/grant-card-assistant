# Google Drive MCP Server Setup Guide

This guide walks through setting up the Google Drive MCP (Model Context Protocol) server for the Grant Card Assistant platform, enabling AI agents to search and read files from Google Drive.

## Overview

The Google Drive MCP server provides:
- **gdrive_search**: Full-text search across Google Drive
- **gdrive_read_file**: Read any file by ID with automatic format conversion
- **OAuth 2.0 Authentication**: Secure, read-only access
- **Automatic Format Handling**: Google Docs → Markdown, Sheets → CSV, etc.

## Architecture

```
Grant Card Assistant
├── api/agent-sdk-handler.js (Agent SDK with MCP support)
├── config/agent-sdk-config.js (MCP server configuration)
└── mcp-servers/
    └── gdrive/
        ├── dist/ (compiled TypeScript)
        ├── credentials/ (OAuth credentials - gitignored)
        │   ├── gcp-oauth.keys.json (OAuth client credentials)
        │   └── .gdrive-server-credentials.json (User tokens)
        └── index.ts (MCP server implementation)
```

## Phase 1: Google Cloud Setup (10 mins)

### Step 1: Create Google Cloud Project

1. Visit [Google Cloud Console](https://console.cloud.google.com/projectcreate)
2. Click "New Project"
3. Project name: "Grant Card Assistant MCP"
4. Click "Create"
5. Wait for creation and select the project

### Step 2: Enable Google Drive API

1. Go to [API Library](https://console.cloud.google.com/apis/library)
2. Search for "Google Drive API"
3. Click "Enable"
4. Wait for confirmation

### Step 3: Configure OAuth Consent Screen

1. Navigate to [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. Select User Type:
   - **Internal** if using Google Workspace (recommended for our team)
   - **External** for personal Google accounts
3. Click "Create"
4. Fill in required fields:
   - **App name**: "Grant Card Assistant"
   - **User support email**: chris@grantedconsulting.ca
   - **Developer contact**: chris@grantedconsulting.ca
5. Click "Save and Continue"
6. On "Scopes" page:
   - Click "Add or Remove Scopes"
   - Add: `https://www.googleapis.com/auth/drive.readonly`
   - Click "Update"
7. Click "Save and Continue"
8. Review summary → "Back to Dashboard"

### Step 4: Create OAuth Client ID

1. Go to [Credentials](https://console.cloud.google.com/apis/credentials)
2. Click "Create Credentials" → "OAuth client ID"
3. Application type: **"Desktop app"**
4. Name: "Grant Card Assistant Desktop Client"
5. Click "Create"
6. **Download JSON** (save for next phase)
7. Click "OK"

## Phase 2: Local Installation & Authentication (15 mins)

### Step 1: Install Dependencies

```bash
# Navigate to MCP server directory
cd mcp-servers/gdrive

# Install dependencies (already done if cloned)
npm install

# Build TypeScript
npm run build
```

### Step 2: Add OAuth Credentials

1. Locate the downloaded OAuth JSON file (e.g., `client_secret_*.json`)
2. Rename it to `gcp-oauth.keys.json`
3. Move to credentials directory:

```bash
mv ~/Downloads/client_secret_*.json mcp-servers/gdrive/credentials/gcp-oauth.keys.json
```

### Step 3: Run Authentication Flow

```bash
# From project root
cd mcp-servers/gdrive

# Run auth command
node dist/index.js auth
```

This will:
1. Open your browser for Google OAuth
2. Ask you to select your Google account
3. Request permission for read-only Drive access
4. Save credentials to `credentials/.gdrive-server-credentials.json`

**Expected output:**
```
🔐 Starting OAuth authentication flow...
✅ Authentication successful!
📁 Credentials saved to credentials/.gdrive-server-credentials.json
```

### Step 4: Test MCP Server Locally

Test the server works before integrating:

```bash
# Start the MCP server
node dist/index.js

# Should see:
# MCP Server running on stdio
```

In another terminal, test the tools:

```bash
# Test search (will need MCP client)
# For now, verify server starts without errors
```

## Phase 3: Agent SDK Integration (15 mins)

### Step 1: Update Agent SDK Configuration

Edit `config/agent-sdk-config.js`:

```javascript
// Add to mcpServers configuration
mcpServers: {
  'google-drive': {
    type: 'stdio',  // Local subprocess
    command: 'node',
    args: [
      path.join(process.cwd(), 'mcp-servers/gdrive/dist/index.js')
    ],
    env: {
      GOOGLE_APPLICATION_CREDENTIALS: path.join(
        process.cwd(),
        'mcp-servers/gdrive/credentials/gcp-oauth.keys.json'
      ),
      MCP_GDRIVE_CREDENTIALS: path.join(
        process.cwd(),
        'mcp-servers/gdrive/credentials/.gdrive-server-credentials.json'
      ),
    }
  }
},
```

### Step 2: Add Tools to Agents

Update tool configuration for agents that need Drive access:

```javascript
tools: {
  'grant-card-generator': [
    'Read', 'Write', 'Edit', 'Glob', 'Grep',
    'WebSearch', 'TodoWrite', 'Memory',
    'gdrive_search',      // New: Search Drive
    'gdrive_read_file'    // New: Read Drive files
  ],
  'etg-writer': [
    'Read', 'Write', 'Edit', 'Glob', 'Grep',
    'WebSearch', 'WebFetch', 'TodoWrite', 'Memory',
    'gdrive_search',
    'gdrive_read_file'
  ],
  // ... other agents
}
```

### Step 3: Update Agent Prompts

Add knowledge base instructions to agent definitions (`.claude/agents/*.md`):

```markdown
## Knowledge Base Access

You have access to the Granted Consulting knowledge base stored in Google Drive via two tools:

1. **gdrive_search**: Search for documents by keyword
   - Use when you need to find relevant grant criteria, templates, or examples
   - Example: `gdrive_search({ query: "BC Employment Training Grant eligibility" })`

2. **gdrive_read_file**: Read document contents by file ID
   - Use after finding relevant files with search
   - Automatically converts Google Docs to Markdown, Sheets to CSV
   - Example: `gdrive_read_file({ file_id: "1abc..." })`

### Workflow:
1. Search for relevant documents using keywords
2. Read the most relevant files
3. Use information to inform your responses
4. Cite sources with file names and IDs
```

## Phase 4: Testing (15 mins)

### Test 1: Search Functionality

```bash
# Start your local server
npm run dev

# Make a test request to an agent
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{
    "agentType": "grant-card-generator",
    "conversationId": "test-gdrive-123",
    "userId": "test-user",
    "message": "Search our knowledge base for BC ETG program information"
  }'
```

Expected: Agent should use `gdrive_search` to find relevant files.

### Test 2: Read File

```bash
# After getting file IDs from search, test reading
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{
    "agentType": "grant-card-generator",
    "conversationId": "test-gdrive-123",
    "userId": "test-user",
    "message": "Read the content of file ID [from search results]"
  }'
```

Expected: Agent should read file and display contents.

### Test 3: End-to-End Workflow

```bash
# Test complete workflow
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{
    "agentType": "grant-card-generator",
    "conversationId": "test-gdrive-123",
    "userId": "test-user",
    "message": "Find and summarize all information about BC Agriculture funding programs"
  }'
```

Expected: Agent should search, read relevant files, and provide summary.

## Phase 5: Railway Deployment (20 mins)

### Option A: Include MCP Server in Deployment (Recommended)

**Pros**: Simple, no external dependencies
**Cons**: Slightly larger image

1. Update `.dockerignore` (if exists) to ensure MCP server is included:
   ```
   # Don't ignore MCP server
   !mcp-servers/gdrive/dist/
   !mcp-servers/gdrive/package.json
   ```

2. Add build step to `package.json`:
   ```json
   {
     "scripts": {
       "build": "cd mcp-servers/gdrive && npm install && npm run build",
       "deploy": "npm run build && vercel --prod"
     }
   }
   ```

3. Add Railway environment variables:
   - `GOOGLE_DRIVE_OAUTH_JSON`: Content of `gcp-oauth.keys.json` (as JSON string)
   - `GOOGLE_DRIVE_CREDENTIALS_JSON`: Content of `.gdrive-server-credentials.json`

4. Update MCP config to use environment variables in production:
   ```javascript
   env: {
     GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_DRIVE_OAUTH_JSON
       ? '/tmp/gcp-oauth.keys.json'  // Write from env var
       : path.join(process.cwd(), 'mcp-servers/gdrive/credentials/gcp-oauth.keys.json'),
     MCP_GDRIVE_CREDENTIALS: process.env.GOOGLE_DRIVE_CREDENTIALS_JSON
       ? '/tmp/.gdrive-server-credentials.json'
       : path.join(process.cwd(), 'mcp-servers/gdrive/credentials/.gdrive-server-credentials.json'),
   }
   ```

5. Add startup script to write credentials:
   ```javascript
   // In api/agent-sdk-handler.js or startup file
   if (process.env.GOOGLE_DRIVE_OAUTH_JSON) {
     fs.writeFileSync('/tmp/gcp-oauth.keys.json', process.env.GOOGLE_DRIVE_OAUTH_JSON);
   }
   if (process.env.GOOGLE_DRIVE_CREDENTIALS_JSON) {
     fs.writeFileSync('/tmp/.gdrive-server-credentials.json', process.env.GOOGLE_DRIVE_CREDENTIALS_JSON);
   }
   ```

### Option B: External MCP Server (Advanced)

Host MCP server separately and use SSE transport:

```javascript
mcpServers: {
  'google-drive': {
    type: 'sse',
    url: process.env.GOOGLE_DRIVE_MCP_URL,
    headers: {
      'Authorization': `Bearer ${process.env.GOOGLE_DRIVE_MCP_TOKEN}`
    }
  }
}
```

## Folder Structure & Knowledge Base

### Current Google Drive Structure

```
Granted Consulting Knowledge Base
├── Grant Programs/
│   ├── BC/
│   │   ├── ETG Program Guide.gdoc
│   │   ├── BCAFE Guidelines.gdoc
│   │   └── CanExport SME.gdoc
│   ├── Federal/
│   └── Alberta/
├── Templates/
│   ├── Business Case Template.gdoc
│   ├── Claims Template.gsheet
│   └── Budget Template.gsheet
└── Examples/
    ├── Successful Applications/
    └── Common Errors/
```

### Configure Folder in Agent SDK

Point agents to specific folders:

```javascript
// In agent prompt or configuration
const KNOWLEDGE_BASE_FOLDERS = {
  'etg-writer': '1abc...', // ETG-specific folder ID
  'bcafe-writer': '1def...',
  'grant-card-generator': '1xyz...' // Main knowledge base
};
```

## Security Considerations

### Credentials Protection

1. ✅ **Never commit credentials**: `.gitignore` includes `credentials/`
2. ✅ **Read-only access**: OAuth scope is `drive.readonly`
3. ✅ **Environment variables**: Production uses Railway secrets
4. ✅ **Scoped access**: Can restrict to specific folders via Drive permissions

### Best Practices

1. **Rotate tokens periodically**: Re-run auth flow every 90 days
2. **Monitor access logs**: Check Google Cloud Console for API usage
3. **Limit permissions**: Use internal OAuth consent for team-only access
4. **Audit regularly**: Review which agents have Drive access

## Troubleshooting

### Error: "Authentication failed"

**Solution**: Re-run authentication flow
```bash
cd mcp-servers/gdrive
node dist/index.js auth
```

### Error: "Invalid credentials"

**Check**:
1. Credentials files exist in `credentials/` directory
2. Files are valid JSON
3. OAuth client ID is for "Desktop app" type

### Error: "MCP server not found"

**Check**:
1. MCP server is built: `ls mcp-servers/gdrive/dist/`
2. Path in config is correct (use `path.join`)
3. Node.js can execute: `node mcp-servers/gdrive/dist/index.js --help`

### Error: "Permission denied" on Drive files

**Solution**:
1. Ensure your Google account has access to knowledge base folder
2. Check OAuth scope includes `drive.readonly`
3. Re-authenticate if needed

### MCP Server Hangs

**Solution**:
1. Check server logs for errors
2. Verify credentials are not expired
3. Test with simple search query
4. Restart server process

## Monitoring & Metrics

### Track MCP Usage

Monitor tool usage in console logs:
```bash
🔧 Using tool: gdrive_search
📁 Found 5 files matching "ETG eligibility"
🔧 Using tool: gdrive_read_file
📄 Read 2.3KB from "ETG Program Guide.gdoc"
```

### Performance Metrics

- **Search latency**: ~500-1000ms
- **Read latency**: ~200-500ms (depends on file size)
- **Cache**: Agent SDK caches tool results within conversation

### Cost Analysis

Google Drive API quotas:
- **Queries per day**: 20,000 (free tier)
- **Queries per user per 100s**: 1,000
- **Read operations**: Unlimited (free)

Expected usage:
- ~10 searches per agent conversation
- ~5 file reads per conversation
- Well within free tier limits

## Next Steps

After successful setup:

1. ✅ Test with all agent types
2. ✅ Document knowledge base structure for team
3. ✅ Create user guide for adding documents
4. ✅ Set up monitoring and alerts
5. ✅ Deploy to Railway production

## Resources

- [Google Drive MCP Server GitHub](https://github.com/felores/gdrive-mcp-server)
- [Google Drive API Docs](https://developers.google.com/drive/api/v3/reference)
- [MCP Protocol Spec](https://modelcontextprotocol.io)
- [Agent SDK Documentation](https://github.com/anthropics/anthropic-agent-sdk)

## Support

For issues or questions:
- Check troubleshooting section above
- Review GitHub issues: https://github.com/felores/gdrive-mcp-server/issues
- Contact: chris@grantedconsulting.ca
