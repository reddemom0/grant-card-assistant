# Web Fetch Tool Implementation

**Date**: October 15, 2025  
**Status**: ✅ Complete - Grant Cards agent now supports URL fetching

---

## What Was Implemented

Added Anthropic's native `web_fetch` tool to all agents, enabling automatic URL content fetching from any URLs detected in user messages.

### Key Changes

1. **Web Fetch Tool Definition** (api/server.js:3849-3859)
   - Added `WEB_FETCH_TOOL` configuration
   - Created `getWebFetchTool()` function

2. **Beta Headers Updated** (api/server.js:3943, 4123)
   - Added `web-fetch-2025-09-10` to beta headers in both streaming and non-streaming APIs

3. **Tools Arrays Updated**
   - Non-streaming API (line 3950): `tools: [WEB_SEARCH_TOOL, WEB_FETCH_TOOL]`
   - Streaming API (line 4132): `tools: [webSearchTool, webFetchTool]`

4. **Logging Enhanced**
   - Added web_fetch detection in response analysis (lines 3990-3996, 4002-4003)
   - Updated streaming tool logging to differentiate web_search vs web_fetch (lines 4259-4270)

5. **Tool Result Handling**
   - Added `web_fetch_tool_result` block handling in streaming (lines 4290-4301)

6. **Legacy Code Marked**
   - Updated `fetchURLContent()` comment to indicate it's legacy ETG-only code (line 3725-3727)

---

## How It Works

### Grant Cards Agent (New Behavior)

1. **User provides URL**: `"Analyze this grant: https://example.com/grant-details"`
2. **Frontend detects URL**: Sends message with URL text
3. **Backend receives message**: Passes to Claude API with web_fetch tool enabled
4. **Claude detects URL**: Automatically uses web_fetch tool
5. **Web fetch executes**: Anthropic's server fetches real URL content
6. **Claude analyzes**: Uses fetched content to generate grant card

**No manual URL handling needed!** Claude automatically detects and fetches URLs when appropriate.

### ETG Agent (Existing Behavior - Unchanged)

- Still uses manual `fetchURLContent()` with mock data (line 4496-4500)
- Frontend passes URL as separate `courseUrl` parameter
- Can be migrated to web_fetch in future

---

## User Experience

**Before:**
- Grant cards agent ignored URLs in messages
- Users had to paste content manually

**After:**
- Users can paste URLs directly: `"Create a grant card for https://grants.gov/example"`
- Claude automatically fetches and analyzes the URL
- Real content (not mock data) is used for analysis

---

## Frontend Support

The grant-cards.html frontend already supports URL detection:

- **Line 1417**: `checkForURLs()` detects URLs in input
- **Lines 1584-1591**: `handleURLMessage()` processes URL messages
- **Lines 1684-1686**: URL detection with visual feedback

When user types a URL:
1. Input border turns blue (visual indicator)
2. Message includes URL text: `"🔗 Analyze grant URL: ..."`
3. Backend receives full message with URL

---

## Documentation Key Points

From Anthropic's web_fetch documentation:

1. **URL Validation**: Web fetch can only fetch URLs that appear in conversation context (security feature)
2. **Tool Type**: `web_fetch_20250910`
3. **Beta Header**: `web-fetch-2025-09-10`
4. **Server-Side**: Anthropic handles all fetching - no client implementation needed
5. **Automatic Detection**: Claude uses web_fetch when it detects URLs in conversation

---

## Testing

To test web_fetch with grant-cards agent:

1. Navigate to `/grant-cards/new`
2. Type message with URL: `"Create a grant card for https://www.canada.ca/en/employment-social-development/services/funding/canada-job-grant.html"`
3. Observe:
   - Backend logs show: `🔗 STREAMING TOOL USED: web_fetch`
   - Backend logs show: `URL: "https://..."` 
   - Claude fetches real content from URL
   - Response includes analysis of actual grant page

---

## Comparison with ETG Agent

| Feature | ETG Agent (courseUrl) | Grant Cards (web_fetch) |
|---------|----------------------|------------------------|
| **Data Source** | Mock data | Real URL content |
| **Detection** | Manual parameter | Automatic in message |
| **Implementation** | Client-side (our code) | Server-side (Anthropic) |
| **URL Format** | Separate form field | Natural language |
| **Multiple URLs** | One per request | Multiple in conversation |

---

## Future Enhancements

1. **Migrate ETG to web_fetch**: Replace mock `fetchURLContent()` with native tool
2. **URL Validation**: Add frontend validation for grant-specific domains
3. **Rate Limiting**: Monitor web_fetch usage for rate limit considerations
4. **Caching**: Consider caching fetched URL content in Redis

---

## Files Modified

- `api/server.js` - Added web_fetch tool configuration and handling
- `api/memory-tool-handler.js` - (No changes - legacy code marked)
- `grant-cards.html` - (No changes - already had URL detection)

**Total Changes**: ~60 lines across tool definitions, beta headers, logging, and result handling

---

## Deployment

Changes deployed to development branch. Ready for production deployment:

```bash
git add api/server.js WEB-FETCH-IMPLEMENTATION.md
git commit -m "Add web_fetch tool for grant-cards URL analysis"
git push origin development
```

---

**Implementation Complete**: Grant cards agent now automatically fetches and analyzes URLs provided by users!
