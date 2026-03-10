# Email Sending Flow - Complete End-to-End Trace

## Overview

There are **TWO TRIGGERS** that should send emails to prospects:

1. **TRIGGER 1 (Immediate)**: Prospect clicks "Send me the funding summary" button
2. **TRIGGER 2 (Delayed)**: Conversation times out after 5 minutes of inactivity

Both triggers use the same email sending code path in `finalizeLeadGenConversation()`.

---

## TRIGGER 1: Summary Button Click → Email Sent

### Step 1: Widget Code (`widget/getgranted-widget.js` lines 2307-2335)

**User Action:** Prospect clicks "Send me the funding summary" button

**Widget Code:**
```javascript
summaryButton.addEventListener('click', async () => {
  // Disable button and show "Sending..." state
  summaryButton.disabled = true;
  summaryButton.textContent = '⏳ Sending...';

  try {
    // Send system message (hidden from UI)
    await sendMessage('[SYSTEM: User requested email summary]', true);

    // Update button to "sent" state
    summaryButton.classList.add('sent');
    summaryButton.textContent = '✓ Summary sent!';
    summaryButton.disabled = true;

  } catch (error) {
    console.error('Summary request failed:', error);
    // Reset button on error
    summaryButton.disabled = false;
    summaryButton.textContent = '📧 Send me the funding summary';
  }
});
```

**What Happens:**
- Button goes to "Sending..." state
- System message `[SYSTEM: User requested email summary]` is sent to backend
- System message is marked as `isSystemMessage: true` (hidden from UI)
- Button updates to "✓ Summary sent!" state

---

### Step 2: Agent Receives System Message (`.claude/agents/lead-gen.md`)

**Agent Sees:**
```
User message: [SYSTEM: User requested email summary]
```

**Agent Should:**
1. Recognize this as a request to send email summary
2. Call `save_lead_data` tool with:
   - `cta_selected: 'email_summary'`
   - `email_summary_body: "<p>Hi [Name]...</p>"` (HTML fragments, NOT full HTML document)
   - All other prospect data collected during conversation

**Agent Prompt (lines 329-335):**
```
<tool_save_lead_data>
save_lead_data — Save the complete lead record when the prospect provides contact info in Phase 5.

INCLUDE: cta_selected (book_call / email_summary / resources), lead_score (hot / warm / cool),
hs_lead_status (New / Open / Unqualified), name, email, company_name, province, revenue,
employee_count, company_description, activities_discussed, programs_matched,
estimated_funding_range, prior_grant_experience, prospect_summary (2-3 sentence natural
language summary of who the prospect is, what they need, what was recommended, and why),
and all individual scoring signals you captured.

CRITICAL: Once save_lead_data has been called, do NOT call any other tools. Write the
confirmation message and end the conversation.
</tool_save_lead_data>
```

**Expected Tool Call:**
```json
{
  "name": "save_lead_data",
  "input": {
    "name": "Chris Smith",
    "email": "chris@example.com",
    "company_name": "Example Manufacturing",
    "province": "British Columbia",
    "revenue": "$500K-$1M",
    "employee_count": "10-15",
    "cta_selected": "email_summary",
    "email_summary_body": "<p>Hi Chris,</p><p>Based on our conversation...</p>",
    "estimated_funding": "$25K-$45K",
    "matched_programs": ["BC ETG", "Canada-BC Job Grant", "IRAP YEP"],
    "lead_score": "warm",
    "prospect_summary": "Manufacturing company in BC, 15 employees, hiring 3 machinists..."
  }
}
```

---

### Step 3: save_lead_data Tool (`src/tools/save-lead-data.js` lines 347-522)

**What It Does:**

**Lines 459-460:**
```javascript
// Email summary body from agent (for email sending)
email_summary_body:     input.email_summary_body     || null,
```

**Lines 465-484:**
```javascript
await query(
  `UPDATE lead_gen_conversations
      SET contact_name      = $1,
          contact_email     = $2,
          prospect_data     = prospect_data || $3::jsonb,
          matched_programs  = $4,
          estimated_funding = $5,
          cta_selected      = $6,
          updated_at        = NOW()
    WHERE session_id = $7`,
  [
    name,
    email,
    JSON.stringify(prospectData),  // Contains email_summary_body
    JSON.stringify(input.matched_programs || []),
    input.estimated_funding || null,
    input.cta_selected      || null,  // 'email_summary'
    conversationId
  ]
);
```

**Lines 496-500:**
```javascript
const result = await finalizeLeadGenConversation(conversationId, 'contact_captured');

if (result.success) {
  console.log(`✅ Session finalized via contact_captured`);
  return { success: true, message: `Lead data saved and synced to HubSpot.`, ...result };
}
```

**Key Logs to Check:**
```
🔍 DEBUG: save_lead_data payload size: [X] chars
🔍 DEBUG: email_summary_body present: true
🔍 DEBUG: email_summary_body size: [X] chars
✅ lead_gen_conversations updated for session [ID] — cta_selected: "email_summary", has_email_body: true
```

---

### Step 4: finalizeLeadGenConversation (`src/api/lead-gen-finalization.js` lines 1145-1619)

**Called with:** `(conversationId, 'contact_captured')`

**Lines 1154-1163:** Atomically claim session for finalization
```javascript
const sessionResult = await query(
  `UPDATE lead_gen_conversations
   SET finalized = TRUE,
       finalized_at = NOW(),
       finalization_trigger = $2
   WHERE session_id = $1
     AND finalized = FALSE
   RETURNING *`,
  [sessionId, trigger]
);
```

**Lines 1507-1509:** Check if email should be sent
```javascript
console.log(`📧 Checking email CTA — cta_selected: "${prospectData.cta_selected}", has_contact_email: ${!!session.contact_email}`);

if (prospectData.cta_selected && prospectData.cta_selected.includes('email')) {
  console.log('📧 Email summary requested — preparing to send via Nodemailer...');
```

**CRITICAL CONDITION:** Email is sent if:
1. `prospectData.cta_selected` contains 'email' (e.g., 'email_summary')
2. `session.contact_email` exists

**Lines 1512-1515:** No email check
```javascript
if (!session.contact_email) {
  console.warn('⚠️  Cannot send email summary — no contact_email captured');
  results.email = { action: 'skipped', reason: 'no_contact_email' };
}
```

**Lines 1523-1531:** Get email body or generate fallback
```javascript
// Get email summary body from agent or generate fallback
let emailBodyHtml = prospectData.email_summary_body;

if (!emailBodyHtml) {
  console.log('⚠️  No email_summary_body from agent — generating fallback email');
  emailBodyHtml = generateFallbackEmail(
    prospectData,
    session.estimated_funding || prospectData.estimated_funding,
    firstName
  );
}
```

**Lines 1536-1551:** Strip duplicate HTML tags (defensive code)
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

**Lines 1554-1559:** Convert markdown to HTML (safety net)
```javascript
// Convert markdown to HTML (safety net for email formatting)
const originalLength = emailBodyHtml.length;
emailBodyHtml = convertMarkdownToHtml(emailBodyHtml);
if (emailBodyHtml.length !== originalLength) {
  console.log(`  🎨 Converted markdown to HTML in email body (safety net)`);
}
```

**Lines 1570-1572:** Wrap in branded template
```javascript
// Wrap in branded HTML template
const brandedEmailHtml = wrapInBrandedTemplate(emailBodyHtml);
console.log(`📧 Email template wrapped (total ${brandedEmailHtml.length} chars)`);
console.log(`📧 First 300 chars of wrapped email: ${brandedEmailHtml.substring(0, 300)}...`);
```

**Lines 1577-1585:** Actually send email
```javascript
console.log(`📧 Calling sendEmail for ${session.contact_email}...`);
const emailResult = await sendEmail({
  to: session.contact_email,
  toName: session.contact_name || firstName,
  subject: `Your funding estimate for ${prospectData.company_name || 'your company'}`,
  htmlBody: brandedEmailHtml
});
console.log(`✅ Email summary sent to ${session.contact_email} for session ${sessionId} — Message ID: ${emailResult.messageId}`);
results.email = { action: 'sent', recipient: session.contact_email, messageId: emailResult.messageId };
```

**Lines 1586-1592:** Error handling
```javascript
catch (err) {
  // Don't fail finalization if email send fails, but log the full error
  console.error(`❌ Email send FAILED for ${session.contact_email}:`, err.message);
  console.error(`❌ Error code: ${err.code}, command: ${err.command}, response: ${err.response}`);
  console.error(`❌ Full error object:`, JSON.stringify(err, null, 2));
  results.email = { action: 'failed', recipient: session.contact_email, error: err.message };
}
```

**Key Logs to Check:**
```
📧 Checking email CTA — cta_selected: "email_summary", has_contact_email: true
📧 Email summary requested — preparing to send via Nodemailer...
📧 Preparing email for chris@example.com...
📧 Using agent-generated email_summary_body ([X] chars)
📧 Email template wrapped (total [X] chars)
📧 Calling sendEmail for chris@example.com...
✅ Email summary sent to chris@example.com for session [ID] — Message ID: [ID]
```

---

### Step 5: sendEmail (`src/email/sendEmail.js` lines 35-95)

**Uses:** Gmail API over HTTPS (not SMTP, because Railway blocks SMTP ports)

**Lines 36-44:** Check credentials
```javascript
console.log(`📧 sendEmail called for recipient: ${to}`);
console.log(`📧 Using Gmail API over HTTPS (not SMTP — bypasses Railway port blocking)`);
console.log(`📧 CLIENT_ID set: ${!!GOOGLE_CLIENT_ID}, SECRET set: ${!!GOOGLE_CLIENT_SECRET}, REFRESH_TOKEN set: ${!!GMAIL_REFRESH_TOKEN}`);

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
  const error = 'Gmail API credentials not configured (need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)';
  console.error(`❌ ${error}`);
  throw new Error(error);
}
```

**Lines 53-63:** Build RFC 2822 formatted message
```javascript
const messageParts = [
  `From: Granted Consulting <writers@granted.ca>`,
  `To: ${to}`,
  `Reply-To: marketing@granted.ca`,
  `Subject: ${utf8Subject}`,
  `MIME-Version: 1.0`,
  `Content-Type: text/html; charset=utf-8`,
  '',
  htmlBody
];
const message = messageParts.join('\n');
```

**Lines 66-70:** Base64url encode
```javascript
// Base64url encode the message
const encodedMessage = Buffer.from(message)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
```

**Lines 76-84:** Send via Gmail API
```javascript
const result = await gmail.users.messages.send({
  userId: 'me',
  requestBody: {
    raw: encodedMessage
  }
});

console.log(`✅ Gmail API send succeeded — Message ID: ${result.data.id}`);
console.log(`✅ Email sent successfully to ${to} — Message ID: ${result.data.id}`);
return { success: true, messageId: result.data.id };
```

**Lines 86-94:** Error handling
```javascript
catch (err) {
  console.error(`❌ Gmail API send FAILED for ${to}:`, err.message);
  if (err.response) {
    console.error(`❌ Gmail API response status: ${err.response.status}`);
    console.error(`❌ Gmail API response data:`, JSON.stringify(err.response.data, null, 2));
  }
  console.error(`❌ Full error:`, err);
  throw err;
}
```

**Key Logs to Check:**
```
📧 sendEmail called for recipient: chris@example.com
📧 Using Gmail API over HTTPS (not SMTP — bypasses Railway port blocking)
📧 CLIENT_ID set: true, SECRET set: true, REFRESH_TOKEN set: true
📧 Sending email to chris@example.com with subject: "Your funding estimate for Example Manufacturing"
📧 Message encoded ([X] chars base64)
📧 First 500 chars of message before encoding: From: Granted Consulting <writers@granted.ca>...
✅ Gmail API send succeeded — Message ID: [ID]
✅ Email sent successfully to chris@example.com — Message ID: [ID]
```

---

## TRIGGER 2: Conversation Timeout → Email Sent

### Step 1: Background Job (`src/api/lead-gen-finalization.js` lines 1642-1694)

**Function:** `finalizeInactiveSessions()`

**Called by:** Cron job or manual trigger (endpoint: `/api/lead-gen-finalize-inactive`)

**Lines 1655-1667:** Find inactive sessions
```javascript
const sessions = await query(
  `SELECT session_id, prospect_data, contact_email, message_count
   FROM lead_gen_conversations
   WHERE status = 'active'
     AND finalized = FALSE
     AND updated_at < NOW() - INTERVAL '5 minutes'
   ORDER BY updated_at ASC`,
  []
);

console.log(`\n🔍 Found ${sessions.rows.length} sessions inactive for 5+ minutes\n`);
```

**Lines 1674-1689:** Finalize each session
```javascript
const result = await finalizeLeadGenConversation(session.session_id, 'inactivity_timeout');

if (result.success) {
  results.finalized++;
  console.log(`✅ [${results.processed}/${sessions.length}] Finalized: ${session.prospect_data?.company_name || session.session_id}`);
} else if (result.alreadyFinalized) {
  // Skip — was finalized by another process
  console.log(`⚠️  [${results.processed}/${sessions.length}] Already finalized: ${session.session_id}`);
} else {
  results.errors++;
  console.warn(`❌ [${results.processed}/${sessions.length}] Failed: ${session.session_id} — ${result.error}`);
}
```

---

### Step 2: finalizeLeadGenConversation (Same as TRIGGER 1)

Called with: `(sessionId, 'inactivity_timeout')`

**Same email logic as TRIGGER 1:**
- Checks `prospectData.cta_selected.includes('email')` AND `session.contact_email` exists
- Gets `email_summary_body` from prospect_data or generates fallback
- Wraps in branded template
- Sends via Gmail API

**Key Difference:**
- Trigger is `'inactivity_timeout'` instead of `'contact_captured'`
- Otherwise, email sending logic is **IDENTICAL**

---

## Why Emails Might Not Be Sent

### Condition 1: cta_selected is not 'email_summary'

**Check:**
```sql
SELECT session_id, cta_selected, prospect_data->>'cta_selected' as pd_cta
FROM lead_gen_conversations
WHERE session_id = '[session_id]';
```

**If cta_selected is NULL or doesn't contain 'email':**
- Agent didn't call save_lead_data with `cta_selected: 'email_summary'`
- Agent might have called save_lead_data with `cta_selected: 'book_call'` or `cta_selected: 'resources'`
- Agent didn't recognize `[SYSTEM: User requested email summary]` message

**Fix:** Check agent logs to see if agent called save_lead_data and what parameters it passed

---

### Condition 2: contact_email is missing

**Check:**
```sql
SELECT session_id, contact_email, contact_name
FROM lead_gen_conversations
WHERE session_id = '[session_id]';
```

**If contact_email is NULL:**
- Agent didn't call save_lead_data with email parameter
- save_lead_data was called before contact info was captured
- Agent skipped CTA phase entirely

**Fix:** Check conversation history to see if agent asked for email and received it

---

### Condition 3: email_summary_body is missing

**Check:**
```sql
SELECT session_id, prospect_data->>'email_summary_body' as email_body
FROM lead_gen_conversations
WHERE session_id = '[session_id]';
```

**If email_summary_body is NULL:**
- Agent didn't include email_summary_body in save_lead_data call
- Fallback email will be generated instead
- **This is OK** — fallback email is generic but functional

**Fix:** Agent should include email_summary_body for personalized emails

---

### Condition 4: Gmail API credentials missing/invalid

**Check Railway logs for:**
```
📧 CLIENT_ID set: false, SECRET set: false, REFRESH_TOKEN set: false
❌ Gmail API credentials not configured
```

**If credentials are missing:**
- Railway environment variables not set: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`
- Credentials expired or revoked

**Fix:** Set/refresh Gmail API credentials in Railway

---

### Condition 5: Gmail API send failed

**Check Railway logs for:**
```
❌ Gmail API send FAILED for chris@example.com: [error message]
❌ Gmail API response status: 401 / 403 / 429 / 500
```

**Common errors:**
- 401 Unauthorized: Refresh token expired
- 403 Forbidden: Insufficient permissions
- 429 Rate Limit: Too many emails sent
- 500 Server Error: Gmail API temporary failure

**Fix:** Depends on error code — refresh credentials, wait for rate limit, retry

---

### Condition 6: Session already finalized

**Check:**
```sql
SELECT session_id, finalized, finalized_at, finalization_trigger
FROM lead_gen_conversations
WHERE session_id = '[session_id]';
```

**If finalized = TRUE:**
- Session was already finalized by another process (race condition)
- Email was already sent (or attempted)
- Second finalization attempt is skipped

**Fix:** Check finalization_trigger to see which trigger finalized first

---

## What to Check in Railway Logs

### For TRIGGER 1 (Button Click):

**Search for:**
```
[SYSTEM: User requested email summary]
```

**Then look for:**
```
🔍 DEBUG: save_lead_data payload
cta_selected: "email_summary"
email_summary_body present: true
📧 Checking email CTA — cta_selected: "email_summary"
📧 Email summary requested
📧 Calling sendEmail for
✅ Email summary sent to
✅ Gmail API send succeeded
```

**If email NOT sent, look for:**
```
ℹ️  Email summary NOT requested — skipping email send
⚠️  Cannot send email summary — no contact_email captured
❌ Email send FAILED
❌ Gmail API send FAILED
```

---

### For TRIGGER 2 (Timeout):

**Search for:**
```
🔍 Found [N] sessions inactive for 5+ minutes
```

**Then look for:**
```
[1/N] Finalized: [company name]
📧 Checking email CTA — cta_selected: "email_summary"
📧 Email summary requested
📧 Calling sendEmail for
✅ Email summary sent to
```

---

## Test Scenarios

### Scenario 1: Button Click → Email Sent (Happy Path)

1. Prospect fills out form with email
2. Agent delivers estimate
3. Prospect clicks "Send me the funding summary" button
4. Widget sends `[SYSTEM: User requested email summary]`
5. Agent calls save_lead_data with `cta_selected: 'email_summary'` and `email_summary_body: '<p>...</p>'`
6. save_lead_data stores data and calls finalizeLeadGenConversation
7. finalize checks cta_selected = 'email_summary' → email sent
8. Prospect receives email within 5-10 seconds

**Expected Logs:**
```
[Tool call] save_lead_data
cta_selected: "email_summary"
email_summary_body present: true
📧 Email summary requested
📧 Calling sendEmail for chris@example.com
✅ Email sent successfully to chris@example.com — Message ID: [ID]
```

---

### Scenario 2: Button Click → Email NOT Sent (Agent Didn't Set CTA)

1. Prospect fills out form with email
2. Agent delivers estimate
3. Prospect clicks "Send me the funding summary" button
4. Widget sends `[SYSTEM: User requested email summary]`
5. Agent calls save_lead_data BUT with `cta_selected: 'book_call'` (wrong CTA)
6. save_lead_data stores data and calls finalizeLeadGenConversation
7. finalize checks cta_selected = 'book_call' → does NOT contain 'email' → email skipped

**Expected Logs:**
```
[Tool call] save_lead_data
cta_selected: "book_call"
📧 Checking email CTA — cta_selected: "book_call"
ℹ️  Email summary NOT requested — skipping email send
```

**Fix:** Agent needs to recognize `[SYSTEM: User requested email summary]` and set `cta_selected: 'email_summary'`

---

### Scenario 3: Timeout → Email Sent (Fallback Email)

1. Prospect fills out form with email
2. Agent delivers estimate
3. Prospect doesn't click button, conversation times out after 5 minutes
4. Background job finds inactive session
5. Calls finalizeLeadGenConversation with trigger='inactivity_timeout'
6. Checks if cta_selected contains 'email' → might be NULL or 'none' → email NOT sent

**Expected Logs:**
```
🔍 Found 1 sessions inactive for 5+ minutes
[1/1] Finalized: Example Manufacturing
📧 Checking email CTA — cta_selected: null
ℹ️  Email summary NOT requested — skipping email send
```

**Note:** Timeout trigger only sends email if cta_selected was already set to 'email_summary' (e.g., prospect requested email but session timed out before finalization completed).

---

## Summary

**Email is ONLY sent if:**
1. `prospectData.cta_selected` contains 'email' (e.g., 'email_summary')
2. `session.contact_email` is set
3. Gmail API credentials are configured
4. Gmail API send succeeds

**Where email_summary_body comes from:**
- **Primary:** Agent provides it in save_lead_data call (personalized email)
- **Fallback:** Generated automatically from prospect_data (generic email)

**Sending mechanism:**
- Gmail API over HTTPS (not SMTP)
- Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN

**Branded template:**
- Email body is wrapped in `wrapInBrandedTemplate()` which adds header, footer, and styling

**Error handling:**
- Email send errors do NOT fail finalization
- Errors are logged but finalization completes successfully
- HubSpot records are created regardless of email send success/failure
