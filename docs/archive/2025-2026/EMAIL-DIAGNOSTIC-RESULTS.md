# Email Summary Diagnostic Results

## Database Query Results

**Queries Run:**
1. Recent sessions with email_summary_body presence (last 7 days)
2. Email generation statistics (last 7 days)
3. Finalized sessions (last 7 days)
4. Fallback: Last 10 sessions (any timeframe)

---

## Finding: Zero Data in lead_gen_conversations Table

### Results Summary
- **Total sessions (last 7 days):** 0
- **Total sessions (all time):** 0
- **Sessions with email_summary_body:** 0
- **Emails sent:** 0
- **Button clicks:** 0

### Table Status
✅ **Table EXISTS:** `lead_gen_conversations` is present in the database
✅ **Schema CORRECT:** All expected columns exist (19 columns including email fields)
❌ **Data:** Completely empty - zero rows

---

## Root Cause Analysis

### Why Is There No Data?

The `lead_gen_conversations` table exists with the correct schema but contains **zero rows**. This indicates:

**Most Likely:** The lead-gen widget is not yet deployed to production
- We're on the `railway-migration` branch
- Changes haven't been merged to `main` or deployed to production
- The widget code exists in the codebase but isn't live on https://granted.ca

**Alternative Possibilities:**
1. Widget is deployed but not embedded on any live pages
2. Widget is embedded but encountering client-side errors preventing form submission
3. API endpoint `/api/lead-gen/init` is failing to create database records

---

## What This Means for Email Reliability Investigation

**We Cannot Test Email Reliability Yet** because:
1. No production traffic to the widget
2. No real sessions to analyze
3. No data to verify whether `email_summary_body` is being generated

**Once Deployed, We Need to:**
1. Monitor first 10-20 sessions to check if `email_summary_body` is populated in CALL 1
2. Verify button click → email send flow works
3. Verify timeout → auto-send flow works
4. Check Railway cron logs for finalization activity

---

## Pre-Deployment Checklist

Before deploying lead-gen widget to production, verify:

### 1. Database Schema ✅
```
lead_gen_conversations table exists with all required columns:
- session_id (PK)
- contact_email, contact_name
- prospect_data (jsonb) - includes email_summary_body
- cta_selected
- finalized, finalized_at
- last_activity_at
```

### 2. Agent Prompt Requirements
**system-operations.md:72-76** instructs agent to:
- Call save_lead_data TWICE
- CALL 1: Include email_summary_body (generated at estimate delivery)
- CALL 2: Include cta_selected = "email_summary" (when button clicked)

**Verification Needed:**
- Test agent locally to confirm it follows this flow
- Check logs to see if email_summary_body is actually being generated

### 3. Cron Job Setup
**scripts/finalize-inactive-lead-gen.js** runs every 10 minutes
- Threshold: 5 minutes of inactivity
- Auto-sends email if email_summary_body exists

**Railway Cron:**
```
Schedule: */10 * * * * (every 10 minutes)
Command: node scripts/finalize-inactive-lead-gen.js
```

**Verification Needed:**
- Check Railway dashboard to confirm cron is scheduled
- Check logs to verify it's running (should see "🔄 Lead-Gen Inactive Session Finalization" every 10min)

### 4. Email Send Logic
**sendLeadGenEmail** (lead-gen-finalization.js:885-1013)
- Checks: email_sent_at (prevents duplicates)
- Checks: cta_selected.includes('email') OR email_summary_body exists
- Fallback: Generates email from prospect_data if no agent-generated body

**Verification Needed:**
- Test SMTP credentials are working
- Check Gmail integration for delivery success

---

## Next Steps

### Option 1: Deploy to Production and Monitor
1. Merge `railway-migration` → `main`
2. Deploy to Railway
3. Embed widget on a test page or granted.ca
4. Create 5-10 test sessions with real email addresses
5. Run diagnostic queries again to check:
   - Is email_summary_body being generated?
   - Are emails being sent on button click?
   - Are emails being sent on timeout?

### Option 2: Local/Staging Testing First
1. Run widget + API locally
2. Create test sessions using local database
3. Verify email_summary_body generation
4. Test button click path
5. Test timeout path (reduce threshold to 1 minute for testing)
6. Once verified, deploy to production

---

## Recommended Approach

**Start with Option 2 (Local Testing)** to avoid:
- Sending test emails to real prospects
- Debugging in production
- Potential data quality issues in HubSpot

**Test Checklist:**
1. ✅ Widget form submission creates session in DB
2. ✅ Agent delivers estimate and calls save_lead_data
3. ✅ email_summary_body is present in prospect_data after CALL 1
4. ✅ Button click triggers [SYSTEM: User requested email summary]
5. ✅ Agent calls save_lead_data with cta_selected = "email_summary"
6. ✅ sendLeadGenEmail() succeeds with messageId
7. ✅ Timeout cron detects inactive session
8. ✅ Auto-send email works for walk-away users

After passing all local tests → deploy to production with confidence.
