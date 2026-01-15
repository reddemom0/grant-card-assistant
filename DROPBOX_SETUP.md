# Dropbox Integration for Oracle Knowledge Base

This document explains how to set up and use the Dropbox integration for the Internal Oracle knowledge base.

## Overview

The Oracle can now read documents from both **Google Drive** and **Dropbox**. This allows you to store knowledge base documents in your team Dropbox and have them searchable through the same Oracle interface.

## Features

- ✅ List files in Dropbox folders (recursive)
- ✅ Search Dropbox for files
- ✅ Download and extract text from files (PDF, DOCX, TXT, MD, CSV)
- ✅ OAuth 2.0 authentication with refresh token support
- ✅ Team folder support with namespace configuration
- ✅ Automatic token refresh
- ✅ Same Redis indexing as Google Drive for unified search

## Setup Instructions

### 1. Create a Dropbox App

1. Go to [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Click "Create App"
3. Choose settings:
   - **API**: Scoped access
   - **Access Type**: Full Dropbox or App folder (choose based on your needs)
   - **App Name**: e.g., "Granted Oracle KB"
4. Click "Create App"

### 2. Configure App Permissions

In the app settings, go to the **Permissions** tab and enable:

- `files.metadata.read` - Read file and folder metadata
- `files.content.read` - Read file contents
- `sharing.read` - Access shared folders (if using team folders)

Click "Submit" to save permissions.

### 3. Generate OAuth Tokens

#### Option A: Using the OAuth Flow (Recommended for Team Accounts)

1. In your app settings, note the **App key** and **App secret**
2. Add a redirect URI in settings: `http://localhost:3000/oauth/callback` (for local testing)
3. Use this authorization URL (replace APP_KEY with your actual app key):
   ```
   https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&token_access_type=offline
   ```
4. Visit the URL, authorize the app
5. You'll be redirected with a `code` parameter
6. Exchange the code for tokens using curl:
   ```bash
   curl -X POST https://api.dropbox.com/oauth2/token \
     -d grant_type=authorization_code \
     -d code=YOUR_AUTH_CODE \
     -d client_id=YOUR_APP_KEY \
     -d client_secret=YOUR_APP_SECRET
   ```
7. Save the `access_token` and `refresh_token` from the response

#### Option B: Generate Access Token (Quick Testing)

1. In your app settings, scroll to **OAuth 2** section
2. Click "Generate" under **Generated access token**
3. Copy the token (note: this token expires in 4 hours and cannot be refreshed)

### 4. Get Team/Namespace Information (For Team Accounts)

If using Dropbox Business/Team:

```bash
# Get account info including namespace IDs
curl -X POST https://api.dropboxapi.com/2/users/get_current_account \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "null"
```

Note the `root_namespace_id` and `home_namespace_id` from the response.

### 5. Configure Environment Variables

Add these variables to your `.env` file:

```bash
# Dropbox OAuth Credentials
DROPBOX_APP_KEY=your_app_key_here
DROPBOX_APP_SECRET=your_app_secret_here
DROPBOX_ACCESS_TOKEN=your_initial_access_token
DROPBOX_REFRESH_TOKEN=your_refresh_token_here

# Team Configuration (Optional - for Dropbox Business)
DROPBOX_TEAM_MEMBER_ID=dbmid:xxxxx  # Optional: Specific team member to impersonate
DROPBOX_NAMESPACE_ID=1234567890     # Optional: Root namespace for team space

# Oracle KB Folder Path
DROPBOX_ORACLE_KB_PATH=/Oracle KB   # Path to your knowledge base folder in Dropbox
```

### 6. Set Up Folder Structure

Create a folder structure in Dropbox similar to your Google Drive Oracle KB:

```
/Oracle KB/
  ├── Writers/
  │   ├── templates/
  │   └── guides/
  ├── Strategy/
  │   ├── pricing/
  │   └── discovery/
  ├── Research/
  ├── Marketing/
  └── GCs/
```

The indexer will automatically detect departments based on the first-level folder names under `/Oracle KB/`.

### 7. Index Dropbox Files

Run the indexer to scan and index your Dropbox files:

```bash
# Index new/changed files only
node scripts/index-dropbox-kb.js

# Full re-index (all files)
node scripts/index-dropbox-kb.js --full
```

The indexer will:
- Scan all files in the specified Dropbox path
- Extract text content from supported formats (PDF, DOCX, TXT, MD, CSV)
- Use Claude to generate metadata (summary, keywords, document type)
- Store metadata in Redis with the same schema as Google Drive files
- Mark files with `source: dropbox` to distinguish from Google Drive

### 8. Test the Integration

1. Start your server: `npm run dev`
2. Go to the Oracle page: `http://localhost:3000/oracle`
3. Try searching for a document you know is in Dropbox
4. Oracle will return results from both Google Drive and Dropbox
5. Click on a Dropbox file to read its contents

## How It Works

### Unified Search

The Oracle search uses Redis to index metadata from both sources:

- **Google Drive files**: `source: google-drive`, have `webViewLink` and `fileId`
- **Dropbox files**: `source: dropbox`, have `dropboxPath` and `filePath`

When you search, Oracle:
1. Uses `search_oracle_kb` tool to find matching documents (from both sources)
2. Returns metadata including the source type
3. Uses `read_google_drive_file` for Google Drive documents
4. Uses `read_dropbox_file` for Dropbox documents

### Token Management

The Dropbox module automatically:
- Refreshes access tokens when they expire (every ~4 hours)
- Uses refresh tokens for long-term access without manual re-authentication
- Caches tokens in memory for the session

### Supported File Types

| Format | Extension | Support |
|--------|-----------|---------|
| PDF | `.pdf` | ✅ Text extraction via pdf-parse |
| Word (Modern) | `.docx` | ✅ Text extraction via mammoth |
| Word (Legacy) | `.doc` | ❌ Not supported (convert to .docx) |
| Text | `.txt`, `.md`, `.csv` | ✅ Direct read |

## Maintenance

### Updating the Index

Run the indexer periodically to catch new/updated files:

```bash
# Incremental update (only new/changed files)
node scripts/index-dropbox-kb.js

# This is fast and can be run frequently
```

### Monitoring

The indexer provides detailed logs:
- ✅ Successfully indexed files
- ⏭️ Skipped (unchanged) files
- ⚠️ Files with warnings (unsupported types, empty content)
- ❌ Files with errors

### Redis Keys

Dropbox files are stored in Redis with these keys:

- `oracle:doc:{fileId}` - Document metadata hash
- `oracle:dept:{department}` - Set of file IDs by department
- `oracle:type:{fileType}` - Set of file IDs by type (template, example, process, reference, data)
- `oracle:keyword:{keyword}` - Set of file IDs by keyword
- `oracle:source:dropbox` - Set of all Dropbox file IDs
- `oracle:stats` - Global statistics including `dropboxDocuments` count

## Troubleshooting

### "Failed to refresh Dropbox token"

- Ensure `DROPBOX_REFRESH_TOKEN` is set correctly
- Check that `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET` are correct
- Verify the refresh token hasn't been revoked in your Dropbox app settings

### "Dropbox API error: path/not_found"

- Check that `DROPBOX_ORACLE_KB_PATH` matches your actual folder path
- Verify the folder exists and the authenticated user has access
- For team folders, ensure `DROPBOX_NAMESPACE_ID` is set correctly

### "Unsupported file type"

- Check that the file is one of the supported formats (PDF, DOCX, TXT, MD, CSV)
- Legacy .doc files are not supported - convert to .docx
- Images are not supported for text extraction

### Files not appearing in search

- Run the indexer: `node scripts/index-dropbox-kb.js`
- Check Redis to verify the file was indexed: `redis-cli HGETALL oracle:doc:dropbox_xxxxx`
- Verify the file has extractable content (not just images)

## Migration Strategy

If moving from Google Drive to Dropbox:

1. **Phase 1**: Index Dropbox while keeping Google Drive active (current state)
2. **Phase 2**: Users will see results from both sources
3. **Phase 3**: Gradually move files from Drive to Dropbox
4. **Phase 4**: Eventually deprecate Google Drive if desired

Both systems can coexist indefinitely. The Oracle automatically handles both sources transparently.

## API Rate Limits

Dropbox API limits:
- **Standard apps**: 12,000 requests/day
- **Production apps**: Higher limits available

The indexer:
- Processes files in batches of 5
- Pauses 2 seconds between batches
- Uses incremental updates to minimize API calls

## Security Notes

- Store credentials in `.env` file (never commit to git)
- Use refresh tokens instead of long-lived access tokens
- For production, consider using Dropbox's short-lived tokens with refresh
- Team admins should review app permissions regularly
