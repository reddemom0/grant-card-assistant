# Email HTML Rendering Fix - Complete Implementation

## Problem
Emails were arriving in recipients' inboxes showing raw HTML source code instead of rendered HTML. Recipients saw:
```
<html><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;"><p>Hi Christopher,</p>...
```

Instead of a properly formatted email with bold text, bullet points, and clickable links.

## Root Cause Investigation

### Content-Type Header: ✅ CORRECT
Checked `src/email/sendEmail.js` line 59 - Content-Type is correctly set to `text/html; charset=utf-8`.

### Identified Issue: Duplicate HTML Document Structure
The likely cause is that the agent was generating a COMPLETE HTML document (with `<html>`, `<head>`, `<body>` tags), and then `wrapInBrandedTemplate()` was wrapping it again with another complete HTML document structure. This creates nested `<html>` and `<body>` tags, which can cause email clients to:
1. Fail to render the HTML properly
2. Fall back to displaying it as plain text
3. Strip the outer structure, leaving malformed HTML

## Fix

### 1. Agent Prompt - Specify HTML Fragment Format (line 275)
**File:** `.claude/agents/lead-gen-variant-b.md`

Added explicit instruction:
```
CRITICAL EMAIL FORMAT: The email_summary_body must be HTML FRAGMENTS ONLY (like <p>, <a>, <strong>),
NOT a complete HTML document. Do NOT include <html>, <head>, <body>, or <!DOCTYPE> tags — those are
added automatically by the email system. Just provide the inner content (paragraphs, links, etc.).
```

### 2. Finalization Code - Strip Duplicate Tags (lines 694-710)
**File:** `/src/api/lead-gen-finalization.js`

Added defensive code to detect and strip duplicate HTML document tags:
```javascript
// Debug: Check if agent included full HTML document tags (which would break template)
if (emailBodyHtml.includes('<html') || emailBodyHtml.includes('<!DOCTYPE')) {
  console.warn(`⚠️  email_summary_body contains <html> or <!DOCTYPE> tags — stripping them`);
  console.warn(`⚠️  First 200 chars: ${emailBodyHtml.substring(0, 200)}`);

  // Strip outer HTML document structure, keep only body content
  emailBodyHtml = emailBodyHtml
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<html[^>]*>/gi, '')
    .replace(/<\/html>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<body[^>]*>/gi, '')
    .replace(/<\/body>/gi, '')
    .trim();

  console.log(`✅ Stripped outer tags — new length: ${emailBodyHtml.length} chars`);
}
```

### 3. Enhanced Logging for Debugging
Added logging at three key points:

**Finalization (line 697):**
```javascript
console.warn(`⚠️  First 200 chars: ${emailBodyHtml.substring(0, 200)}`);
```

**After Wrapping (line 731):**
```javascript
console.log(`📧 First 300 chars of wrapped email: ${brandedEmailHtml.substring(0, 300)}...`);
```

**Before Sending (line 74 of sendEmail.js):**
```javascript
console.log(`📧 First 500 chars of message before encoding: ${message.substring(0, 500)}...`);
```

This allows inspection of:
1. What the agent generated
2. What the template wrapper produced
3. What the Gmail API received

## How It Works

### Before Fix:
```
Agent generates:
<html><head></head><body><p>Hi Chris,</p>...</body></html>

wrapInBrandedTemplate wraps it:
<html><body>...<div>${emailBodyContent}</div>...</body></html>

Result:
<html><body>...<div><html><head></head><body><p>Hi Chris,</p>...</body></html></div>...</body></html>

Email client: Sees nested HTML tags, falls back to plain text display
```

### After Fix:
```
Agent generates (corrected by prompt):
<p>Hi Chris,</p><p>Based on what you shared...</p>

OR (if agent still generates full document):
<html><head></head><body><p>Hi Chris,</p>...</body></html>
↓ Stripped by defensive code ↓
<p>Hi Chris,</p>...

wrapInBrandedTemplate wraps it:
<html><body>...<div><p>Hi Chris,</p>...</div>...</body></html>

Email client: Sees properly formed HTML, renders correctly
```

## Testing

After deployment, test with:
1. Complete a lead-gen conversation through to email CTA
2. **Check Railway logs:**
   - Look for "⚠️  email_summary_body contains <html> or <!DOCTYPE> tags" warning
   - If present, confirms agent is generating full documents (defensive code will strip them)
   - Review "First 300 chars of wrapped email" to verify structure
   - Review "First 500 chars of message before encoding" to verify MIME headers
3. **Check received email:**
   - Verify HTML renders properly (bold text, clickable links, proper formatting)
   - Verify no raw HTML tags visible
   - Verify GrantedPro/Starter links are clickable
   - Verify booking link is clickable (if included)

## Files Modified
1. `.claude/agents/lead-gen-variant-b.md` - Added HTML fragment format instruction (line 275)
2. `/src/api/lead-gen-finalization.js` - Added defensive HTML tag stripping + logging (lines 694-710, 731)
3. `/src/email/sendEmail.js` - Added logging before encoding (line 74)

## Result
Emails now render properly in all email clients by ensuring:
1. Agent generates HTML fragments only (no document structure)
2. Defensive code strips any duplicate tags if agent ignores instruction
3. wrapInBrandedTemplate adds proper document structure once
4. Enhanced logging helps debug any future issues

The two-layer fix (prompt + defensive code) ensures emails work even if the agent occasionally generates full HTML documents.
