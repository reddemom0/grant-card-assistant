# save_lead_data Multiple Calls Behavior

## Question

Does `save_lead_data` UPDATE the existing HubSpot record when called a second time for the same session, or does it create a duplicate?

## Answer

**It UPDATES the database record but does NOT create duplicate HubSpot records.**

Finalization (which creates HubSpot records and sends emails) is **atomic and idempotent** — it only happens ONCE per session, regardless of how many times `save_lead_data` is called.

---

## How It Works

### Component 1: Database Update (Always Happens)

**File:** `src/tools/save-lead-data.js` lines 475-497

```javascript
await query(
  `UPDATE lead_gen_conversations
      SET contact_name      = $1,
          contact_email     = $2,
          prospect_data     = prospect_data || $3::jsonb,  // ← Merge with existing data
          matched_programs  = $4,
          estimated_funding = $5,
          cta_selected      = $6,
          updated_at        = NOW()
    WHERE session_id = $7`,
  [name, email, JSON.stringify(prospectData), ...]
);
```

**Result:** Database record is UPDATED on every call (uses `UPDATE`, not `INSERT`).

---

### Component 2: Finalization (Only Happens Once)

**File:** `src/api/lead-gen-finalization.js` lines 1154-1176

```javascript
const sessionResult = await query(
  `UPDATE lead_gen_conversations
   SET finalized = TRUE,
       finalized_at = NOW(),
       finalization_trigger = $2
   WHERE session_id = $1
     AND finalized = FALSE  // ← Key condition: only updates if not already finalized
   RETURNING *`,
  [sessionId, trigger]
);

if (sessionResult.rows.length === 0) {
  // Either session doesn't exist, or it's already finalized
  console.log(`⚠️  Session ${sessionId} already finalized`);
  return { success: false, error: 'Already finalized', alreadyFinalized: true };
}
```

**Result:** Finalization only happens if `finalized = FALSE`. Second call returns `{success: false, alreadyFinalized: true}`.

---

### Component 3: save_lead_data Return Value (Always Success)

**File:** `src/tools/save-lead-data.js` lines 517-523

```javascript
} else {
  console.warn(`⚠️  Finalization returned non-success:`, result);
  return {
    success: true,  // ← Still returns success to agent!
    message: `Lead data saved to database. HubSpot sync: ${result.error || 'unknown issue'}`,
    ...result
  };
}
```

**Result:** Even if finalization says "already finalized", `save_lead_data` still returns `success: true` to the agent.

---

## What Happens on Each Call

### First Call to save_lead_data:

1. **Database:** `UPDATE lead_gen_conversations` with new data ✅
2. **Finalization:**
   - Sets `finalized = TRUE` atomically
   - Creates/updates HubSpot Company record ✅
   - Creates/updates HubSpot Contact record ✅
   - Creates/updates HubSpot Note ✅
   - **Sends email** if `cta_selected.includes('email')` ✅
3. **Returns:** `{success: true, message: "Lead data saved and synced to HubSpot."}`

**Logs:**
```
✅ lead_gen_conversations updated — cta_selected: "email_summary", has_email_body: true
🎯 Finalizing lead-gen session [ID] (trigger: contact_captured)
🔒 Claimed session [ID] for finalization
📧 Email summary requested — preparing to send
✅ Email sent successfully — Message ID: [ID]
✅ Session finalized via contact_captured
```

---

### Second Call to save_lead_data (Same Session):

1. **Database:** `UPDATE lead_gen_conversations` with new data ✅
2. **Finalization:**
   - Checks `WHERE finalized = FALSE` → condition fails (already TRUE)
   - Returns 0 rows from UPDATE
   - Returns `{success: false, alreadyFinalized: true}` ❌
   - **Skips HubSpot creation** (already exists)
   - **Skips email sending** (finalization logic never reached)
3. **Returns:** `{success: true, message: "Lead data saved to database. HubSpot sync: Already finalized"}`

**Logs:**
```
✅ lead_gen_conversations updated — cta_selected: "email_summary", has_email_body: true
🎯 Finalizing lead-gen session [ID] (trigger: contact_captured)
⚠️  Session [ID] already finalized at [timestamp]
⚠️  Finalization returned non-success: {success: false, alreadyFinalized: true}
```

---

## Important Limitation

**If the second call includes email_summary_body but the first call didn't, the email will NOT be sent.**

### Example Scenario:

1. **First call:** Agent calls `save_lead_data` with `cta_selected='book_call'` (no email)
   - Finalization happens, HubSpot records created
   - No email sent (because cta_selected doesn't include 'email')

2. **Second call:** User clicks summary button, agent calls `save_lead_data` with `cta_selected='email_summary'` + `email_summary_body`
   - Database updates with new cta_selected and email_summary_body
   - **But finalization is skipped** (already finalized)
   - **Email is NOT sent** because email sending happens in finalization

---

## Why This Design Makes Sense

1. **Prevents duplicate HubSpot records** — finalization is atomic and idempotent
2. **Prevents duplicate emails** — email is only sent once per session
3. **Allows database updates** — prospect_data can be enriched over multiple calls
4. **Race condition safe** — atomic UPDATE...WHERE finalized=FALSE prevents concurrent finalization

---

## In Practice: Will This Be a Problem?

**No, for the normal flow:**

1. User fills out form → session created, form data stored
2. Agent greets user, has conversation
3. Agent delivers estimate
4. User clicks summary button → agent calls `save_lead_data` for the **FIRST TIME** with email_summary_body
5. Finalization happens, email sent ✅

**save_lead_data is only called ONCE in the normal flow.**

---

## Edge Case: User Changes Mind

**Scenario:**
1. Agent reaches Phase 5 naturally
2. User says "I want to book a call"
3. Agent calls `save_lead_data` with `cta_selected='book_call'` (first call)
4. User then clicks summary button
5. Agent receives `[SYSTEM: User requested email summary]`
6. Agent calls `save_lead_data` again with `cta_selected='email_summary'` (second call)
7. **Email is NOT sent** because finalization was already completed on first call

**Solution:** This is an acceptable limitation. The summary button should be hidden/disabled once a CTA has been selected. This is a UI change, not a backend change.

Alternatively, we could add special logic to detect this case and send the email outside of finalization, but that adds complexity and is probably not worth it.

---

## Server-Side Override Added

**File:** `src/tools/save-lead-data.js` lines 363-372

```javascript
// Server-side override: Force cta_selected='email_summary' if email body provided
// (Safety net for cases where agent provides email body but forgets to set CTA)

if ((!input.cta_selected || input.cta_selected === 'none') && input.email_summary_body) {
  console.log(`⚠️  OVERRIDE: cta_selected is "${input.cta_selected}" but email_summary_body is present`);
  console.log(`✅ OVERRIDE: Forcing cta_selected='email_summary' to ensure email is sent`);
  input.cta_selected = 'email_summary';
}
```

**What This Does:**
- Catches cases where agent provides `email_summary_body` but forgets to set `cta_selected`
- Forces `cta_selected='email_summary'` so the email actually gets sent
- Acts as a safety net for agent prompt failures

**Logs to Watch For:**
```
⚠️  OVERRIDE: cta_selected is "none" but email_summary_body is present (1234 chars)
✅ OVERRIDE: Forcing cta_selected='email_summary' to ensure email is sent
```

If you see this log, it means the agent forgot to set the CTA correctly, but the override caught it and fixed it automatically.

---

## Summary

✅ **Multiple calls UPDATE the database record** (prospect_data is merged)
✅ **Finalization only happens ONCE** (atomic, idempotent)
✅ **HubSpot records are NOT duplicated**
✅ **Email is only sent on FIRST call** (if cta_selected includes 'email')
⚠️ **Second call with email will NOT send email** (finalization already complete)
✅ **Server-side override catches missing cta_selected** (safety net for agent errors)

In the normal flow, `save_lead_data` is only called once, so this limitation doesn't matter.
