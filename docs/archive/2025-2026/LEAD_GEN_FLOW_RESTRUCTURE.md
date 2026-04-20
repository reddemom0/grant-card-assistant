# Lead-Gen Conversation Flow Restructure

## Problem Solved

**Before:** CTA came after 4+ strategic questions post-estimate (messages 14-18), causing drop-off.

**After:** CTA comes immediately after estimate (messages 7-9), strategic questions moved to optional post-CTA enrichment.

## Key Changes

### 1. Timing Guideline Added
- Target: Reach CTA (email offer) by message 7-9
- Added to conversation_flow intro: "Aim to reach the CTA (email offer) by message 7-9"

### 2. Phase 2 (Discovery) — Enhanced
**Changed:** Added guidance to ask for MORE detail upfront (before estimate)
- Ask about TYPE: "what kind of roles?" not just "hiring"
- Ask about TIMELINE: "when do they start?" not just "this summer"
- Combine 2-3 related questions per message naturally
- Store as you collect (annual_revenue, incorporated, employee_count, timeline, activities_discussed)

**Result:** Better discovery = more accurate estimate = more trust = higher conversion

### 3. Phase 4 — Renamed & Restructured
**Was:** `phase_4_strategic_questions` — ask 2-3 qualifying questions BEFORE offering CTA

**Now:** `phase_4_tier_recommendation_cta` — deliver estimate then IMMEDIATELY recommend tier + offer email

**Key change:** "Do NOT ask any questions between estimate and CTA"

Call save_lead_data as soon as they confirm email. Missing fields (budget_committed, is_decision_maker, prior_grant_experience, growth_plans) are fine.

### 4. Phase 5 — Renamed & Restructured
**Was:** `phase_5_cta` — service tier recommendations and email offer (after strategic questions)

**Now:** `phase_5_post_cta_enrichment` — OPTIONAL casual follow-up questions AFTER email is sent/declined

Questions moved here:
- "Have you worked with grants before, or first time?" → prior_grant_experience
- "Any other growth plans this year?" → growth_plans
- "Are you the one driving this, or loop anyone else in?" → is_decision_maker
- "Have you already budgeted for these activities?" → budget_committed

**Framing:** "While you're here..." — these are gravy. If they say "thanks, that's all", wrap up gracefully.

All answers still stored via memory_store (enriches HubSpot, doesn't change email).

## New Flow Example

```
[1-2] Opening + what brings you in
[3-5] Discovery (thorough: type, timeline, revenue, employees, activities)
[6] Estimate delivery
[7] Tier recommendation + email offer ← CTA HERE (not message 14+)
[8] Email sent
[9-11] Optional: casual follow-up questions (post-CTA enrichment)
```

## What Didn't Change
- Discovery questions (employee count, revenue, activities, timing) — still Phase 2
- Two-call search strategy
- Program name protection
- Lead scoring logic
- Email template structure and tier-specific content
- memory_store usage
- Service tier recommendations (GrantedPro, GetGranted 2.0, etc.)

## Files Modified
- `.claude/agents/lead-gen-variant-b.md` — restructured Phase 2, 4, 5

## Result
Faster path to CTA (7-9 messages vs 14-18), better discovery upfront, optional enrichment after.
