# Markdown Formatting Fix - Complete Implementation

## Problem
The lead-gen agent was outputting markdown syntax that didn't render in the chat widget. Example:
```
**Right now:** you're looking at $15-20K...
[Learn more](https://getgranted.ca/waitlist/)
```

Shows as raw text with asterisks and brackets instead of bold text and clickable links.

## Root Cause
- Agent outputs markdown despite HTML instructions in system prompt
- Chat widget requires pure HTML for formatting to render correctly
- Inconsistent behavior - sometimes markdown would render, sometimes it wouldn't

## Solution - Two Layers

### Layer 1: Strengthen System Prompt
**File:** `.claude/agents/lead-gen-variant-b.md`

Replaced vague instruction with explicit HTML formatting rules in `<absolute_output_rule>` block:
```
You are embedded in a narrow chat widget. Use ONLY plain HTML for formatting:
- Bold: <strong>text</strong> — NEVER use **text** or __text__
- Links: <a href="url">text</a> — NEVER use [text](url)
- Line breaks: <br> — NEVER rely on blank lines
- Lists: <ul><li>item</li></ul> — NEVER use - or * for bullets

Markdown syntax will display as raw text and look broken. Always use HTML tags.
```

### Layer 2: Backend Conversion (Safety Net)
**File:** `src/claude/streaming.js`, `src/claude/client.js`, `src/api/lead-gen-finalization.js`

Added `convertMarkdownToHtml()` function that converts common markdown patterns:
```javascript
function convertMarkdownToHtml(text) {
  if (!text) return text;

  return text
    // Bold: **text** → <strong>text</strong>
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Links: [text](url) → <a href="url">text</a>
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}
```

Applied in THREE places:

1. **Streaming Pipeline** (`src/claude/streaming.js` lines 231-232)
   - Converts markdown to HTML before streaming to client
   - Ensures real-time chat displays proper HTML

2. **Conversation History** (`src/claude/client.js` lines 546-551)
   - Converts markdown before saving to conversation state
   - Applied after `stripToolNarration()` safety net

3. **Email Summaries** (`src/api/lead-gen-finalization.js` lines 695-700)
   - Converts markdown in email_summary_body before sending
   - Ensures emails have proper HTML formatting

## How It Works

### For Chat Responses:
1. Agent outputs text (may contain markdown despite prompt)
2. **Streaming layer** converts markdown to HTML before sending to client
3. **Client-side** receives properly formatted HTML
4. **Safety net** converts markdown before saving to conversation history

### For Email Summaries:
1. Agent generates email_summary_body (may contain markdown)
2. **Email finalization** converts markdown to HTML
3. Email sent with proper HTML formatting

## Testing

After deployment, test with this conversation flow:
1. Start discovery and reach estimate delivery
2. **Verify chat:** Bold text appears as `<strong>` not `**`, links are clickable
3. Accept email summary
4. **Verify email:** Bold text and links render correctly in email

## Files Modified
1. `.claude/agents/lead-gen-variant-b.md` - Explicit HTML formatting rules
2. `src/claude/streaming.js` - Conversion in streaming pipeline
3. `src/claude/client.js` - Conversion before saving to history
4. `src/api/lead-gen-finalization.js` - Conversion for email summaries

## Result
Markdown syntax is now automatically converted to HTML through two layers of defense:
1. Prompt tells agent to use HTML (prevention)
2. Backend conversion catches any markdown that slips through (safety net)

All user-facing text now displays with proper formatting in both chat and email.
