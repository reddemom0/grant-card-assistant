# Granted AI — HubSpot Deal Creation Skill

This document teaches you how to create HubSpot deals on behalf of the Granted team. It covers the full path: recognizing when to create a deal, gathering the right information, resolving associations, confirming with the user, and handling errors.

This is NOT a general HubSpot skill — that's intentional. Reading deals, searching contacts, and fetching files are already handled by existing tools and don't need procedural guidance. Creating deals is different: it's a write operation on a CRM that the whole team depends on, so the cost of getting it wrong is high and the rules are complex enough to warrant a dedicated skill.

## Maintenance Guide

This is a living document. As the Granted team's HubSpot configuration evolves (new pipelines, new stages, new required fields, new deal types), update the relevant sections below rather than adding standalone notes at the bottom.

**What belongs here (add it):**
- New pipelines or deal stages as Granted expands service tiers (→ Section 4)
- New required-field rules as HubSpot form configuration changes (→ Section 4)
- New confirmation patterns or edge cases observed in production use (→ Section 5)
- New error patterns and how to handle them (→ Section 7)
- New examples of good deal-creation interactions (→ Section 8)

**What does NOT belong here (put it elsewhere):**
- Deal reading/searching guidance → lives in existing tool definitions, no skill needed
- General HubSpot concepts (what's a pipeline, what's an association) → HubSpot's own docs
- Program eligibility or strategic advice on which program to apply for → strategic consulting skill
- Company-level data cleanup or deduplication rules → lives in existing tools

**Source tracking:** v1.0 is built from (a) direct inspection of the HubSpot Create Deal form including all conditional properties across every pipeline, (b) a ground-truth schema dump of all 969 HubSpot deal properties and 18 pipelines via the `/crm/v3/properties/deals` and `/crm/v3/pipelines/deals` endpoints (output: `scripts/output/hubspot-schema-raw.json` + `scripts/output/hubspot-schema-summary.md`), (c) the existing `src/tools/hubspot.js` field configurations, (d) the WorkBC Complete Process document, and (e) a capability inventory of the grant-card-assistant codebase.

---

## 0. CRITICAL — Read this first

These rules override anything else in this document. If any other section appears to contradict these rules, these rules win. Read this section every time you load this skill.

### 0.1 Never simulate a tool call

If you are about to write "Deal created successfully" or "I've created the deal" or any equivalent confirmation, you MUST have just called the `create_hubspot_deal` tool in the same turn and received its return value. There is no other path that produces a real deal.

If you respond with a success message without calling the tool:
- The deal does NOT exist in HubSpot.
- You have lied to the user.
- The user will trust your response, click on the fake link, and discover the failure later — possibly long after the moment when it could have been corrected.

This is the single highest-stakes behavior in this skill. There is no acceptable scenario in which you generate a deal-creation success message that is not grounded in an actual `create_hubspot_deal` tool result. Not "I'm helping the conversation flow." Not "the payload was approved so I'm confirming." Not "I'm summarizing what we agreed to." None of those are valid reasons to generate a fake success.

The same rule applies to every write tool: `update_hubspot_deal`, `create_hubspot_company`, `create_hubspot_contact`, `update_hubspot_company`, `update_hubspot_contact`, `associate_contact_with_company`. If you say it happened, it must have happened via an actual tool call you made on the same turn.

### 0.2 Never invent numeric values

If a payload requires a numeric field (Hourly Wage, Hours per Week, Client Reimbursement, Tuition Fee per person, Amount, Service Fee, etc.) and the user has not provided that number, you MUST ask the user for it. Do not:

- Estimate based on "similar deals" you've seen.
- Calculate a wage subsidy schedule, tuition allocation, or any program-specific funding math unless the user explicitly asked you to do that calculation.
- Use a "reasonable default" you invented.
- Pull a number from memory of past conversations.

If you don't have the number, ask. "What's the approved funding amount?" is always an acceptable response. Confabulating a number that lands in a CRM is not.

### 0.3 Service tier is Step 0 of every deal-creation conversation

Before you ask any other question, before you search for the company, before you load any field requirements — establish whether the client is on the Granted Starter service tier or the main Granted Consulting tier. This determines which pipeline the deal lives in, which determines which fields are required, which determines what you ask the user.

If the user does not state the service tier in their initial request, your first response must be a clarifying question: "Is [Company] a Granted Starter client or a main-tier client?" Don't proceed without the answer.

The skill's later sections describe pipeline routing in detail (Section 3). But the routing decision starts here, not later.

---

## 1. When to create a deal

You create a HubSpot deal when a Granted team member asks you to, in either of two modes:

### Mode A — Conversational creation

The team member describes a single deal in chat. Examples of triggers:

- "Create a deal for [Company Name]'s ETG application."
- "Add this WorkBC hire to HubSpot — candidate is [Name], starts [Date]."
- "Can you set up a new CanExport lead for [Company]?"
- "I just got off a call with [Company], they're moving forward with ETG training. Create the deal."

In Mode A, you are the interviewer. The team member has most of the information in their head or in the call notes. Your job is to elicit what's needed, confirm what you've gathered, and fire the create only after the team member explicitly approves the payload.

### Mode B — Batch creation from a spreadsheet

The team member uploads an Excel or CSV file and asks you to create deals for each row. Examples:

- "Here's a sheet of 14 new hires — create all of them as WorkBC deals."
- "Pull the new CanExport leads out of this file and add them to HubSpot."

In Mode B, the spreadsheet is the source of truth, not the conversation. Your job is to parse the sheet, map columns to HubSpot properties, show a **dry-run preview** of every row you're about to create (including validation errors), and fire the batch only after the team member approves. Never create in batch without the preview.

### When NOT to create a deal

- When the team member is asking a hypothetical ("could we create a deal for…"). Answer the question, don't create.
- When the team member is discussing strategy for an existing deal. Find and open the existing deal instead (use `search_grant_applications`).
- When key required fields are missing and the team member is actively in a call — offer to create the shell now and update later, but default to waiting until you have enough to create cleanly.
- When you're not sure which pipeline the deal belongs in. Ask. Don't guess.
- **When the team member has not explicitly confirmed the final payload.** Always get a "yes, create it" before calling the write tool.

---

## 2. The three dimensions that decide every deal

Before you can create a deal, you need to resolve three independent dimensions. This is how HubSpot's Create Deal form actually works, and it's how you should think about gathering information.

1. **Pipeline** — which grant family or service tier the deal belongs to. Every deal lives in exactly one pipeline.
2. **Deal Stage** — where in the pipeline the deal currently sits. For a newly created deal, this is always the designated "create stage" in the chosen pipeline.
3. **Deal Type** — a cross-cutting attribute (`Hiring`, `Training`, `Market Expansion`, `Misc`, `Granted Starter`) that layers additional required fields on top of whatever the stage already requires.

The final set of required fields for a new deal = **always-visible fields + stage conditional + deal_type conditional**.

---

## 3. Pipelines — the full in-scope + out-of-scope list

HubSpot has 18 total deal pipelines. Only 6 are valid targets for you to create deals into. The rest either belong to other workflows or aren't grant-application deals.

### 3.1 In-scope: the 6 pipelines you can create into

| Pipeline | Pipeline ID | Create Stage | Stage ID |
|---|---|---|---|
| Hiring Grants Pipeline | `2662913` | `Hiring Pending Submission` | `9371216` |
| Training Grants Pipeline | `2662912` | `Training Pending Submission` | `9371206` |
| Market Expansion Pipeline | `10188292` | `Market Expansion Lead` | `32843614` |
| Misc. Grant Pipeline | `26501516` | `Misc Pending Submission` | `60521258` |
| Granted Starter Hiring Grants Pipeline | `48715861` | `Pre-Submission Check - Starter Hiring` | `100592664` |
| Granted Starter Training Grants Pipeline | `48715862` | `Pending Submission - Starter Training` | `100592671` |

**How to choose the right pipeline (in this exact order):**

**First — service tier (per Section 0.3, this is non-negotiable):**

Granted Starter → one of the two Starter pipelines below.
Main tier (GrantedPro, regular Granted clients, anything not Starter) → one of the four main pipelines below.

If service tier is not yet established, STOP. Ask the user before proceeding.

**Second — grant family:**

| What the deal funds | Service tier | Pipeline |
|---|---|---|
| Hiring (wage subsidy, student hiring) | Starter | Granted Starter Hiring Grants Pipeline |
| Hiring | Main | Hiring Grants Pipeline |
| Training (ETG, certifications, etc.) | Starter | Granted Starter Training Grants Pipeline |
| Training | Main | Training Grants Pipeline |
| Export / market expansion (CanExport, etc.) | Main only | Market Expansion Pipeline |
| Anything that doesn't fit above | Main only | Misc. Grant Pipeline |

If the user says "Granted Starter" + "export" or "Granted Starter" + "Misc," that's a contradiction — Starter only has Hiring and Training pipelines. Stop and clarify with the user.

**Common confusion to avoid:** "Granted Starter Pipeline" (ID `145351009`) is a SUBSCRIPTION lifecycle pipeline, not a grant-deals pipeline. Do not create grant deals there. The two grant-deal Starter pipelines are "Granted Starter Hiring Grants Pipeline" and "Granted Starter Training Grants Pipeline" — note the words "Hiring Grants" and "Training Grants" in the names.

If you genuinely can't tell which pipeline applies, ASK. Never guess at pipeline.

### 3.2 Out-of-scope pipelines — NEVER create into these

| Pipeline | Why it's out of scope |
|---|---|
| Pro Onboarding Pipeline (`10194047`) | GrantedPro client onboarding, not grant applications |
| Review Required (`9903282`) | Internal review queue |
| Lost/Abandoned/Suspended (`11205220`) | Terminal states only |
| Completed Deals (`11191120`) | Terminal states only |
| Grant Research (`11211957`) | Internal research workflow |
| Grant Calculator - Post Submission (`20749963`) | Owned by the lead-gen calculator flow |
| Whitelabel Pipeline (`22596179`) | Whitelabel partner workflow |
| Mock Applications (`80498226`) | Testing/training environment |
| Partnership Pipeline (`131317000`) | Partner business development |
| Granted Starter Pipeline (`145351009`) | Starter subscription lifecycle, NOT grant deals — despite the similar name, this is separate from the two Starter Grant pipelines above |
| Affiliate Pipeline (`159464062`) | Affiliate program |
| Quarterly Check Ins (`652897408`) | Internal check-in workflow |

If someone asks you to create a deal in one of these, stop and clarify what they actually want.

### 3.3 Later-stage reference (for editing existing deals)

All stages in each in-scope pipeline, for future reference when you're asked to update or progress existing deals (not to create into):

**Hiring Grants Pipeline stages:**
`Hiring Review` (`29029186`), `Hiring Leads` (`9371215`), `Hiring Pending Submission` (`9371216`) 🆕, `Hiring Submitted` (`9371217`), `Hiring Submitted No Candidate ID'ed` (`1113863825`), `Hiring Waitlist` (`33471313`), `Hiring PIF/FA Stage` (`9371218`), `Hiring PIF Waitlist` (`82783498`), `Hiring One Claim` (`9371219`), `Hiring Twice Claim` (`1021956245`), `Hiring Multiple - Set by Program` (`1021956246`), `Hiring Monthly Claim` (`1021956247`), `Hiring No Claim` (`1021956248`), `Hiring End Date Passed` (`36001443`), `Hiring Waiting for Funds` (`54951551`).

**Training Grants Pipeline stages:**
`Training Review` (`29035829`), `Training Leads` (`9371205`), `Training Pending Submission` (`9371206`) 🆕, `Training Submitted` (`9371207`), `Training Pending Claim Open` (`9371209`), `Training Open Claims` (`9371208`), `Training Claims Checker` (`9371210`), `Training Claim Returned` (`9371211`), `Training Completion Report Pending` (`89660934`), `Training Completion Report Open` (`9371214`), `Training Waiting for Funds` (`60065039`).

**Market Expansion Pipeline stages:**
`Market Expansion Review` (`29453671`), `Market Expansion Lead` (`32843614`) 🆕, `Market Expansion Pending Writer Pick Up` (`38886834`), `Market Expansion In Draft with Writer` (`81542534`), `Market Expansion Draft with Client` (`81542535`), `Market Expansion Submitted` (`32843617`), `Market Expansion Claim 1` (`32843618`), `Market Expansion Claim 2` (`1089132035`), `Market Expansion Claim 3` (`1089132036`), `Market Expansion Claim 4` (`1089132037`), `Market Expansion Reporting` (`958754404`), `Market Expansion Waiting for the Funds` (`1167644956`).

**Misc. Grant Pipeline stages:**
`Misc Pending Submission` (`60521258`) 🆕, `Misc Submitted` (`60521259`), `Misc Claims` (`60521260`), `Misc Received the funds` (`60521261`).

**Granted Starter Hiring Grants Pipeline stages:**
`Review - Starter Hiring` (`100592661`), `Quote - Starter Hiring` (`100592663`), `Pre-Submission Check - Starter Hiring` (`100592664`) 🆕, `Submitted - Starter Hiring` (`100592665`), `Waitlist - Starter Hiring` (`100592666`), `Approved, PIF/FA - Starter Hiring` (`100592667`), `One Off Claim - Starter Hiring` (`100554589`), `Monthly Claim - Starter Hiring` (`128251235`), `Twice Claim - Starter Hiring` (`266737454`), `Multiple Claim, Set by Program - Starter Hiring` (`266737455`), `Waiting for Funds - Starter Hiring` (`100554591`), `End Date Passed - Starter Hiring` (`100554590`).

**Granted Starter Training Grants Pipeline stages:**
`Review - Starter Training` (`100592668`), `Quote - Starter Training` (`100592670`), `Pending Submission - Starter Training` (`100592671`) 🆕, `Submitted - Starter Training` (`100592672`), `Approved - Starter Training` (`179017013`), `Open Claims - Starter Training` (`100592673`), `Claims Checker - Starter Training` (`100592674`), `Claim Returned - Starter Training` (`101464836`), `Completion Report Pending - Starter Training` (`101464839`), `Completion Report Open - Starter Training` (`101464837`), `Waiting for Funds - Starter Training` (`101464838`).

---

## 4. Associations — deals don't live alone

A HubSpot deal is not a standalone record. It MUST be linked to a Company, and should almost always be linked to at least one Contact. These are separate API calls, not fields on the deal itself.

### 4.1 Company association (REQUIRED)

Every deal needs exactly one Company marked as the `Primary` association.

**How to resolve the Company:**

1. Use `search_hubspot_companies` to look up the company by name.
2. If exactly one match is found → use that company's ID.
3. If multiple matches are found → show the team member the list and ask which one. Do NOT guess. A wrong company association is extremely hard to unwind.
4. If no match is found → ask the team member whether to create the company. If yes, use `create_hubspot_company` with at minimum `name` (and ideally `domain` if known). Then use the new company's ID for the association.

**Never create a deal without a company association.** If for some reason you can't resolve a company, stop and explain the blocker.

### 4.2 Contact association (STRONGLY RECOMMENDED)

The Contact association is technically optional on the form, but in practice every grant deal should have at least one contact — the primary point of contact for the application.

**How to resolve the Contact:**

1. Use `search_hubspot_contacts` or `get_contact_by_email` to look up the contact.
2. If found → use that contact's ID.
3. If not found → offer to create the contact via `create_hubspot_contact` with at minimum email, first name, and last name. Use the company association from step 4.1 as the contact's associated company.
4. Associate the contact to the deal when creating the deal.

In Mode B (batch), each row should have at least `Company Name` and `Primary Contact Email`. If a row is missing contact info, create the deal with just the company association and flag the missing contact in the dry-run preview.

### 4.3 Line items

Ignore. Not used for grant deals in practice.

---

## 5. The required-field matrix

This is the ground-truth list of what HubSpot's Create Deal form requires, by pipeline + stage + deal type. When you're gathering information from the team member, walk through these in order.

HubSpot does NOT expose a "required" flag on properties via its API. Required fields are enforced at the form/pipeline configuration level, which is what the matrix below captures.

### 5.1 Always required on every deal

| Display Label | API Name | Type | Notes |
|---|---|---|---|
| Deal name | `dealname` | string | Convention: `{Company} - {Program} - {Year}`. Confirm with team member if unclear. |
| Pipeline | `pipeline` | enum | Use the Pipeline ID from Section 3.1. |
| Deal Stage | `dealstage` | enum | Use the Stage ID from Section 3.1 for the chosen pipeline's create stage. |
| Deal Type | `dealtype` | enum | See Section 5.5 for valid values and how they map to pipelines. |
| Grant Type | `grant_type` | enum | 180 possible values — see Section 6.1 for the common ones. Double-required on the form (marked with `**`). |

### 5.2 Required by the create stage (varies by pipeline)

Gather these in addition to the Section 5.1 fields. This is the minimum set to get the deal into its create stage without HubSpot rejecting the write.

#### Hiring Grants Pipeline → `Hiring Pending Submission`

| Display Label | API Name | Type |
|---|---|---|
| Grant Coordinator | `grant_coordinator` | user ID (resolve via `list_hubspot_owners`) |
| Grant Type | `grant_type` | enum |
| Amount | `amount` | number |
| Client Reimbursement | `client_reimbursement` | currency/number |
| Start Date | `start_date` | date (ISO 8601) |
| End Date | `end_date` | date (ISO 8601) |
| Candidate - Name, Job Title & Email | `participant_name` | string |
| Grant Reliant | `grant_reliant` | enum (`Yes`/`No`) |

⚠️ **The API name for Candidate is `participant_name`, not `candidate_name_job_title_email`.** This is a legacy naming inconsistency — the HubSpot label was changed at some point but the internal name wasn't. Getting this wrong silently fails every Hiring and Training deal.

#### Training Grants Pipeline → `Training Pending Submission`

| Display Label | API Name | Type |
|---|---|---|
| Grant Coordinator | `grant_coordinator` | user ID |
| Grant Type | `grant_type` | enum |
| Amount | `amount` | number |
| Client Reimbursement | `client_reimbursement` | currency/number |
| Start Date | `start_date` | date |
| End Date | `end_date` | date |
| Training course name | `training_course_name` | string |
| TP Company | `tp_company` | string |
| Candidate - Name, Job Title & Email | `participant_name` | string |
| Tuition Fee per person | `tuition_fee_per_person` | currency/number |
| Grant Reliant | `grant_reliant` | enum (`Yes`/`No`) |

#### Market Expansion Pipeline → `Market Expansion Lead`

| Display Label | API Name | Type |
|---|---|---|
| Grant Type | `grant_type` | enum |
| RA Complete | `ra_complete` | boolean (`true`/`false`) |

⚠️ Notably lightweight — most Market Expansion detail gets added as the deal progresses through stages. If the team member wants more fields set at creation, they'll tell you.

#### Misc. Grant Pipeline → `Misc Pending Submission`

| Display Label | API Name | Type |
|---|---|---|
| Client Reimbursement | `client_reimbursement` | currency/number |
| End Date | `end_date` | date |
| Grant Type | `grant_type` | enum |
| Start Date | `start_date` | date |
| Deal Name | `dealname` | string |
| Deal Type | `dealtype` | enum |

Note: `Create date` is auto-set by HubSpot. Don't try to populate it.

#### Granted Starter Hiring → `Pre-Submission Check - Starter Hiring`

| Display Label | API Name | Type |
|---|---|---|
| Grant Type | `grant_type` | enum |
| Grant Coordinator | `grant_coordinator` | user ID |
| State | `state` | enum (see Section 6.3) |
| Client Reimbursement | `client_reimbursement` | currency/number |
| Actual Reimbursement (GG) | `actual_reimbursement` | **string** (see note below) |
| Start Date | `start_date` | date |
| End Date | `end_date` | date |
| Candidate - Name, Job Title & Email | `participant_name` | string |
| Grant Reliant | `grant_reliant` | enum (`Yes`/`No`) |
| WorkBC Location | `workbc_location` | enum (see Section 6.5) |

⚠️ **`actual_reimbursement` is type `string`, not number.** Known HubSpot data quality quirk — this field was configured as text, not currency. Pass the value as a string (e.g., `"15000"` not `15000`). The field label is `Actual Reimbursement (GG)` but the API name is just `actual_reimbursement` — same field as the existing read configs.

#### Granted Starter Training → `Pending Submission - Starter Training`

| Display Label | API Name | Type |
|---|---|---|
| Grant Type | `grant_type` | enum |
| Grant Coordinator | `grant_coordinator` | user ID |
| State | `state` | enum |
| Actual Reimbursement (GG) | `actual_reimbursement` | **string** |
| Client Reimbursement | `client_reimbursement` | currency/number |
| Start Date | `start_date` | date |
| End Date | `end_date` | date |
| Candidate - Name, Job Title & Email | `participant_name` | string |
| Grant Reliant | `grant_reliant` | enum (`Yes`/`No`) |
| Training course name | `training_course_name` | string |
| TP Company | `tp_company` | string |
| TP Address | `tp_address` | string |
| TP Paying | `tp_paying` | boolean (`true`/`false`) |
| Tuition Fee per person | `tuition_fee_per_person` | currency/number |

### 5.3 Required by deal type (layered on top of Section 5.2)

**If `dealtype = Hiring`:**

| Display Label | API Name | Type | Notes |
|---|---|---|---|
| Candidate - Name, Job Title & Email | `participant_name` | string | Name alone is acceptable at creation; Olivia cleans up title and email later |
| Hourly Wage | `hourly_wage` | number | Numeric, no `$` or commas |
| Hours per week | `hours_per_week` | number | Numeric |
| Vacay % | `vacation` | **enum** | ⚠️ NOT a free number. Valid values: `4%`, `5%`, `6%`, `7%`, `8%`, `9%`, `10%` (strings with % sign). Default is `4%`. |

⚠️ **Naming trap:** there are TWO similarly-named fields with swapped labels and API names:
- `Vacay %` (display) → `vacation` (API) — enum of percentages, used here
- `Vacation` (display) → `vacay` (API) — enum of `Accrued` / `Paid Out`, used elsewhere

Do not confuse these. The Hiring deal type requires `vacation` (the percentage enum), not `vacay`.

**If `dealtype = Training`:**

| Display Label | API Name | Type |
|---|---|---|
| Training course name | `training_course_name` | string |
| TP Company | `tp_company` | string |
| Tuition Fee per person | `tuition_fee_per_person` | currency/number |
| Training Link URL | `training_link_url` | URL string |
| TP Address | `tp_address` | string |
| Grant Reliant | `grant_reliant` | enum (`Yes`/`No`) |

**Deal types without observed conditionals:** `Market Expansion`, `Misc`, `Granted Starter`. These rely entirely on stage-level conditionals. If a team member uses one of these deal types, gather only the stage's required fields from Section 5.2 and flag that you may be missing additional fields if HubSpot later complains.

### 5.4 Fields to NEVER set at creation

These are populated later by workflows, claims processing, or the grant coordinator. Leave them blank on any new deal in the standard pipelines.

`claim_1_due`, `claim_1_submitted`, `claim_2_due`, `claim_2_submitted`, `claim_3_due`, `claim_3_submitted`, `claim_4_due`, `claim_4_submitted`, `claimed_so_far`, `final_claim_submitted`, `final_report_submitted`, `claim_returned_`, `claim_approved`, `claim_type`, `next_claim_due`, `completion_report_required`, `approved_on`, `application_submitted_on`, `ref__`, `invoice_sent_date`, `invoice_due`, `retainer_date_sent`, `retainer_date_paid`, `writer_draft_review_completion_date`, `waitlisted_`, `ghost_stage_`, `enrol_in_claims_emails`, `pif_x_x`, `granted_starter___reminder_type`, `granted_starter___required_docs`.

Also never set: `createdate`, `closedate` (unless specifically requested), `hs_lastmodifieddate`, any `hs_*` system field — HubSpot manages these automatically.

**Exception:** `actual_reimbursement` is on this list for standard pipelines but is REQUIRED at creation for the two Granted Starter pipelines (as "Actual Reimbursement (GG)"). Respect the pipeline-specific rule.

### 5.4.1 Fields to NEVER fabricate, calculate, or estimate

This is different from "fields to never set." These are fields you might be tempted to populate with a value you computed yourself. Don't.

For each of the following, you must use the value the user provides. If the user has not provided one, ASK. Never compute, estimate, or pull from "similar deals."

- **`amount`** — Total deal amount. The user provides this number. You do not derive it.
- **`client_reimbursement`** — Approved funding from the grant program. The user provides this. You do not calculate it from a wage × hours × subsidy-percentage formula, even if you know the formula.
- **`actual_reimbursement`** — Same rule. User provides.
- **`tuition_fee_per_person`** — User provides.
- **`hourly_wage`** — User provides.
- **`hours_per_week`** — User provides.
- **`service_fee`** — Granted's internal service fee charged to the client. The user provides this; if they don't, leave it blank (it's not required at creation). Do not "estimate based on similar deals" — that phrase is a red flag in your own response and means you're about to confabulate.

The reason: numbers that go into a CRM become the basis for invoicing, reporting, claims, and audit trails. A confabulated number does not become correct just because it looks reasonable. If you don't know the number, ask.

If you find yourself reasoning like "the standard WorkBC subsidy is 75% for the first 8 weeks…" and using that to compute `client_reimbursement`, STOP. That's strategic consulting work, not deal-creation work. Ask the user for the number instead. The user knows the approved funding amount or can look it up; you cannot derive it correctly from first principles.

### 5.5 Deal Type enum values

Valid values for the `dealtype` property (confirmed from schema dump):

| Deal Type value | Use for | Notes |
|---|---|---|
| `Hiring` | Hiring grant applications | Triggers Section 5.3 Hiring conditional |
| `Training` | Training grant applications | Triggers Section 5.3 Training conditional |
| `Market Expansion` | Market expansion / export applications | No observed conditional; rely on stage requirements |
| `Misc` | Non-standard programs | No observed conditional |
| `Granted Starter` | Starter-tier deals (alternative to Hiring/Training for Starter pipelines) | Confirm with team member — they may want `Hiring` or `Training` for Starter deals instead |
| `Annual Fee`, `App`, `App + RFF`, `App + RRF`, `Deposit`, `Placeholder`, `Repeat`, `RRF`, `Whitelabel`, `Writing Retainer Fee`, `Partnership - Portal`, `Partnership - Pro`, `Not a Fit` | ❌ Don't use for grant application deals | These exist for other workflows; do not select any of them when creating a standard grant application. |

### 5.6 Deal owner and Grant Coordinator — session defaults

The `Deal Owner` (`hubspot_owner_id`) and `Grant Coordinator` (`grant_coordinator`) fields normally auto-fill to the logged-in user when a human creates a deal. Since you're not a user, you need to handle these differently:

1. **At the start of a deal-creation session (Mode A) or batch (Mode B)**, ask the team member who should be the default Deal Owner and Grant Coordinator for this session. Example: "Who should I set as Deal Owner and Grant Coordinator for these deals?"
2. Both resolve to HubSpot user IDs. Use `list_hubspot_owners` to look up the user ID from the name or email the team member provides.
3. Apply those defaults to every deal created in the session unless the team member overrides for a specific deal.
4. In Mode B, allow per-row overrides via optional `Deal Owner` and `Grant Coordinator` spreadsheet columns.

If the team member doesn't specify, ask once and don't guess.

Note: `External Writer Assigned` is a different pattern — it's a dropdown of names (not a user ID), so you pass the name string directly. Valid values include: `Ivana Jazic`, `Chris Small`, `Kylie Gibbard`, `Teodora Rawsthorne Eckmyn`, `Frank Onuh`, `Diya Courty-Stephens`, `Granted Team`. External writer is typically set later, not at creation.

### 5.7 Pre-submission checklist — run this before emitting any payload

Before you write the payload preview that you'll show the user for confirmation, verify each of the following. If any check fails, fix the issue before showing the payload.

**Check 1 — API names, not display labels.** Every key in your `properties` object is a HubSpot API name (lowercase, snake_case), not a display label. Examples of correct keys: `dealname`, `dealstage`, `pipeline`, `participant_name`, `workbc_location`, `vacation`, `vacay`. Examples of WRONG keys you might be tempted to use: `Deal Name`, `Candidate - Name, Job Title & Email`, `WorkBC Location`, `vacation_percentage`.

**Check 2 — Candidate field uses `participant_name`, NOT `candidate_name_job_title_email`.** The latter is the display label; the former is the API name. The display label was renamed at some point but the API name was not. If you write `candidate_name_job_title_email` into the payload, the write will silently fail with "property does not exist."

**Check 3 — Vacation fields are NOT swapped.** This is the most common trap in the entire skill.
- `vacation` → enum of percentages: `4%`, `5%`, `6%`, `7%`, `8%`, `9%`, `10%` (strings WITH the % sign). This is the field labeled "Vacay %" in HubSpot.
- `vacay` → enum of method: `Accrued` or `Paid Out`. This is the field labeled "Vacation" in HubSpot.

The label-to-API-name mapping is intentionally counterintuitive. Verify both fields if the deal is a Hiring deal. There is no field called `vacation_percentage` — if you wrote that, fix it.

**Check 4 — Numeric fields are unquoted numbers, not strings.** `hourly_wage`, `hours_per_week`, and `amount` are typed as `number` in HubSpot. Pass them as `22`, not `"22"`. The exception is `actual_reimbursement` which IS typed as string in HubSpot — pass that one quoted.

**Check 5 — Pipeline ID and Deal Stage ID are strings of digits, not labels.** `pipeline: "48715861"` and `dealstage: "100592664"`, never `pipeline: "Granted Starter Hiring"` or `dealstage: "Pre-Submission Check"`. The Oracle that doesn't follow this rule will see a HubSpot validation error.

**Check 6 — Enum values match exactly.** `grant_type: "WorkBC"` (capitalization matters). `state: "Open"` (not "open"). `workbc_location: "Delta 88th"` (not "Delta" — that's a different office). If you're unsure of an exact enum value, refer to Section 6 or `scripts/output/hubspot-schema-summary.md` rather than guessing.

**Check 7 — User IDs resolved before payload, not in payload.** If the payload includes `grant_coordinator` or `hubspot_owner_id`, those values must be HubSpot user IDs (numeric strings) that you obtained by calling `list_hubspot_owners` and matching by name. Never use a name as the value. Never put `[OLIVIA_USER_ID]` placeholder text in the payload — call `list_hubspot_owners` first, then use the actual ID.

**Check 8 — All required fields for this pipeline + stage + deal type are present.** Re-read Section 5.2 for the chosen pipeline. Re-read Section 5.3 for the deal type. Verify every field on those lists is in your payload.

**Check 9 — No fabricated numeric values.** Per Section 5.4.1: every numeric field in your payload was provided by the user, not computed, estimated, or pulled from similar deals.

If all 9 checks pass, you may emit the payload preview for user confirmation. If any check fails, fix it first.

---

## 6. Enum value reference

This section lists the accepted values for the most important dropdown fields. Pass these values exactly as shown — case-sensitive, punctuation-sensitive, whitespace-sensitive. If you need a value not listed here, read `scripts/output/hubspot-schema-summary.md` for the full reference.

### 6.1 Grant Type (`grant_type`)

HubSpot has 180 Grant Type values. The ones most commonly used for create operations include (display label → internal value):

| Display Label | Internal Value |
|---|---|
| CanExport - SME | `CanExport` |
| CanExport - Innovation | `CanEx Innovate` |
| ETG - BC | `ETG - BC` |
| WorkBC | `WorkBC` |
| BCAFE | `BC MDP` |
| Buy BC Partnership Program | `BC Buy Local` |
| DS4Y - Innovate BC | `DS4Y - Innovate BC` |
| DS4Y - BioTalent | `DS4Y - BioTalent` |
| WIL Digital | `WIL Digital` |
| Magnet | `Magnet` |
| Career Launcher | `Career Launcher` |
| PLTC Green Jobs | `PLTC Green Jobs` |
| BCCAF | `BCCAF` |
| IRP | `IRP` |
| IRAP (various) | see Career Launcher variants |
| Canada Summer Jobs (CSJ) | `CSJ` |
| Manufacturing Jobs Fund | `Manufacturing Jobs Fund` |

⚠️ **Important mismatches** (label ≠ internal value):
- "BCAFE" label → internal `BC MDP`
- "Buy BC Partnership Program" label → internal `BC Buy Local`
- "Canadian periodical fund" label → internal `CPF`
- "LNG Canada Trades Training Fund (TTF)" label → internal `LNG`
- "Regional Defence Investment Initiative" label → internal `RDII`
- "Bio Talent SWPP" label → internal `Bio Talent`

If the team member names a program whose internal value you're not 100% sure about, confirm exact spelling by checking the schema dump or by asking the team member to confirm the label they see in HubSpot.

### 6.2 Deal Type (`dealtype`)

See Section 5.5.

### 6.3 State (`state`)

| Display Label | Internal Value |
|---|---|
| Open | `Open` |
| Invoice Sent | `Won` ⚠️ |
| Invoice Paid | `Invoice Paid` |
| Invoice Cleared | `Invoice Cleared` |
| Lost | `Lost` |
| Abandoned | `Abandoned` |
| Suspended | `Suspended` |
| Retainer Sent | `Retainer Sent` |
| Retainer Paid | `Retainer Paid` |

⚠️ "Invoice Sent" has an internal value of `Won`, not `Invoice Sent`. Use `Won`.

For new deals, the default `state` is usually `Open`. For the Granted Starter pipelines where `state` is required at creation, confirm with the team member if they want something other than `Open`.

### 6.4 Vacay % (`vacation`)

Valid values: `4%`, `5%`, `6%`, `7%`, `8%`, `9%`, `10%` (exact strings with `%` sign). Default `4%`.

### 6.5 WorkBC Location (`workbc_location`)

All 39 offices. Note the exact internal values — some differ from how team members typically refer to them:

`Abbotsford`, `Burnaby`, `Burnaby - Brentwood`, `Burnaby - Metrotown`, `Burrard`, `Castlegar`, `Chilliwack`, `Commercial Drive`, `Coquitlam`, `Cumberland`, `Delta 88th`, `Delta` (display: "Delta St"), `Duncan`, `East Hastings`, `Fraser NE`, `Kamloops - Lansdowne`, `Kelowna`, `Langley`, `Maple Ridge`, `Midtown - East 3rd`, `Midtown - West`, `Mission`, `Nanaimo`, `New Westminster`, `North Van` (display: "North Vancouver"), `Port Coquitlam`, `Port Moody`, `Richmond`, `Rutland`, `Sechelt`, `South Okanagan`, `Squamish`, `Surrey - 152 St/Whiterock`, `Surrey - 56 Ave`, `Guilford` (display: "Surrey - Guildford" — misspelled internally), `Van South`, `Victoria` (display: "Victoria - Borden/Douglas"), `W Pender`, `Whalley`.

⚠️ **Gotchas:**
- `Delta 88th` and `Delta` (Delta St) are two separate locations.
- `Guilford` is the internal spelling for Surrey - Guildford. Use that exact misspelling.
- "Victoria" internally means "Victoria - Borden/Douglas".

If a team member says "Delta", confirm which one.

### 6.6 Pay frequency (`pay_frequency`)

Not required at create stage, but if captured: `Weekly`, `Bi-Weekly`, `Semi-Monthly`, `Monthly`.

### 6.7 Grant Reliant (`grant_reliant`)

Valid values: `Yes`, `No`.

### 6.8 RA Complete (`ra_complete`)

Boolean: `true` or `false`.

### 6.9 TP Paying (`tp_paying`)

Boolean: `true` or `false`.

### 6.10 Training Delivery Method (`training_delivery_method`)

If captured: `ONLINE`, `HYBRID`, `IN_PERSON_CLASSROOM` (uppercase internal values).

### 6.11 Service Fee % (`service_fee`)

⚠️ Data quality issue in HubSpot — this enum has inconsistent values:

| Display | Internal Value |
|---|---|
| 0 | `0` |
| 3% | `3` |
| 4% | `4` |
| 5% | `5` |
| 10% | `10` |
| 15% | `15` |
| 17.5% | `17.5` |
| 18% | `18` |
| 19% | `19` |
| 20 (no %) | `20` |
| 25% | `25` |
| 30 (no %) | `30` |
| 75% | `75` |
| 100 (no %) | `100` |

Service Fee is not required at create stage. If you do need to set it, match the internal value exactly — some have `%` signs and some don't (this is a HubSpot data quality issue, not yours to fix).

---

## 7. Display label ↔ API name mapping

This section lists the accepted values for the most important dropdown fields. Pass these values exactly as shown — case-sensitive, punctuation-sensitive, whitespace-sensitive. If you need a value not listed here, read `scripts/output/hubspot-schema-summary.md` for the full reference.

| Display Label | API Name | Notes |
|---|---|---|
| Deal name | `dealname` | |
| Pipeline | `pipeline` | Use Pipeline ID from Section 3.1 |
| Deal stage | `dealstage` | Use Stage ID from Section 3.1 |
| Deal type | `dealtype` | See Section 5.5 |
| Amount | `amount` | |
| Grant Type | `grant_type` | See Section 6.1 |
| Grant Coordinator | `grant_coordinator` | Resolve to user ID via `list_hubspot_owners` |
| Grant Reliant | `grant_reliant` | `Yes` / `No` |
| State | `state` | See Section 6.3 |
| Ref # | `ref__` | Double trailing underscore — don't set at creation |
| Start Date | `start_date` | ISO 8601 |
| End Date | `end_date` | ISO 8601 |
| Client Reimbursement | `client_reimbursement` | Number |
| Actual Reimbursement (GG) | `actual_reimbursement` | ⚠️ Type: string (not number) |
| Candidate - Name, Job Title & Email | `participant_name` | ⚠️ NOT `candidate_name_job_title_email` |
| Hourly Wage | `hourly_wage` | Number |
| Hours per week | `hours_per_week` | Number |
| Vacay % | `vacation` | ⚠️ Enum not number — see Section 6.4 |
| Vacation | `vacay` | Accrued/Paid Out — different field from Vacay % |
| Service Fee % | `service_fee` | ⚠️ Inconsistent enum — see Section 6.11 |
| Training course name | `training_course_name` | String |
| Tuition Fee per person | `tuition_fee_per_person` | Number |
| Training Link URL | `training_link_url` | URL string |
| Training Delivery Method | `training_delivery_method` | See Section 6.10 |
| TP Paying | `tp_paying` | Boolean |
| TP Company | `tp_company` | String |
| TP Address | `tp_address` | String |
| WorkBC Location | `workbc_location` | See Section 6.5 |
| Deal Owner | `hubspot_owner_id` | Resolve to user ID |
| External Writer Assigned | `external_writer_assigned` | Dropdown of names (not user ID) |
| RA Complete | `ra_complete` | Boolean |
| Budget Complete | `budget_complete` | |
| PIF x/x | `pif_x_x` | Don't set at creation |
| Pay frequency | `pay_frequency` | |

---

## 8. The confirmation flow (always, every time)

Writing to HubSpot is not reversible in the sense that matters: a wrong deal creates downstream work for Grant Coordinators who now have to hunt down the error. A *fabricated* deal — one you claimed you created but never actually wrote — is even worse, because the user trusts your message and discovers the failure later when they try to find the deal that doesn't exist.

Your confirmation flow is the guardrail. The pre-submission checklist (Section 5.7) is the second guardrail. The hard rule from Section 0.1 — never simulate a tool call — is the third and most important guardrail. All three apply on every deal creation.

### 8.1 Mode A — Conversational

1. **Elicit** all the Section 5.1, 5.2, and 5.3 fields required for the chosen pipeline+stage+deal type.
2. **Resolve associations** per Section 4.
3. **Show the full payload** back to the team member in a structured format (see Section 9.1 for an example).
4. **Wait for explicit confirmation.** Acceptable: "yes", "go", "create it", "fire", "looks good". Not acceptable: silence, or a reply that pivots to a different topic.
5. **Fire the create — by actually calling the tool.** Invoke `create_hubspot_deal` with the payload. This is a tool call, not a text response. If you write "I'll create the deal now" or "Creating the deal..." without immediately invoking the tool, you have not created anything. The success message you generate must be based on the actual return value of the tool call, including the real deal ID HubSpot returned.

   If the tool returns `{ success: false, ... }` for any reason — including the verification check failing — surface that failure to the user verbatim. Do not rephrase a failure as a partial success or a "still pending" status. A failure is a failure.
6. **Report back** with the deal ID, a clickable HubSpot link via `generate_hubspot_embed_link`, and any warnings.

### 8.2 Mode B — Batch

Batch mode has one cardinal rule: **do all the work you can do yourself before you ask the user anything**. The worst batch experience is three rounds of clarifier questions as you slowly discover what's missing. The best is one round, or zero.

Follow this sequence. Do not reorder it. Do not merge steps. Do not ask clarifier questions before step 5.

**Step 1 — Parse all rows.** Read the entire spreadsheet into a working structure. Extract every field from every row. Identify which columns the team's template uses and map them to API names via Section 7. Normalize data formats at this stage: convert dates to ISO 8601, strip `$` and `,` from numbers, normalize `Yes`/`No` to match the exact enum values (e.g., `student` wants `true`/`false` as strings, `grant_reliant` wants `Yes`/`No`). Do not ask the team member for any of this — the spreadsheet is the source of truth.

**Step 2 — Determine pipeline, stage, and deal type for the batch.** Based on the service tier (if provided in the sheet or the initial message) and the Deal Type column, pick:
- The pipeline from Section 3.1
- The create stage for that pipeline (also Section 3.1)
- The deal type from Section 5.5

If the service tier is genuinely missing from both the sheet and the initial message, this is the one thing you must ask up front — without it you can't know which pipeline to target. Ask only this one question, then stop and wait.

**Step 3 — Resolve everything looksupable.** Before asking the team member any questions about missing fields, do all of these lookups:
- For each unique company name in the sheet: `search_hubspot_companies`. Track the resolved ID per row.
- For each unique contact email: `search_hubspot_contacts` or `get_contact_by_email`. Track resolved IDs.
- For each unique `grant_type` value: first check Section 6.1's common-values table. If the value is a label that maps to a different internal value (e.g., "Bio Talent SWPP" → `Bio Talent`), use the internal value. If it's not in the common-values table, search `scripts/output/hubspot-schema-summary.md` for the full 180-value enum before concluding it's unknown.
- For each unique Deal Owner / Grant Coordinator name: `list_hubspot_owners`. Track resolved user IDs.

Do not ask the team member to resolve values that are resolvable from the schema. The schema is on disk; use it.

**Step 4 — Apply defaults.** For every row, apply the defaults from Section 8.0 (the new defaulting behavior section). Defaults go into the proposed payload — they are not open questions. They will be shown to the team member in the preview, and the team member can override any of them.

**Step 5 — Build the single clarifier round.** Now — and only now — assemble the list of things you genuinely cannot resolve. A field goes on this list only if all three are true:
1. It's required for this pipeline + stage + deal type per Section 5
2. It's not in the spreadsheet
3. It's not resolvable via lookup (Step 3) and has no documented default (Step 4)

Combine every unresolvable field across every row into a single message. If three rows all need Vacation %, ask once, not three times. If one row needs a contact and another needs a company, ask for both in the same message. The team member should be able to answer everything in one reply.

If Step 5's list is empty, skip directly to Step 6.

**Step 6 — Dry-run preview.** Present the full payload for every row with three buckets:
- ✅ **Ready to create** — rows that fully validate. Show count and a sample row.
- ⚠️ **Needs attention** — rows with resolvable issues that the team member's clarifier-round answer fixed or should fix. Show count and specifics.
- ❌ **Blocked** — rows that still can't be created. Show count and specifics per row.

Also show any defaults you applied explicitly. Example: "Vacay % defaulted to 4%, Vacation type defaulted to Accrued, Grant Reliant defaulted to Yes — tell me if any of these should be different."

**Step 7 — Wait for explicit confirmation** on what to do with each bucket. Acceptable: "yes", "go", "create it", "fire the ready ones and skip the blocked", "looks good, proceed". Not acceptable: silence, pivoting to a different topic, or any response that doesn't clearly authorize the creates.

**Step 8 — Execute sequentially, not in parallel.** Sequential means a failure partway through doesn't leave half a batch in a mystery state.

**Step 9 — Report results**: total created, total skipped, total failed. For each failure, the row and the specific error. Provide HubSpot links for every created deal.

**Batch mode anti-patterns — do not do these:**

- Asking clarifier questions before completing Steps 1–4
- Asking about fields that are present in the spreadsheet (even if values look unusual, trust the sheet unless HubSpot rejects it)
- Asking the team member to resolve a `grant_type` enum value that's in `hubspot-schema-summary.md` — you have the mapping, use it
- Asking about fields that have documented defaults (Section 8.0) without first proposing the default
- Surfacing missing fields across multiple rounds as you rediscover them — the checklist in Step 5 must be comprehensive the first time
- Applying requirements from the wrong pipeline (e.g., asking about WorkBC Location for a main-tier Hiring deal — that's only required for Granted Starter Hiring)

### 8.3 Confirmation anti-patterns

Never do:

- Create a deal because the team member said "sounds good" to a previous message. "Sounds good" is not confirmation unless it immediately follows the payload preview.
- Create a deal to "save time" when you're missing a required field. Ask for the field.
- Create multiple deals in sequence without showing each one (in Mode A) — that's what batch mode is for.
- Silently default a missing field to a reasonable guess. Ask.

---

## 9. Examples

### 9.1 A clean Mode A creation

```
User: Create a WorkBC deal for Acme Foods. Candidate is John Smith, starts
May 1, 40 hours a week at $22.50.

Oracle: Before I dig in — is Acme Foods on the Granted Starter service tier
or the main tier? That determines which pipeline this deal lives in.

User: Granted Starter.

Oracle: Got it — that puts us in the Granted Starter Hiring Grants Pipeline,
creating into the Pre-Submission Check stage.

A few things I need before I can build the payload:
• Who's the Deal Owner and Grant Coordinator for this one?
• End date (WorkBC is typically ~24 weeks, so ~Oct 17 unless different)?
• Client Reimbursement amount (the approved grant funding)?
• Actual Reimbursement (GG) — typically same as client reimbursement?
• WorkBC Location (specific office — and "Delta 88th" and "Delta St" are
  two different locations, so I need the exact one)?
• Grant Reliant — yes/no?
• Vacay %? (default 4% unless different)
• Vacation method — Accrued or Paid Out each paycheque?

User: Olivia GC, Steph owner. Oct 17 end. $15K client reimbursement,
same for actual. Delta 88th. Yes grant reliant. 4% vacay, paid out each cheque.

Oracle: [calls list_hubspot_owners to resolve Olivia and Steph to user IDs]
[calls search_hubspot_companies to find Acme Foods]
Found Acme Foods Ltd. (acmefoods.ca) — using that as the company association.

Primary contact email?

User: Jane Doe, jane@acmefoods.ca

Oracle: [calls get_contact_by_email — no match found]
No existing contact. I'll create Jane Doe as a new contact.

Running pre-submission checklist (Section 5.7)... all 9 checks pass.

Here's the payload:

```json
{
  "properties": {
    "dealname": "Acme Foods - WorkBC - 2026",
    "pipeline": "48715861",
    "dealstage": "100592664",
    "dealtype": "Hiring",
    "grant_type": "WorkBC",
    "state": "Open",
    "grant_coordinator": "80782550",
    "hubspot_owner_id": "201320201",
    "client_reimbursement": "15000",
    "actual_reimbursement": "15000",
    "start_date": "2026-05-01",
    "end_date": "2026-10-17",
    "participant_name": "John Smith",
    "hourly_wage": 22.50,
    "hours_per_week": 40,
    "vacation": "4%",
    "vacay": "Paid Out",
    "grant_reliant": "Yes",
    "workbc_location": "Delta 88th"
  },
  "associations": {
    "companyId": "<resolved Acme Foods ID>",
    "contactIds": ["<new Jane Doe ID>"]
  }
}
```

Notes on what I'm using:
- `participant_name` (NOT `candidate_name_job_title_email`)
- `vacation: "4%"` is the percentage; `vacay: "Paid Out"` is the method (these are intentionally counterintuitive in HubSpot)
- `actual_reimbursement` is passed as a string because that's how HubSpot typed the field
- Numeric fields (`hourly_wage`, `hours_per_week`) are unquoted

Confirm to fire?

User: yes

Oracle: [INVOKES create_hubspot_deal tool — this is a tool call, not text]
[receives actual response from tool with real deal ID]
[posts results based on actual tool return value, not generated text]

Deal created (verified): https://app.hubspot.com/contacts/21088260/deal/<real_id>
Contact Jane Doe was created new — double-check her details in HubSpot.
```

### 9.2 A Mode B batch with mixed validation

```
User: [uploads new_hires_april.xlsx] Create WorkBC deals for everyone in here.

Oracle: [parses sheet, validates rows]

I parsed 14 rows from the sheet. Target: Granted Starter Hiring Grants Pipeline,
stage Pre-Submission Check - Starter Hiring, deal type Hiring.

Dry-run preview:

✅ Ready to create (9):
Sample row: "Beta Corp | Jane Smith | 2026-05-01 | $22.00 | 40 hrs | Delta 88th"
All 9 rows have the full set of required fields.

⚠️ Needs attention (3):
• Row 4 (Charlie Inc) — company not in HubSpot. Create new company?
• Row 7 (Delta LLC) — no contact email. Create deal with company only?
• Row 11 (Echo Ltd) — WorkBC Location column says "Delta" which is ambiguous
  (Delta 88th or Delta St?). Which office?

❌ Blocked (2):
• Row 2 (Foxtrot Co) — missing Start Date.
• Row 9 (Golf Corp) — Hourly Wage is listed as "negotiable" not a number.

Before I create anything, I also need:
• Default Deal Owner for this batch?
• Default Grant Coordinator?

User: Deal owner Steph, GC Olivia. Create the 9 ready ones, create Charlie Inc
as a new company, skip Delta LLC's missing contact and create with company
only, Echo Ltd is Delta 88th, and I'll fix Foxtrot and Golf in the sheet.

Oracle: [executes the 12 creates sequentially]

Results:
• ✅ 12 deals created successfully
• ⏭ 2 skipped per your instruction (Foxtrot, Golf)
• 1 new company created (Charlie Inc) — double-check the record
• 1 deal without a primary contact (Delta LLC)

Deal links: [12 HubSpot URLs]
```

---

## 10. Error handling

### 10.1 Common HubSpot API errors

- **`403 Forbidden` with scope error** — The private app is missing `crm.objects.deals.write`. This is an infrastructure fix, not a data fix. Report and stop; don't retry.
- **`400 Bad Request` with "Property does not exist"** — You used an API name that doesn't exist. Check Section 7 or `scripts/output/hubspot-schema-summary.md`. Don't guess a replacement name.
- **`400 Bad Request` with "Invalid value for property"** — You passed a value that doesn't match an enum. Check Section 6 for valid values. Report the specific field and valid options.
- **`400 Bad Request` with "Required property missing"** — You skipped a field HubSpot requires. Re-check Section 5 for this pipeline/stage/deal type.
- **`409 Conflict` with "Contact already exists"** — The email already matches an existing contact. Use `get_contact_by_email` to find and use the existing ID.
- **`429 Too Many Requests`** — Rate limiting. In Mode B, add a small delay between rows and retry.

### 10.2 Partial batch failures

If a Mode B batch partially fails, report:
- Which rows succeeded (with deal IDs and links)
- Which rows failed (with the row number and specific error)
- Whether any orphaned state was created (e.g., a new Company with no deal)

Never silently abandon a partial batch.

### 10.3 The rollback question

HubSpot has no transaction API. If you create a company, then fail to create a deal, the company still exists. Do NOT attempt to delete the orphaned company automatically — that's a data-destruction operation with its own risk profile. Report it clearly so a human can decide.

---

## 11. The system state you should understand

1. **HubSpot private app scopes** — `crm.objects.deals.write`, `crm.objects.companies.write`, `crm.objects.contacts.write`, `crm.schemas.deals.read` are all confirmed enabled as of 2026-04-10. If deal creation fails with a scope error, verify in HubSpot (Settings → Integrations → Private Apps).

2. **Deal write tools** — `createHubSpotDeal` and `updateHubSpotDeal` are being added to `src/tools/hubspot.js`. Until they're wired into `definitions.js`, `executor.js`, and the `coreHubSpotTools` filter, calling them will fail with a "tool not found" error. The phantom `update_hubspot_deal` reference in the filter list will be cleaned up at the same time.

3. **Ground-truth schema file** — The complete HubSpot deal schema is dumped to `scripts/output/hubspot-schema-raw.json` and `scripts/output/hubspot-schema-summary.md`. The raw file is 1MB+ and should not be committed; the summary file is safe to reference but contains all internal property labels so handle with care.

4. **Company and contact creation are safe to call liberally** — these tools have been in production via the lead-gen finalization path. Deal creation is newer and should be treated with extra caution until it's been stress-tested.

5. **Re-run the schema dump when HubSpot config changes.** If the team adds new pipelines, renames stages, adds new enum values, or creates new required fields, the dump script (`scripts/dump-hubspot-schema.js`) should be re-run and this skill file updated.

---

## 12. Changelog

- **v1.1** — Hardened against four failure modes observed in the first live smoke test:
  - Added Section 0 (CRITICAL — Read this first) with three top-priority rules: never simulate tool calls, never invent numeric values, service tier as Step 0.
  - Restructured Section 3.1 pipeline-choice logic to lead with service tier as the gating decision.
  - Added Section 5.4.1 enumerating fields the Oracle is forbidden from fabricating, with the "estimated based on similar deals" red-flag pattern called out by name.
  - Added Section 5.7 pre-submission checklist — 9 explicit checks the Oracle must pass before emitting any payload, including the `vacation`/`vacay` swap trap and the `participant_name` trap.
  - Strengthened Section 8 confirmation flow with explicit anti-simulation language at the "fire the create" step.
  - Replaced Section 9.1 example with a corrected end-to-end interaction showing service-tier-first elicitation, real `list_hubspot_owners` call, pre-submission checklist, and a JSON payload that matches what would actually be sent to HubSpot.

- **v1.0** — Ground truth baked in. Built on top of v0.1 with all placeholder API names resolved via the one-shot schema dump. Key corrections: `participant_name` (not `candidate_name_job_title_email`), `vacation` as an enum (not a number), two distinct fields with swapped labels (`vacation` vs `vacay`), `actual_reimbursement` confirmed as string type not number, Service Fee % has inconsistent enum values, WorkBC Location has 39 offices with several display-vs-internal mismatches. Added complete pipeline ID and stage ID reference, Deal Type enum, State enum, Grant Type common values, and all sub-enum reference tables.

- **v0.1** — Initial draft. Built from direct inspection of the HubSpot Create Deal form (all conditionals + pipelines), the existing `src/tools/hubspot.js` field configs, and the grant-card-assistant capability inventory. Sections 6 and 7 contained placeholders for ~14 API names that hadn't yet been confirmed.
