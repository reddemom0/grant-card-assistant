# Lead-Gen Agent Evolution - Summary of Changes

## What Changed

The lead-gen agent has evolved from a single-purpose "grant calculator" into a versatile **AI Grant Advisor** that serves three purposes:

1. **Grant Funding Estimator** (existing - unchanged)
2. **FAQ Responder** (new - answers questions about grants AND services)
3. **Service Tier Advisor** (new - recommends best-fit service with clear next steps)

---

## Key Behavioral Changes

### 1. Agent Identity Updated

**Before:** "AI Grant Calculator" - only estimates funding, pushes email summary CTA

**After:** "AI Grant Advisor" - estimates funding, answers FAQs, recommends service tiers with links in chat

### 2. FAQ Handling Now Active

The agent now proactively answers questions about:
- How grants work in Canada
- Granted Consulting's services (GetGranted, Starter, Pro, Export)
- GetGranted 2.0 platform features (Smart Filters, Grant Navigator, etc.)
- Pricing, timing, eligibility, process questions

After answering FAQs, the agent gently redirects back to grant estimation.

### 3. Post-Estimate Flow Changed

**OLD Flow:**
1. Deliver estimate
2. Ask strategic questions
3. Offer email summary (only CTA)
4. Service tier info ONLY in email (never in chat)

**NEW Flow:**
1. Deliver estimate
2. Ask strategic questions
3. **Recommend service tier with page link in chat** ⬅ NEW
4. Offer email summary as additional option

### 4. Service Tier Recommendations (In Chat)

Based on 12-month funding estimate:

| Estimate | Recommendation | Link Shared in Chat | Email Push |
|----------|----------------|---------------------|------------|
| **$30K+** | GrantedPro (full-service) | https://granted.ca/grantedpro/ | **Strong** (contains booking link) |
| **$10-29K** | Granted Starter | https://granted.ca/granted-starter/ + waitlist | Optional |
| **Under $10K** | GetGranted (self-serve) | https://granted.ca/getgranted/ + waitlist | Optional |
| **Pre-revenue** | Be honest, suggest waitlist | https://getgranted.ca/waitlist/ | Optional |

### 5. Link Sharing Rules

**CAN be shared in chat:**
- Service tier page links (grantedpro, granted-starter, getgranted)
- GetGranted 2.0 waitlist link (getgranted.ca/waitlist)

**NEVER shared in chat (email only):**
- Booking link (meetings.hubspot.com/natalie392/15min-intro-to-granted)

### 6. Tier-Specific Emails

Emails are now generated based on funding tier:

**High Tier ($30K+):**
- Positions GrantedPro as the smart move
- Describes what GrantedPro includes (93% rate, dedicated strategist, unlimited apps)
- Booking link as **PRIMARY CTA**
- No waitlist link (these prospects should talk to consultants, not self-serve)

**Medium Tier ($10-29K):**
- Positions Starter as the right fit
- Describes what Starter includes
- Includes GetGranted 2.0 waitlist link
- Booking link as **SECONDARY option**

**Low Tier (Under $10K):**
- Positions GetGranted as solid starting point
- Describes what GetGranted includes
- Includes GetGranted 2.0 waitlist link
- Booking link as **OPTIONAL**

---

## Files Modified

### 1. `.claude/agents/lead-gen-variant-b.md`

**Changed:**
- `<role>` section - updated agent identity and value prop
- `<phase_5_cta>` section - completely rewritten with tier-specific flow
- Added service tier recommendation rules (what to share in chat)
- Added tier-specific email generation guidelines

**Unchanged:**
- All other conversation phases (opening, discovery, value delivery, strategic questions)
- Program name protection rules
- Lead scoring logic
- Tool definitions

### 2. `src/api/lead-gen-finalization.js`

**Changed:**
- `generateFallbackEmail()` function - now creates tier-specific emails matching agent output
- Added separate email content for high/medium/low tiers
- Booking CTA positioning varies by tier (primary/secondary/optional)

**Unchanged:**
- `determineFundingTier()` function - same thresholds ($30K+, $10-29K, under $10K)
- HubSpot sync logic
- Email sending via Gmail API
- Database update logic

---

## What Wasn't Changed

✅ **Kept intact:**
- 5-phase conversation structure
- Discovery questions and qualification logic
- Two-call search strategy (active + all programs)
- Program name protection (never name specific programs)
- Lead scoring algorithm
- Memory_store and save_lead_data tool usage
- Stored information checking behavior
- Early disqualification logic
- Email summary generation format (just made it tier-aware)

---

## Testing Scenarios

### Scenario 1: FAQ Question First

**User:** "What is GetGranted 2.0?"

**Expected:**
1. Agent searches knowledge base
2. Answers question with details about GetGranted 2.0 platform
3. Mentions waitlist link: https://getgranted.ca/waitlist/
4. Redirects: "Want me to take a look at what funding might be available for your business specifically?"

### Scenario 2: High-Tier Prospect ($45K estimate)

**After estimate delivery:**
1. Agent asks strategic questions
2. Recommends GrantedPro: "Based on what you've shared, you've got enough fundable activity that our full-service team would make the most sense..."
3. Shares in chat: https://granted.ca/grantedpro/
4. Pushes email strongly: "I can also send you a personalized funding summary with everything we discussed and a link to book a call with our team — want me to send that?"
5. If yes: sends email with GrantedPro positioning + booking link as PRIMARY CTA

### Scenario 3: Medium-Tier Prospect ($18K estimate)

**After estimate delivery:**
1. Agent asks strategic questions
2. Recommends Starter: "For your situation, our Starter service is a great fit..."
3. Shares in chat: https://granted.ca/granted-starter/
4. Mentions waitlist: https://getgranted.ca/waitlist/
5. Offers email: "Want me to send you a funding summary with all the details and a link to book a call if you'd like to chat with someone on our team?"
6. If yes: sends email with Starter positioning + GetGranted 2.0 waitlist + booking link as SECONDARY option

### Scenario 4: Low-Tier Prospect ($6K estimate)

**After estimate delivery:**
1. Agent asks strategic questions
2. Recommends GetGranted: "Based on what you're working with, our GetGranted platform would be a solid starting point..."
3. Shares in chat: https://granted.ca/getgranted/
4. Mentions waitlist: https://getgranted.ca/waitlist/
5. Offers email: "I can also send you a summary with the funding breakdown and a link to book a call with our team if you want a second opinion — should I send that over?"
6. If yes: sends email with GetGranted positioning + GetGranted 2.0 waitlist + booking link as OPTIONAL

---

## Key Principles

1. **Service tier PAGE links can be shared in chat** - this is new behavior
2. **Booking link stays email-only** - this rule hasn't changed
3. **Better to start small and upgrade** - if between tiers, recommend the lower one
4. **Recommendations feel like consultant advice** - not sales pitches
5. **Email summary is now an ADDITIONAL option** - not the primary CTA (except for high tier)
6. **All tiers still get the booking link in email** - just positioned differently

---

## What This Achieves

**Before:** Agent was a black box that pushed email summary. Prospects couldn't ask service questions, had to wait for email to learn about next steps.

**After:** Agent is a helpful advisor that answers questions, provides clear next steps in chat (with links), and uses the email as an enhancement rather than the only path forward.

**Result:** More transparent, more helpful, better user experience. Prospects get immediate value (service recommendation + links) while high-value prospects are still funneled toward consultation via email.
