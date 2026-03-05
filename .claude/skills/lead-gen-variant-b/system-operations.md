**SCOPE:** This skill governs how the agent interacts with internal systems — search tools, HubSpot, memory_store, save_lead_data, and email generation. These rules are INTERNAL and are never visible to the prospect. Use specific, accurate data in all internal fields.

---

<search_strategy>
**CRITICAL: Industry filtering causes false negatives. NEVER use the `industries` parameter.**

When building search queries:
- Include industry keywords in the `query` text field (e.g., "hiring training real estate")
- Combine purposes + industry keywords in query text
- ALWAYS pass `industries: []` (empty array) - never populate this parameter
- The search tool will auto-broaden if you accidentally use industries and get 0 results, but avoid the round-trip

Example:
```
{
  "query": "hiring training real estate",
  "regions": ["British Columbia"],
  "purposes": ["Hiring", "Training"],
  "industries": [],
  "active_only": true,
  "limit": 15
}
```

Call search_getgranted TWICE with the same query parameters:
1. active_only=true → "available now" programs
2. active_only=false → all programs including inactive

CRITICAL: Always include the prospect's province in the search query (from <lead_info> Province field). Without province, you'll miss region-specific programs that are often the most valuable.

Classify each result from call 2:
- currently_accepting=true → already counted in call 1, skip
- currently_accepting=false + no intake_cycle or exclusion_reason contains "permanently/discontinued/ended/no longer" → DEAD, exclude
- currently_accepting=false + HAS intake_cycle → CYCLICAL, include in 12-month outlook

Use intake_cycle to inform timing (e.g. "Fall" intake + current month → opens later this year).
</search_strategy>

<infrastructure_enhanced_search>
**Infrastructure-Enhanced Search:**

The system has automated infrastructure that categorizes prospects and provides baseline funding estimates using rate tables and industry group analysis. This infrastructure runs BEFORE your search executes and stores results in conversation memory.

When building your funding estimate:
1. Check conversation memory for infrastructure-provided baseline estimates and talking points
2. Use these infrastructure-calculated numbers as your foundation — don't recalculate from scratch
3. You can adjust based on specific program details from search results, but start with infrastructure baseline
4. The infrastructure filters search results by relevance and company fit, so you'll receive pre-filtered programs

The infrastructure handles:
- Industry group classification (6 groups with different funding profiles)
- Baseline estimate calculation from rate tables
- Service tier recommendation
- Consultant assignment (for Pro tier)
- Focused search with relevance filtering

You still conduct discovery and refine the estimate based on conversation context, but use the infrastructure-provided baseline as your starting point rather than estimating from zero.
</infrastructure_enhanced_search>

<accuracy>
Only count programs you're confident match. Don't inflate — if 2 match, say 2. Don't assume eligibility. Always deliver a combined total.
Present estimates as ranges (e.g. "$15-25K") not single numbers. The range creates opportunity without overpromising.
</accuracy>

<memory_store_instructions>
After delivering the estimate, store via memory_store:
- estimated_funding → full 12-month estimate
- available_now_funding → immediate estimate
- programs_matched_count → total count
- service_tier_recommended → which tier you recommended in chat (e.g., "starter", "pro", "getgranted")

Required memory_store keys for lead-gen sessions:
- company_name
- annual_revenue
- incorporated
- timeline
- budget_committed
- is_decision_maker
- prior_grant_experience
- growth_plans
- existing_consultant
- matched_programs
- estimated_funding
- available_now_funding
- programs_matched_count
- service_tier_recommended

For matched_programs: Copy the EXACT grant_name field from each search result. Do not paraphrase, categorize, or summarize.

WRONG: "BC hiring subsidies for trades apprentices ($7K-$12K per hire)"
WRONG: "Provincial training reimbursement programs"
RIGHT: "WorkBC Wage Subsidy Program ($12K, active)"
RIGHT: "Employer Training Grant ($10K, fall intake)"

The grant_name is in every search result. Copy it exactly. The sales team needs specific program names to prepare for the consultation call.

For service_tier_recommended: Store the tier key you recommended in chat ("starter", "pro", or "getgranted"). This ensures your judgment (considering company size, complexity, etc.) is preserved in HubSpot notes, even if the funding amount alone would suggest a different tier.
</memory_store_instructions>

<save_lead_data_instructions>
**CRITICAL: You must call save_lead_data immediately after delivering the funding estimate in your first response.**

Do NOT wait for the summary button, CTA, or conversation end. The HubSpot record must be created at estimate delivery so the sales team has the lead information immediately.

When calling save_lead_data, include these fields:
- lead_score and hs_lead_status (based on signals collected)
- name
- email
- company_name
- province
- revenue
- employee_count
- company_description
- activities_discussed
- matched_programs (full list with names, amounts, active/cyclical status)
- estimated_funding_range
- prior_grant_experience
- prospect_summary (2-3 sentence summary)
- email_summary_body (personalized HTML email content — REQUIRED)
- All enrichment data collected during conversation

For matched_programs in save_lead_data: Copy the EXACT grant_name field from each search result. Do not paraphrase.

WRONG: "BC hiring subsidies for trades apprentices"
WRONG: "Provincial training reimbursement programs"
RIGHT: "WorkBC Wage Subsidy Program ($12K, active)"
RIGHT: "Employer Training Grant ($10K, fall intake)"

The HubSpot note is internal — the sales team needs specific program names to prepare for the consultation call.

CRITICAL: Once save_lead_data is called, do NOT call any other tools. Write confirmation and end.
</save_lead_data_instructions>

<lead_scoring>
Score each signal you collected:

Timeline: this quarter +2, within 6 months +1, vague/none 0
Budget: allocated +2, exploring +1, not discussed 0
Decision maker: owner/CEO +2, director/VP +1, admin 0
Growth: multiple hires/expanding +2, one-off +1, none 0
Funding potential: $30K+ = +2, $15K-$29,999 = +1, under $15K = 0
Grant experience: used grants before +1, first time 0, bad experience -1
CTA: clicked summary button +2, didn't click 0
Existing consultant: none/in-house +1, has consultant -1

Total 10+ = HOT (hs_lead_status: "New")
5-9 = WARM (hs_lead_status: "Open")
0-4 = COOL (hs_lead_status: "Unqualified")

NOTE: With the form providing revenue, employees, hiring plans, and activities upfront, you can score Funding Potential and Growth from message one. The remaining signals (timeline, budget, decision maker, grant experience, existing consultant) come from Phase 2 conversation. Score what you've collected at the time save_lead_data is triggered.
</lead_scoring>

<email_generation>
This section applies when the system requests email content for save_lead_data (triggered by the widget's summary button).

CRITICAL: Always lead with services that are currently available. GetGranted 2.0 is waitlist-only — it can only be a secondary mention, never the primary recommendation.

$30K+:
- PRIMARY: GrantedPro (https://granted.ca/grantedpro/)
- Booking link: PRIMARY (https://meetings.hubspot.com/natalie392/15min-intro-to-granted)
- GetGranted 2.0: Do NOT mention (these prospects need consultant, not self-serve)

$15K-$29,999:
- PRIMARY: Granted Starter (https://granted.ca/granted-starter/) — available now
- SECONDARY: Optional mention of GetGranted 2.0 waitlist (https://getgranted.ca/waitlist/)
- Booking link: SECONDARY (https://meetings.hubspot.com/natalie392/15min-intro-to-granted) — include after Starter recommendation

Under $15K:
- PRIMARY: GetGranted database (https://granted.ca/getgranted/) — available now
- SECONDARY: Optional mention of GetGranted 2.0 Lite waitlist (https://getgranted.ca/waitlist/)
- Booking link: Do NOT include (direct them to GetGranted platform only)

All emails: greeting, recap, pillar-by-pillar funding breakdown (matching what was shown in chat), tier + links, booking link (for $15K+ tiers only), sign-off. HTML. 200-300 words.

CRITICAL EMAIL FORMAT: The email_summary_body must be HTML FRAGMENTS ONLY (like <p>, <a>, <strong>), NOT a complete HTML document. Do NOT include <html>, <head>, <body>, or <!DOCTYPE> tags. Just provide the inner content.
</email_generation>

<tier_routing_internal>
Service tier thresholds (for save_lead_data and internal scoring):
- $30K+: GrantedPro
- $15K-$29,999: Granted Starter
- Under $15K: GetGranted

Use these thresholds when determining lead_score, hs_lead_status, and email content tier recommendations.
</tier_routing_internal>
