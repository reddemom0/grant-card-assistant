# Manual Testing Guide: Planned Activities Feature

## Overview
This guide covers end-to-end manual testing for the planned activities field in the lead-gen chatbot.

**Deployment:** https://grant-card-assistant-production.up.railway.app
**Test Page:** https://getgranted.ca (embedded widget)

---

## Pre-Test Setup

1. **Open Railway logs** in a separate tab to monitor backend behavior:
   ```bash
   railway logs --follow
   ```

2. **Clear browser storage** to start fresh:
   - Open DevTools → Application → Clear Storage → Clear site data

3. **Enable test mode** (optional - prevents HubSpot record creation):
   - Set `LEAD_GEN_TEST_MODE=true` in Railway environment variables

---

## Test 1: Blank Activity (Path A - No Regression)

**Goal:** Verify existing behavior still works when field is left blank

### Steps:
1. Navigate to https://getgranted.ca
2. Click "Get my funding estimate"
3. Fill Page 1:
   - Name: Test User 1
   - Email: test1@example.com
   - Company: Test Corp 1
   - Website: (leave blank)
   - Industry: Technology
4. Click "Next"
5. Fill Page 2:
   - Province: British Columbia
   - Revenue: $500K - $1M
   - Employees: 10 - 49 employees
   - Hiring: 3 – 5 people
   - Training: $10K - $25K
   - Expansion: None planned
   - **Planned Activities: (leave blank)**
6. Click "Get my estimate"

### Expected Result:
- ✓ Agent responds immediately with funding estimate (5-8 seconds)
- ✓ No clarifying questions asked
- ✓ Estimate includes hiring and training pillars
- ✓ No errors in Railway logs

### Railway Log Checks:
```
📋 Planned Activities: (should NOT appear)
Planned Activities: None specified (should appear in context injection)
```

---

## Test 2: Clear Grantable Activity (Path B)

**Goal:** Verify agent includes activity in estimate without clarification

### Steps:
1. Repeat setup (clear storage)
2. Fill form with:
   - Name: Test User 2
   - Email: test2@example.com
   - Company: Test Corp 2
   - Province: British Columbia
   - Revenue: $1M - $3M
   - Employees: 50 - 99 employees
   - Hiring: 6 – 10 people
   - Training: $25K - $50K
   - Expansion: $10K - $25K
   - **Planned Activities: "Attending a food trade show in Germany next spring"**

### Expected Result:
- ✓ Agent responds with estimate immediately (no clarification)
- ✓ Response references the trade show: "...plus the trade show in Germany you mentioned"
- ✓ Estimate includes market expansion pillar
- ✓ Total funding is higher than Test 1

### Railway Log Checks:
```
📋 Planned Activities: Attending a food trade show in Germany next spring
Planned Activities: Attending a food trade show in Germany next spring (in context)
```

---

## Test 3: Ambiguous Activity (Path C - Clarification)

**Goal:** Verify agent asks clarifying question for ambiguous terms

### Steps:
1. Repeat setup
2. Fill form with:
   - Name: Test User 3
   - Email: test3@example.com
   - Company: Test Corp 3
   - Province: Ontario
   - Revenue: $3M - $5M
   - Employees: 100 - 249 employees
   - Hiring: 11 – 20 people
   - Training: $50K+
   - Expansion: $50K+
   - **Planned Activities: "Buying new equipment and expanding our operations"**

### Expected Result:
- ✓ Agent asks ONE clarifying question before estimate
- ✓ Question format: "You mentioned buying equipment and expanding — could you tell me more about what kind of equipment and what the expansion involves?"
- ✓ After clarification, agent delivers estimate
- ✓ Agent addresses equipment honestly if non-grantable

### Railway Log Checks:
```
📋 Planned Activities: Buying new equipment and expanding our operations
activity_assessment: mixed / too_complex / not_grantable (should appear after clarification)
activity_clarification: [user's answer] (should be stored)
```

---

## Test 4: Non-Grantable Activity

**Goal:** Verify agent responds honestly about non-grantable items

### Steps:
1. Repeat setup
2. Fill form with:
   - Name: Test User 4
   - Email: test4@example.com
   - Company: Test Corp 4
   - Province: Alberta
   - Revenue: $500K - $1M
   - Employees: 10 - 49 employees
   - Hiring: 1 – 2 people
   - Training: None planned
   - Expansion: None planned
   - **Planned Activities: "Purchasing a new commercial oven and kitchen equipment"**

### Expected Result:
- ✓ Agent addresses equipment honestly: "Equipment purchases aren't typically grant-eligible, but..."
- ✓ Agent still provides estimate for other activities (hiring)
- ✓ Agent suggests loans/financing for equipment
- ✓ Response is constructive, not dismissive

### Railway Log Checks:
```
📋 Planned Activities: Purchasing a new commercial oven and kitchen equipment
activity_assessment: not_grantable (should appear)
```

---

## Test 5: Complex Activity (R&D/Innovation)

**Goal:** Verify agent uses search_lead_gen_strategy for edge cases

### Steps:
1. Repeat setup
2. Fill form with:
   - Name: Test User 5
   - Email: test5@example.com
   - Company: Test Corp 5
   - Province: British Columbia
   - Revenue: $5M - $10M
   - Employees: 250 - 499 employees
   - Hiring: 20+ people
   - Training: $50K+
   - Expansion: $50K+
   - **Planned Activities: "Developing an AI-powered predictive maintenance system for our manufacturing line"**

### Expected Result:
- ✓ Agent may ask clarifying question about R&D scope
- ✓ Agent mentions R&D/innovation funding categories
- ✓ Agent flags complexity: "Your consultant would size the exact amount"
- ✓ Recommends GrantedPro tier (due to high estimate + complexity)

### Railway Log Checks:
```
📋 Planned Activities: Developing an AI-powered predictive maintenance system...
[Tool call] search_lead_gen_strategy (should appear)
activity_assessment: too_complex / grantable (should appear)
```

---

## Test 6: Verbose Multi-Activity Input

**Goal:** Verify agent handles long detailed input gracefully

### Steps:
1. Repeat setup
2. Fill form with:
   - Name: Test User 6
   - Email: test6@example.com
   - Company: Test Corp 6
   - Province: Quebec
   - Revenue: $1M - $3M
   - Employees: 50 - 99 employees
   - Hiring: 3 – 5 people
   - Training: $25K - $50K
   - Expansion: $25K - $50K
   - **Planned Activities:** "We are planning to attend three major trade shows this year - one in Germany for food manufacturing, one in the US for retail buyers, and one in Asia for sourcing. We also want to hire 2-3 sales reps to cover new territories, send our management team through leadership training, and potentially set up a co-op program with the local college for summer students."

### Expected Result:
- ✓ Agent summarizes multiple activities in response
- ✓ Agent breaks down estimate by pillar (hiring, training, expansion)
- ✓ Agent probes for student hire details: "That co-op program you mentioned..."
- ✓ Response acknowledges multiple activities without repeating verbatim

### Railway Log Checks:
```
📋 Planned Activities: We are planning to attend three major trade shows...
(Full text should be stored, not truncated)
```

---

## Test 7: Post-Estimate Guardrail

**Goal:** Verify agent redirects after 4-5 detailed exchanges

### Steps:
1. Complete any test above to get estimate
2. Ask detailed program questions:
   - "What are the specific eligibility requirements?"
   - "What's the application deadline?"
   - "Can I stack multiple programs?"
   - "What documentation do I need?"
   - "How long does approval take?"
   - "What's the reimbursement timeline?"

### Expected Result:
- ✓ Agent answers first 4-5 questions
- ✓ After 4-5 exchanges, agent redirects:
   - "I appreciate all the questions — this tool is designed for a quick snapshot."
   - Mentions Granted Starter link
   - Mentions summary button
- ✓ Exception: Service/pricing questions are still answered

---

## Test 8: Email Summary Personalization

**Goal:** Verify email references planned activities

### Steps:
1. Complete Test 2 (clear grantable activity)
2. Click "Send me the funding summary" button
3. Wait for confirmation message
4. Check email at test2@example.com

### Expected Result:
- ✓ Email greeting uses name
- ✓ Email body references specific activity: "Based on your profile and the trade show in Germany you mentioned..."
- ✓ Email includes pillar-by-pillar breakdown
- ✓ Email includes tier recommendation + links
- ✓ Email includes booking link (for $15K+ tiers)
- ✓ Email is HTML formatted (not plain text)

### Railway Log Checks:
```
[Tool call] save_lead_data
email_summary_body: (should include trade show reference)
```

---

## Test 9: HubSpot Note Verification

**Goal:** Verify HubSpot notes include planned activities section

### Steps:
1. **Disable test mode** if enabled:
   - Remove `LEAD_GEN_TEST_MODE` from Railway environment
2. Complete Test 2 (clear grantable activity)
3. Wait for estimate delivery (Trigger A fires)
4. Open HubSpot → Contacts
5. Search for test2@example.com
6. Open contact record → Notes tab

### Expected Result:
- ✓ Note created by "Lead Gen Agent"
- ✓ Note includes section: "📋 Planned Activities (from form):"
- ✓ Section shows: "Attending a food trade show in Germany next spring"
- ✓ Section shows: "Agent Assessment: grantable - export/market expansion"
- ✓ If clarification was asked: "Clarification Q&A: [answer]"
- ✓ Section appears AFTER "Activities Discussed" and BEFORE "Funding Estimate"

### HubSpot Note Structure:
```
👤 Contact Profile
...

💼 Business Operations
...

🎯 Activities Discussed
- Hiring: 3-5 FT positions
- Training: Management courses
- Market Expansion: Trade shows

📋 Planned Activities (from form):
Attending a food trade show in Germany next spring
Agent Assessment: grantable - export/market expansion

💰 Funding Estimate
...
```

---

## Additional Manual Checks

### Textarea Behavior:
- ✓ Placeholder text is visible when empty
- ✓ Textarea expands vertically as user types
- ✓ Min height is 70px (3 rows)
- ✓ Hint text "Optional — helps us tailor your estimate" appears below field

### Form Validation:
- ✓ Field is optional - form submits without it
- ✓ No character limit (can enter long text)
- ✓ Whitespace is trimmed on submission

### Context Injection (Railway Logs):
- ✓ Search for "Planned Activities:" in logs after form submission
- ✓ Verify value appears in <lead_info> block for EVERY agent turn
- ✓ Verify null values show as "None specified", not blank

### Memory Store (PostgreSQL):
- ✓ Check conversation_memory table for keys:
  - `planned_activities` (raw text from form)
  - `activity_assessment` (grantable/not_grantable/too_complex/mixed)
  - `activity_clarification` (if clarification was asked)

---

## Success Criteria

All tests pass if:
1. ✓ Blank field doesn't break existing behavior
2. ✓ Clear activities are included in estimate without clarification
3. ✓ Ambiguous activities trigger ONE clarifying question
4. ✓ Non-grantable activities get honest responses
5. ✓ Complex activities trigger strategy search and consultant referral
6. ✓ Verbose input is summarized gracefully
7. ✓ Post-estimate guardrail redirects after 4-5 exchanges
8. ✓ Email summary references planned activities
9. ✓ HubSpot notes include planned activities section with assessment

---

## Troubleshooting

**Agent doesn't reference planned activity:**
- Check Railway logs for context injection
- Verify `planned_activities` is in <lead_info> block
- Check system prompt files are deployed

**Clarification not asked for ambiguous input:**
- Review system-operations.md Phase 1 logic
- Check if agent categorized it as clear vs ambiguous

**HubSpot note missing section:**
- Verify lead-gen-finalization.js is deployed
- Check `planned_activities` is stored in prospect_data JSONB
- Verify save_lead_data.js passes fields to buildNoteBodyComprehensive

**Email doesn't personalize:**
- Check email_summary_body generation in save_lead_data tool
- Verify system-operations.md email_generation section
- Check planned_activities is available when email is built

---

## Automated Testing

For backend API testing (form submission → storage → context injection), run:

```bash
node test-planned-activities.js
```

This script tests all 6 input scenarios and verifies:
- Form data is accepted
- Conversation is created
- Context injection appears in logs
- Agent responds appropriately

**Note:** Automated tests cannot verify UI behavior, email content, or HubSpot notes. Manual verification required for those.
