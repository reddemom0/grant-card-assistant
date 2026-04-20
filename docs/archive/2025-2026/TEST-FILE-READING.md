# File Reading Test Suite

## Purpose

This test suite validates the critical paths that enable HubSpot file reading and conversation continuity. It ensures that the agent can:

1. **Find files automatically** by checking email HTML bodies
2. **Read PDF files** without crashing (pdf-parse library)
3. **Maintain context** across follow-up messages
4. **Handle server-side tools** (web_search, web_fetch)

## When to Run

Run this test suite:

- ✅ After any changes to agent prompts (`.claude/agents/*.md`)
- ✅ After any changes to HubSpot tools (`src/tools/hubspot.js`)
- ✅ After any changes to streaming logic (`src/claude/streaming.js`)
- ✅ After any changes to message handling (`src/database/messages.js`)
- ✅ Before deploying to production
- ✅ When debugging file reading issues

## Usage

```bash
# Run against production
node test-file-reading.js

# Run against local development
API_URL=http://localhost:3000 node test-file-reading.js

# Run against staging
API_URL=https://your-staging-url.railway.app node test-file-reading.js
```

## What It Tests

### Test 1: `get_email_details` is Called ⚠️ CRITICAL

**What**: Verifies the agent calls `get_email_details` when searching for files

**Why**: The file ID (195210192980) is embedded in the email HTML body, not in attachments. Without calling `get_email_details`, the agent cannot find the file.

**Pass Criteria**:
- Agent must call `get_email_details` after `search_project_emails`
- Tools used should include: `search_project_emails` → `get_email_details` → `read_hubspot_file`

**Failure Indicates**:
- Agent prompt instructions were changed/removed (check `.claude/agents/canexport-claims.md` lines 150-233)
- Tool definition missing or incorrect (`src/tools/definitions.js`)

### Test 2: PDF Reading Succeeds ⚠️ CRITICAL

**What**: Verifies PDF files can be read without crashing

**Why**: The pdf-parse library has a bug where it tries to load test files at module initialization if not imported correctly.

**Pass Criteria**:
- No crash errors in response
- Conversation ID is returned (indicates request completed)

**Failure Indicates**:
- pdf-parse import reverted to `import('pdf-parse')` instead of `import('pdf-parse/lib/pdf-parse.js')`
- Check `src/tools/hubspot.js` around line 1660

### Test 3: Conversation Continuity ⚠️ CRITICAL

**What**: Verifies follow-up questions use existing context instead of re-searching

**Why**: Re-searching wastes tokens and time. Agent should use memory and conversation history.

**Pass Criteria**:
- Follow-up message does NOT call `search_project_emails` or `get_email_details` again
- Agent uses `memory_recall` or existing context
- Response addresses the follow-up question correctly

**Failure Indicates**:
- Conversation continuity instructions removed from agent prompt
- Memory tools not working
- Check `.claude/agents/canexport-claims.md` lines 37-70

### Test 4: Server Tool Use Handling (Implicit)

**What**: Verifies `server_tool_use` blocks are handled correctly

**Why**: Without proper handling, follow-up messages fail with validation errors like:
```
messages.X.content.Y.server_tool_use.id: Field required
```

**Pass Criteria**:
- Covered by Test 3 - if follow-up works, server tool handling works

**Failure Indicates**:
- `server_tool_use` handling removed from streaming (`src/claude/streaming.js` lines 47-54, 118-127)
- `server_tool_use` input parsing removed from messages loader (`src/database/messages.js` lines 73-81)

## Expected Output

### Success ✅

```
================================================================================
🧪 Starting Critical Path Tests for File Reading
📍 Testing against: https://grant-card-assistant-production.up.railway.app

================================================================================
TEST 1: Verify get_email_details is called when looking for files
================================================================================
Sending request: "Can you access the Spring Activator funding agreement?"
.............................
📊 Tools used: search_project_emails, get_email_details, read_hubspot_file
✅ PASS: get_email_details was called

================================================================================
TEST 2: Verify PDF is read successfully (no pdf-parse crash)
================================================================================
Checking if PDF was read in previous request...
✅ PASS: Conversation continued (no crash)

================================================================================
TEST 3: Verify conversation continuity for follow-up questions
================================================================================
Sending follow-up: "What about the Valencia speaking fee?"
.............................
📊 Tools used: memory_recall
✅ PASS: Agent used existing context (did not re-search)

================================================================================
TEST 4: Verify server_tool_use blocks are handled (if web tools used)
================================================================================
This test is implicitly covered by Test 3
If Test 3 passed, server_tool_use handling is working

================================================================================
TEST SUMMARY
================================================================================
Total Tests: 4
Passed: 3
Failed: 0
Skipped: 1

✅ ALL CRITICAL PATHS WORKING!
File reading and conversation continuity are functioning correctly.
```

### Failure ❌

```
================================================================================
TEST 1: Verify get_email_details is called when looking for files
================================================================================
Sending request: "Can you access the Spring Activator funding agreement?"
.............................
📊 Tools used: search_project_emails, get_email_attachments, get_deal_files
❌ FAIL: get_email_details was NOT called
   Tools called: search_project_emails, get_email_attachments, get_deal_files

================================================================================
TEST SUMMARY
================================================================================
Total Tests: 4
Passed: 0
Failed: 1
Skipped: 3

❌ CRITICAL PATHS BROKEN!
File reading is not working correctly. Check the failures above.
```

## Critical Files

If tests fail, check these files for changes:

### 1. Agent Prompt (`/.claude/agents/canexport-claims.md`)
```yaml
Lines 150-233: <file_discovery_workflow> section
- MUST include: "ALWAYS call get_email_details first"
- MUST include: Step 2 about checking htmlBody for file IDs
- Tool frontmatter MUST include: getEmailDetails, readHubSpotFile
```

### 2. PDF Reading (`/src/tools/hubspot.js`)
```javascript
Line ~1660: readHubSpotFile function
- MUST use: await import('pdf-parse/lib/pdf-parse.js')
- DON'T use: await import('pdf-parse')
```

### 3. Streaming Handler (`/src/claude/streaming.js`)
```javascript
Lines 47-54: Handle server_tool_use in content_block_start
Lines 118-127: Handle server_tool_use in content_block_stop
```

### 4. Message Loader (`/src/database/messages.js`)
```javascript
Lines 73-81: Parse server_tool_use input as object
```

## Commits That Must Never Be Reverted

- `e52c310` - Makes get_email_details mandatory (2025-10-29)
- `a52cee3` - pdf-parse lib import fix (2025-10-29)
- `8e6fb62` - server_tool_use input validation (2025-10-29)
- `5f998a4` - server_tool_use block handling (2025-10-29)

## Troubleshooting

### Test hangs/times out

- Check if API is responding: `curl https://your-url/health`
- Check Railway logs for errors
- Increase timeout: Edit `TEST_TIMEOUT` in `test-file-reading.js`

### Test fails but manual testing works

- Check if test is using correct conversation ID
- Check if HubSpot API has rate limits
- Try running test again after 1 minute

### False positives

- Test 3 may show "WARNING" if agent uses memory_recall + re-searches
- This is acceptable as long as memory_recall was used

## Integration with CI/CD

To run in CI/CD pipeline:

```bash
# GitHub Actions
- name: Test File Reading
  run: |
    npm install
    node test-file-reading.js
  env:
    API_URL: ${{ secrets.PRODUCTION_URL }}

# Or use Railway CLI
- name: Test File Reading
  run: |
    npm install
    railway run node test-file-reading.js
```

## Future Improvements

- [ ] Add test for get_contact_files fallback path
- [ ] Add test for portal-wide file search
- [ ] Add test for multiple file types (DOCX, TXT)
- [ ] Add performance benchmarks
- [ ] Add visual diff of agent responses
