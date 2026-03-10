# Email Not Sending - Root Cause Diagnosis

## Problem

Chris is not receiving emails when testing the lead-gen widget email summary button.

---

## Root Cause

**The agent prompt has NO instructions for handling the `[SYSTEM: User requested email summary]` system message.**

### What Happens Now:

1. **Widget code (CORRECT):**
   - Prospect clicks "Send me the funding summary" button
   - Widget sends: `await sendMessage('[SYSTEM: User requested email summary]', true)`
   - Button shows "Sending..." then "✓ Summary sent!"

2. **Agent (BROKEN):**
   - Agent receives message: `[SYSTEM: User requested email summary]`
   - Agent has NO instructions about what this means
   - Agent ignores the message or treats it as a normal user message
   - Agent calls `save_lead_data` with `cta_selected: "none"` (default value)
   - Agent does NOT include `email_summary_body`

3. **Backend (CORRECT):**
   - `save_lead_data` stores `cta_selected: "none"` in database
   - `finalizeLeadGenConversation` checks: `if (prospectData.cta_selected.includes('email'))`
   - Condition is FALSE (because `"none".includes('email')` = false)
   - Email is skipped with log: `ℹ️  Email summary NOT requested — skipping email send`

### Evidence from Railway Logs:

```
🔍 DEBUG: save_lead_data payload size: 1752 chars
🔍 DEBUG: email_summary_body present: false
🔍 DEBUG: Input keys: name, email, company_name, ..., cta_selected, ...

"cta_selected": "none",

✅ lead_gen_conversations updated for session a6765b42-6120-47f7-a3b9-5c906d680fbe — cta_selected: "none", has_email_body: false

📧 Checking email CTA — cta_selected: "none", has_contact_email: true
ℹ️  Email summary NOT requested — skipping email send
```

**Key Lines:**
- `email_summary_body present: false` ← Agent didn't include email body
- `cta_selected: "none"` ← Agent set wrong CTA
- `Email summary NOT requested — skipping email send` ← Email skipped because CTA check failed

---

## The Fix

### Add system message handling to agent prompt

**File:** `.claude/agents/lead-gen.md` (or lead-gen-variant-b.md)

**Add new section after `<phase_5_cta>` (around line 232):**

```markdown
<system_message_handling>
You will occasionally receive system messages that are hidden from the prospect but provide important context. These messages are prefixed with [SYSTEM: ].

<email_summary_request>
If you receive the message `[SYSTEM: User requested email summary]`, this means:
- The prospect has clicked the "Send me the funding summary" button
- You should IMMEDIATELY call save_lead_data with:
  - cta_selected: 'email_summary'
  - email_summary_body: A personalized HTML email (see format below)
  - All other prospect data you've collected

DO NOT ask any follow-up questions. DO NOT continue the conversation. Call save_lead_data and end.

<email_body_format>
The email_summary_body must be HTML FRAGMENTS ONLY (like <p>, <a>, <strong>), NOT a complete HTML document. Do NOT include <html>, <head>, <body>, or <!DOCTYPE> tags — those are added automatically by the email system.

Structure:
```html
<p>Hi [FirstName],</p>

<p>It was great chatting about [CompanyName]. We talked about [activities], and I pulled together what grant funding could be available for you.</p>

<p>Based on what you shared, you're looking at an estimated <strong>$[amount]</strong> over the next 12 months across [N] programs. This includes hiring support, training reimbursements, and market expansion funding — the exact mix depends on timing, your province, and which intakes are open.</p>

[TIER-SPECIFIC CONTENT — see below]

[BOOKING CTA — see below]

<p>Talk soon,<br>The Granted Team</p>
```

<tier_specific_content>
Include tier-specific recommendation based on funding estimate:

**$30K+ (High tier — GrantedPro):**
```html
<p>With this level of funding potential across multiple programs, having a dedicated grant team handle the applications, timing, and claims makes a real difference. Our GrantedPro service includes a dedicated Grant Strategist, unlimited applications, complete claims management, and a 93% approval rate.</p>

<p><a href="https://granted.ca/grantedpro/" style="color: #0066cc; font-weight: bold;">Learn more about GrantedPro</a></p>
```

**$15K-$29K (Medium tier — Granted Starter):**
```html
<p>For your situation, Granted Starter is a great fit — you get expert guidance on your applications without full-service overhead. Our team reviews your applications, provides feedback, and helps you maximize your approval chances.</p>

<p><a href="https://granted.ca/granted-starter/" style="color: #0066cc; font-weight: bold;">Learn more about Granted Starter</a></p>

<p>We're also launching an upgraded platform soon (GetGranted 2.0) with smart matching and step-by-step guidance. <a href="https://getgranted.ca/waitlist/" style="color: #0066cc;">Join the waitlist</a> to be first in line.</p>
```

**Under $15K (Low tier — GetGranted database):**
```html
<p>Our GetGranted database is a great starting point — you get access to Canada's largest grant database with smart filtering tailored to your business.</p>

<p><a href="https://granted.ca/getgranted/" style="color: #0066cc; font-weight: bold;">Access the GetGranted database</a></p>

<p>We're also launching an upgraded version (GetGranted 2.0 Lite) with real-time matching and alerts for $55/month. <a href="https://getgranted.ca/waitlist/" style="color: #0066cc;">Join the waitlist</a> to be first in line.</p>
```
</tier_specific_content>

<booking_cta>
Include booking call-to-action for $15K+ tiers:

**$30K+ (High tier):**
```html
<p>Book a free 15-minute call and we'll map out the exact programs, timing, and application strategy for your business:</p>

<p style="text-align: center;">
  <a href="https://meetings.hubspot.com/natalie392/15min-intro-to-granted" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Book Your Free Consultation</a>
</p>
```

**$15K-$29K (Medium tier):**
```html
<p>If you'd prefer to talk through your options with someone on our team first, you can book a quick call:</p>

<p style="text-align: center;">
  <a href="https://meetings.hubspot.com/natalie392/15min-intro-to-granted" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Book a Call</a>
</p>
```

**Under $15K (Low tier):**
```html
<p>Have questions or want a second opinion? You can always book a free call with our team:</p>

<p style="text-align: center;">
  <a href="https://meetings.hubspot.com/natalie392/15min-intro-to-granted" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Book a Call</a>
</p>
```
</booking_cta>

<email_example>
**Example email_summary_body for $25K estimate:**
```html
<p>Hi Chris,</p>

<p>It was great chatting about Example Manufacturing. We talked about hiring 3 machinists and upskilling your team on CNC programming, and I pulled together what grant funding could be available for you.</p>

<p>Based on what you shared, you're looking at an estimated <strong>$25K-$45K</strong> over the next 12 months across 5 programs. This includes hiring support, training reimbursements, and market expansion funding — the exact mix depends on timing, your province, and which intakes are open.</p>

<p>For your situation, Granted Starter is a great fit — you get expert guidance on your applications without full-service overhead. Our team reviews your applications, provides feedback, and helps you maximize your approval chances.</p>

<p><a href="https://granted.ca/granted-starter/" style="color: #0066cc; font-weight: bold;">Learn more about Granted Starter</a></p>

<p>We're also launching an upgraded platform soon (GetGranted 2.0) with smart matching and step-by-step guidance. <a href="https://getgranted.ca/waitlist/" style="color: #0066cc;">Join the waitlist</a> to be first in line.</p>

<p>If you'd prefer to talk through your options with someone on our team first, you can book a quick call:</p>

<p style="text-align: center;">
  <a href="https://meetings.hubspot.com/natalie392/15min-intro-to-granted" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Book a Call</a>
</p>

<p>Talk soon,<br>The Granted Team</p>
```
</email_example>
</email_body_format>

CRITICAL: After calling save_lead_data, write a short confirmation message to the prospect: "✓ I've sent the summary to [email]. You should see it in your inbox in the next minute or two." Then END the conversation. Do NOT call any other tools or ask any follow-up questions.
</email_summary_request>
</system_message_handling>
```

---

## Why This Wasn't Working

1. **Widget was correct** — sending system message properly
2. **Backend was correct** — checking `cta_selected.includes('email')` properly
3. **Email sending code was correct** — Gmail API configured and working
4. **Agent prompt was MISSING instructions** — no guidance on how to handle system message

The agent needs to be explicitly told:
- What `[SYSTEM: User requested email summary]` means
- What to do when it receives this message (call save_lead_data with specific parameters)
- What format the email_summary_body should be in
- To end the conversation immediately after (no follow-up questions)

---

## Testing After Fix

### Test 1: Happy Path (Button Click → Email Sent)

1. Fill out lead-gen form with your email
2. Agent delivers estimate
3. Click "Send me the funding summary" button
4. **Expected Railway logs:**
   ```
   [Tool call] save_lead_data
   🔍 DEBUG: email_summary_body present: true
   🔍 DEBUG: email_summary_body size: [X] chars
   cta_selected: "email_summary"
   ✅ lead_gen_conversations updated — cta_selected: "email_summary", has_email_body: true
   📧 Checking email CTA — cta_selected: "email_summary", has_contact_email: true
   📧 Email summary requested — preparing to send via Nodemailer...
   📧 Using agent-generated email_summary_body ([X] chars)
   📧 Calling sendEmail for chris@example.com...
   ✅ Email summary sent to chris@example.com — Message ID: [ID]
   ✅ Gmail API send succeeded — Message ID: [ID]
   ```

5. **Expected result:**
   - Agent responds: "✓ I've sent the summary to chris@example.com. You should see it in your inbox in the next minute or two."
   - Email arrives within 5-10 seconds
   - Email is properly formatted with personalized content
   - Booking link is clickable (for $15K+ tiers)

### Test 2: Fallback Email (Missing email_summary_body)

If agent somehow doesn't include email_summary_body, finalization code will generate a fallback email automatically. This is OK but not ideal.

**Check logs for:**
```
⚠️  No email_summary_body from agent — generating fallback email
```

### Test 3: No Email Address (Edge Case)

If agent calls save_lead_data but contact_email is missing, email is skipped.

**Check logs for:**
```
⚠️  Cannot send email summary — no contact_email captured
```

---

## Alternative: Quick Fix Without Agent Prompt Changes

If you need emails working IMMEDIATELY without waiting for agent prompt changes to propagate, you can add a **server-side override** in `src/tools/save-lead-data.js`:

**Add after line 360 (after checking for name/email):**

```javascript
// OVERRIDE: If cta_selected is not set but this appears to be an email request, force it
// This handles cases where agent didn't recognize the system message
if (!input.cta_selected || input.cta_selected === 'none') {
  console.log(`⚠️  cta_selected is "${input.cta_selected}" — checking if this should be email_summary`);

  // Check if email_summary_body was provided (implies email intent)
  if (input.email_summary_body) {
    console.log(`✅ OVERRIDE: email_summary_body provided, forcing cta_selected='email_summary'`);
    input.cta_selected = 'email_summary';
  }
}
```

This will catch cases where agent provides email_summary_body but forgets to set cta_selected correctly.

**BUT** the proper fix is to update the agent prompt with explicit system message handling instructions.

---

## Implementation Priority

1. **IMMEDIATE (5 minutes):** Add system message handling to agent prompt
2. **TESTING (15 minutes):** Test with real form submission
3. **OPTIONAL:** Add server-side override as safety net

---

## Files to Update

1. `.claude/agents/lead-gen.md` or `.claude/agents/lead-gen-variant-b.md` (whichever is active)
   - Add `<system_message_handling>` section after `<phase_5_cta>` (line ~232)

2. **Optional safety net:** `src/tools/save-lead-data.js`
   - Add cta_selected override logic after line 360

---

## Expected Outcome

After fix:
- ✅ Agent recognizes `[SYSTEM: User requested email summary]` message
- ✅ Agent calls save_lead_data with `cta_selected: 'email_summary'`
- ✅ Agent includes personalized `email_summary_body` in HTML fragment format
- ✅ Finalization code detects `cta_selected.includes('email')` = TRUE
- ✅ Email is sent via Gmail API
- ✅ Prospect receives email within 5-10 seconds
- ✅ HubSpot note is created/updated regardless of email send success
