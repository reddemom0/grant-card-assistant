# Email Auto-Send Safety Net Fix

## Problem

**87.5% of sessions (14/16) are missing email_summary_body** because the agent isn't generating it in CALL 1. This caused:
- **9 out of 9 walk-away users** to be finalized in HubSpot but receive **zero emails**
- Only 2 sessions had agent-generated email content
- Auto-send path was completely broken for walk-away users

---

## Solution: Two-Part Fix

### FIX A: Server-Side Fallback (Primary Fix)

**File:** `src/api/lead-gen-finalization.js` (lines 1760-1826)

**Change:** Instead of skipping auto-send when email_summary_body is missing, generate a fallback email using the existing `generateFallbackEmail()` function.

**Before:**
```javascript
if (hasEmail && hasEmailBody) {
  // Send email
} else {
  if (!hasEmailBody) {
    console.log(`⚠️  No email_summary_body — skipping auto-send`);
  }
}
```

**After:**
```javascript
if (!hasEmail) {
  console.log(`⚠️  No contact_email — skipping auto-send`);
} else {
  // Generate fallback email if agent didn't provide one
  if (!hasEmailBody) {
    console.log(`⚠️  No email_summary_body from agent — generating fallback for auto-send`);
    
    const firstName = (session.contact_name || 'there').trim().split(/\s+/)[0] || 'there';
    const fallbackBody = generateFallbackEmail(
      prospectData,
      session.estimated_funding || prospectData.estimated_funding,
      firstName
    );
    
    if (fallbackBody) {
      prospectData.email_summary_body = fallbackBody;
      // Update session in database
      await query(
        `UPDATE lead_gen_conversations SET prospect_data = $1 WHERE session_id = $2`,
        [JSON.stringify(prospectData), session.session_id]
      );
      hasEmailBody = true;
    }
  }
  
  // Send email if we have a body (agent-generated or fallback)
  if (hasEmailBody) {
    const emailResult = await sendLeadGenEmail(session.session_id);
    // Handle result...
  }
}
```

**What This Does:**
1. When cron detects inactive session with contact_email
2. Checks if agent provided email_summary_body
3. **If missing:** Generates fallback using prospect_data (company, estimate, tier)
4. Updates session with generated body
5. Proceeds to send email via sendLeadGenEmail()

**Fallback Email Features:**
- Uses existing `generateFallbackEmail()` function (proven to work in session 7d4cce7b)
- Follows tier routing (Pro/Starter/GetGranted links based on estimate)
- Personalizes with first name and company name
- Includes pillar-by-pillar breakdown if data available
- Uses booking link: https://meetings.hubspot.com/natalie392/15min-intro-to-granted

---

### FIX B: Prompt Emphasis (Secondary Fix)

**File:** `.claude/skills/lead-gen-variant-b/system-operations.md` (lines 72-78)

**Change:** Made email_summary_body requirement more prominent and explicit.

**Before:**
```
CALL 1 — Immediately after delivering the estimate (first response):
- Include: lead_score, hs_lead_status, name, email, ...
- Include email_summary_body — generate it now even though it won't send yet. It's stored for the timeout trigger.
- Set cta_selected to "none"
```

**After:**
```
CALL 1 — Immediately after delivering the estimate (first response):
- Include: lead_score, hs_lead_status, name, email, ...

CRITICAL — email_summary_body is REQUIRED in this call. Generate the complete HTML 
email now, even though it won't send yet. If the prospect walks away, this is the 
ONLY email they'll receive. Follow <email_generation> rules for tier-appropriate 
content. Omitting this field means the prospect gets no funding summary — treat it 
as mandatory as the estimate itself.

- Set cta_selected to "none"
```

**What This Does:**
- Makes requirement stand out visually (separate paragraph)
- Uses "CRITICAL" and "REQUIRED" language
- Explains consequence: "the ONLY email they'll receive"
- Emphasizes importance: "treat it as mandatory as the estimate itself"

---

## Expected Impact

### Before Fix
- **Walk-away users:** 0/9 received emails (0%)
- **Button click users:** 2/2 received emails (100% via fallback)
- **Agent-generated content:** 2/16 sessions (12.5%)

### After Fix
- **Walk-away users:** 9/9 will receive emails (100% via fallback safety net)
- **Button click users:** 2/2 will receive emails (100%)
- **Agent-generated content:** Should improve with stronger prompt (target >80%)

---

## How The Safety Net Works

### Scenario 1: Agent Generates Email Body (Ideal)
1. User gets estimate
2. Agent calls save_lead_data with email_summary_body ✓
3. User walks away
4. Cron detects inactivity, finds email_summary_body ✓
5. Sends agent-generated email ✓

### Scenario 2: Agent Doesn't Generate Email Body (Fallback)
1. User gets estimate
2. Agent calls save_lead_data **without** email_summary_body ❌
3. User walks away
4. Cron detects inactivity, finds email_summary_body missing
5. **Generates fallback email** using prospect_data ✓
6. Updates session with generated body ✓
7. Sends fallback email ✓

### Scenario 3: Button Click (Works Either Way)
1. User gets estimate
2. User clicks "Send me the funding summary" button
3. sendLeadGenEmail checks for email_summary_body
4. If missing, uses fallback generator (existing behavior)
5. Sends email ✓

---

## Testing Scenarios

### Test 1: Walk-Away User (Primary Scenario)
1. Complete form, get estimate
2. Close browser without clicking button
3. Wait 5-15 minutes
4. **Expected:** Cron detects inactivity, generates fallback, sends email
5. **Verify in logs:**
   ```
   ⚠️  No email_summary_body from agent — generating fallback for auto-send
   ✅ Generated fallback email (X chars)
   ✅ Updated session with fallback email body
   📧 Auto-sending funding summary email to email@example.com (inactivity timeout)...
   📧 Auto-sent funding summary email to email@example.com (inactivity timeout)
   ```

### Test 2: Button Click (Existing Behavior)
1. Complete form, get estimate
2. Click "📧 Send me the funding summary"
3. **Expected:** Email sent immediately (via agent body or fallback)

### Test 3: Agent Compliance (Long-term Goal)
1. Complete form, get estimate
2. Check database: `prospect_data->>'email_summary_body' IS NOT NULL`
3. **Target:** >80% of sessions should have agent-generated content

---

## Rollback Plan

If the fallback generator causes issues:

**Option 1: Disable Fallback**
```javascript
// In lead-gen-finalization.js, line 1769
if (!hasEmailBody) {
  console.log(`⚠️  No email_summary_body — skipping auto-send (fallback disabled)`);
  // Skip fallback generation
}
```

**Option 2: Revert to Original**
```bash
git revert <commit-hash>
```

**Option 3: Make Fallback Optional via Feature Flag**
```javascript
const ENABLE_EMAIL_FALLBACK = process.env.ENABLE_EMAIL_FALLBACK !== 'false';
if (!hasEmailBody && ENABLE_EMAIL_FALLBACK) {
  // Generate fallback...
}
```

---

## Files Modified

1. **src/api/lead-gen-finalization.js** (lines 1760-1826)
   - Added fallback email generation in auto-send path
   - Updates session with generated body
   - Proceeds to send email after fallback generation

2. **.claude/skills/lead-gen-variant-b/system-operations.md** (lines 72-78)
   - Strengthened email_summary_body requirement language
   - Made it visually prominent (separate paragraph)
   - Emphasized criticality and consequence

---

## Success Metrics

**Week 1 Post-Deploy:**
- Track: % of sessions with agent-generated email_summary_body
- Track: % of walk-away users receiving emails
- Track: Email open rates (agent-generated vs fallback)
- Track: Fallback generation errors (should be near zero)

**Target Goals:**
- Walk-away email delivery: 100% (up from 0%)
- Agent-generated content: >80% (up from 12.5%)
- Email open rate: >25%
- Fallback generation errors: <5%

---

## Related Issues Resolved

✅ **87.5% of sessions missing email_summary_body** → Safety net ensures emails sent regardless
✅ **9/9 walk-away users got zero emails** → Fallback generator covers all walk-away scenarios
✅ **Reliance on agent prompt compliance** → Server-side safety net reduces risk
✅ **No nurture touchpoint for majority of leads** → All qualified leads now receive funding summary
