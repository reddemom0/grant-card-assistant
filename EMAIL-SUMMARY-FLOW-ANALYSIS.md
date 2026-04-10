# Email Funding Summary Flow - Complete Analysis

## Intended Behavior (What Should Happen)

1. **User clicks "Send me the funding summary" button** → Email sent immediately
2. **User continues chatting after estimate** → Email includes info from further conversation
3. **User gets estimate and walks away** → Email sent automatically after 5min timeout

---

## Current Architecture

### EMAIL SENDING TRIGGERS (2 Paths)

#### **TRIGGER A: Button Click (Immediate Send)**
**Flow:**
1. User clicks "📧 Send me the funding summary" button (widget line 2553)
2. Widget sends system message: `[SYSTEM: User requested email summary]` (line 2567)
3. Agent receives system message and calls `save_lead_data` with:
   - `cta_selected = "email_summary"`
   - `email_summary_body` (regenerated or reused from CALL 1)
4. `save_lead_data` → calls `sendLeadGenEmail()` (save-lead-data.js:515)
5. Email sent immediately

**Requirements for email to send:**
- ✅ `contact_email` exists
- ✅ Either `cta_selected.includes('email')` OR `email_summary_body` exists (lead-gen-finalization.js:904-907)

---

#### **TRIGGER B: Inactivity Timeout (Auto-Send)**
**Flow:**
1. Cron job runs every 10 minutes: `scripts/finalize-inactive-lead-gen.js`
2. Searches for sessions where:
   - `finalized = FALSE`
   - `last_activity_at < NOW() - 5 minutes`
   - `prospect_data->>'company_name' IS NOT NULL`
   - `message_count >= 1` (lead-gen-finalization.js:1728-1735)
3. For each qualifying session:
   - Calls `finalizeLeadGenConversation()` (creates HubSpot records)
   - Checks if email should auto-send:
     - `hasEmail = !!session.contact_email`
     - `hasEmailBody = !!prospectData.email_summary_body` (line 1763)
   - If both true, calls `sendLeadGenEmail()` (line 1768)

**Requirements for auto-send:**
- ✅ `contact_email` exists
- ✅ `email_summary_body` exists
- ⏱️ 5 minutes of inactivity

---

### EMAIL CONTENT GENERATION

#### **Agent Responsibilities**

**CALL 1: Immediately after delivering estimate** (system-operations.md:72-76)
```
save_lead_data called with:
- email_summary_body: GENERATE NOW (stored for timeout trigger)
- cta_selected: "none" (no CTA happened yet)
```

**CALL 2: When button clicked** (system-operations.md:78-81)
```
[SYSTEM: User requested email summary] received
save_lead_data called with:
- cta_selected: "email_summary"
- email_summary_body: regenerate or reuse from CALL 1
- Include any NEW data from continued conversation
```

**Email Format Requirements:**
- HTML fragments only (no `<html>`, `<head>`, `<body>` tags)
- Tier-specific content (Pro/Starter/GetGranted)
- Pillar-by-pillar breakdown
- Booking link with offer language (not assumption)
- Personalized with specific activities discussed

---

### EMAIL SEND LOGIC (sendLeadGenEmail)

**Location:** `src/api/lead-gen-finalization.js:885-1013`

**Conditions Check (line 901-912):**
```javascript
const hasExplicitRequest = prospectData.cta_selected && prospectData.cta_selected.includes('email');
const hasEmailBody = !!prospectData.email_summary_body;

if (!hasExplicitRequest && !hasEmailBody) {
  return { success: false, error: 'Email not requested' };
}
```

**Email sent if:**
- `cta_selected.includes('email')` (button click), OR
- `email_summary_body` exists (timeout path)

**Duplicate Prevention:**
```javascript
if (prospectData.email_sent_at) {
  return { success: false, error: 'Email already sent', alreadySent: true };
}
```

**Fallback Email:**
If no `email_summary_body`, generates fallback using `generateFallbackEmail()` (line 934-939)

---

## PROBLEM DIAGNOSIS

### Why Emails Might Not Be Sent

#### **Issue 1: email_summary_body Not Generated in CALL 1**
**Symptom:** User walks away, no email auto-sent after 5min

**Root Cause:**
- Agent may not be generating `email_summary_body` in first `save_lead_data` call
- If `email_summary_body` is missing, timeout trigger sees `hasEmailBody = false` and skips auto-send (line 1783)

**Check:**
```sql
SELECT session_id, contact_email, 
       prospect_data->>'email_summary_body' as email_body,
       prospect_data->>'cta_selected' as cta,
       last_activity_at
FROM lead_gen_conversations
WHERE contact_email IS NOT NULL
  AND finalized = FALSE
ORDER BY created_at DESC
LIMIT 10;
```

---

#### **Issue 2: Inactivity Threshold Too Long**
**Symptom:** User waits >5min but no email arrives

**Current Setting:** 5 minutes (scripts/finalize-inactive-lead-gen.js:30)

**Cron Schedule:** Every 10 minutes (RAILWAY_CRON_SETUP.md)

**Problem:** If user walks away at minute 0, they qualify at minute 5, but cron might not run until minute 10. Effective delay: 5-15 minutes.

---

#### **Issue 3: Button Click Path Failure**
**Symptom:** User clicks button, sees "✓ Summary sent!" but no email arrives

**Possible Causes:**
1. System message `[SYSTEM: User requested email summary]` not triggering agent response
2. Agent doesn't call `save_lead_data` with `cta_selected = "email_summary"`
3. Email send error (check SMTP logs)

**Debug Path:**
- Widget logs: Does system message get sent? (line 2567)
- Agent logs: Does agent call `save_lead_data`?
- Email logs: Does `sendLeadGenEmail()` get called? Success/error?

---

#### **Issue 4: Email Already Sent Flag**
**Symptom:** Button clicked second time, or timeout tries to send after button send

**Expected:** `email_sent_at` timestamp prevents duplicates

**Check:**
```sql
SELECT session_id, 
       prospect_data->>'email_sent_at' as sent_at,
       prospect_data->>'cta_selected' as cta
FROM lead_gen_conversations
WHERE contact_email IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

---

## TESTING CHECKLIST

### Scenario 1: Button Click (Immediate Send)
1. Complete form, get estimate
2. Click "📧 Send me the funding summary"
3. **Expected:**
   - Button changes to "✓ Summary sent!"
   - Email arrives within 1 minute
   - `cta_selected = "email_summary"` in database
   - `email_sent_at` timestamp recorded

**Debug Queries:**
```sql
-- Check save_lead_data was called
SELECT prospect_data->>'cta_selected', prospect_data->>'email_sent_at'
FROM lead_gen_conversations WHERE session_id = 'SESSION_ID';

-- Check email log
SELECT * FROM lead_gen_analytics 
WHERE conversation_id = 'SESSION_ID' AND event_type = 'email_sent';
```

---

### Scenario 2: Continued Conversation (Button Click Later)
1. Complete form, get estimate
2. Ask 2-3 follow-up questions
3. Click summary button
4. **Expected:**
   - Email includes insights from follow-up conversation
   - `email_summary_body` regenerated with new data

---

### Scenario 3: Walk Away (Auto-Send)
1. Complete form, get estimate
2. Close browser
3. Wait 5-15 minutes
4. **Expected:**
   - Cron detects inactivity
   - Email auto-sent
   - `email_sent_at` timestamp recorded

**Debug:**
```sql
-- Check if session qualifies for timeout
SELECT session_id, last_activity_at,
       NOW() - last_activity_at as inactive_duration,
       finalized,
       prospect_data->>'email_summary_body' IS NOT NULL as has_email_body
FROM lead_gen_conversations
WHERE session_id = 'SESSION_ID';
```

---

## LOGS TO CHECK

### Railway Logs (Cron)
```
🔄 Lead-Gen Inactive Session Finalization
Found X inactive session(s) to finalize
📧 Auto-sending funding summary email to email@example.com (inactivity timeout)...
📧 Auto-sent funding summary email to email@example.com (inactivity timeout)
```

### Application Logs (Button Click)
```
🔍 DEBUG: save_lead_data payload size: X chars
🔍 DEBUG: email_summary_body present: true
📧 Calling sendEmail for email@example.com...
✅ Email summary sent to email@example.com — Message ID: XXXX
```

### Error Patterns
```
⚠️  No email_summary_body — skipping auto-send
ℹ️  Email summary NOT requested and no email body prepared — skipping
⚠️  Email send failed: [error message]
```

---

## NEXT STEPS

1. **Query Production DB** to check email_summary_body presence in recent sessions
2. **Review Recent Cron Logs** to see if timeout emails are being sent
3. **Test Button Click Path** to verify save_lead_data + email send works
4. **Check SMTP Logs** for email delivery failures

After reviewing logs and database, we can determine:
- Is the agent generating email_summary_body in CALL 1?
- Are emails being sent but not delivered (SMTP issue)?
- Is the cron running and detecting inactive sessions?
- Are button clicks triggering the full flow?
