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

If a payload requires a numeric field (Hourly Wage, Hours per Week, Client Reimbursement, Tuition Fee per person, Service Fee, etc.) and the user has not provided that number, you MUST ask the user for it. Do not:

- Estimate based on "similar deals" you've seen.
- Calculate a wage subsidy schedule, tuition allocation, or any program-specific funding math. Every numeric value on a deal payload comes from the user, from a HubSpot workflow, or from the source spreadsheet — never from Oracle computing it.
- Use a "reasonable default" you invented.
- Pull a number from memory of past conversations.

If you don't have the number, ask. "What's the approved funding amount?" is always an acceptable response. Confabulating a number that lands in a CRM is not.

**On `amount` specifically:** do not set this field on Hiring or Training deal creation — HubSpot's workflow populates it automatically (see §5.4). You do not need to ask for it, and you do not need to derive it. For Market Expansion and Misc. Grant deals where `amount` is relevant, the rule above applies: use only the value the user provides.

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

**Note on `amount`.** `amount` (Total deal amount) is NOT in the always-required set above — HubSpot's workflow automation manages this field on Hiring and Training deals at creation time. See Section 5.4 for the pipeline-specific handling.

### 5.2 Required by the create stage (varies by pipeline)

Gather these in addition to the Section 5.1 fields. This is the minimum set to get the deal into its create stage without HubSpot rejecting the write.

#### Hiring Grants Pipeline → `Hiring Pending Submission`

⚠️ **Differences from Granted Starter Hiring:** This is the **main-tier** Hiring pipeline. WorkBC Location, State, and Actual Reimbursement (GG) are NOT required here — those are Starter-only fields. If you find yourself asking about WorkBC Location for a main-tier Hiring deal, stop — you have the wrong pipeline's checklist in mind.

| Display Label | API Name | Type |
|---|---|---|
| Grant Coordinator | `grant_coordinator` | user ID (resolve via `list_hubspot_owners`) |
| Grant Type | `grant_type` | enum |
| Client Reimbursement | `client_reimbursement` | currency/number |
| Start Date | `start_date` | date (ISO 8601) |
| End Date | `end_date` | date (ISO 8601) |
| Candidate - Name, Job Title & Email | `participant_name` | string |
| Grant Reliant | `grant_reliant` | enum (`Yes`/`No`) |

⚠️ **The API name for Candidate is `participant_name`, not `candidate_name_job_title_email`.** This is a legacy naming inconsistency — the HubSpot label was changed at some point but the internal name wasn't. Getting this wrong silently fails every Hiring and Training deal.

#### Training Grants Pipeline → `Training Pending Submission`

⚠️ **Differences from Granted Starter Training:** This is the **main-tier** Training pipeline. State, Actual Reimbursement (GG), TP Address, and TP Paying are NOT required here — those are Starter-only fields.

| Display Label | API Name | Type |
|---|---|---|
| Grant Coordinator | `grant_coordinator` | user ID |
| Grant Type | `grant_type` | enum |
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

⚠️ **Differences from main-tier Hiring:** Starter deals add three fields the main-tier pipeline doesn't require: State, Actual Reimbursement (GG), and WorkBC Location. WorkBC Location is required only if the grant program is actually WorkBC — for a Starter Hiring deal using a different program (e.g., ETG), leave it blank.

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

⚠️ **Differences from main-tier Training:** Starter Training adds State, Actual Reimbursement (GG), TP Address, and TP Paying as required fields. The `actual_reimbursement` field is still a string, not a number.

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

**Amount on Hiring and Training deals.** Do not set `amount` at creation on Hiring Grants, Training Grants, Granted Starter Hiring, or Granted Starter Training deals. A HubSpot workflow populates this field automatically when the deal is created and will overwrite anything Oracle sends. Leave `amount` off the payload entirely for these four pipelines. For Market Expansion and Misc. Grant deals, `amount` is user-provided when relevant — follow the pipeline-specific guidance in Section 5.2.

### 5.4.1 Fields to NEVER fabricate, calculate, or estimate

This is different from "fields to never set." These are fields you might be tempted to populate with a value you computed yourself. Don't.

For each of the following, you must use the value the user provides. If the user has not provided one, ASK. Never compute, estimate, or pull from "similar deals."

- **`amount`** — Total deal amount. Do not set this field on Hiring or Training deal creation (Hiring Grants, Training Grants, Granted Starter Hiring, Granted Starter Training). A HubSpot workflow populates it automatically. For Market Expansion and Misc. Grant deals where `amount` is relevant, use only the value the user provides — do not compute, estimate, or pull from "similar deals."
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

**Check 8 — All required fields for this pipeline + stage + deal type are present.** Re-read Section 5.2 for the chosen pipeline — and specifically the subsection for the chosen pipeline, not an adjacent one. The main-tier Hiring subsection and the Granted Starter Hiring subsection are different; applying the wrong one is a known failure mode. Re-read Section 5.3 for the deal type. Verify every field on those lists is in your payload — no more, no less. If your payload contains fields from a different pipeline's subsection, remove them.

**Check 9 — No fabricated numeric values.** Per Section 5.4.1: every numeric field in your payload was provided by the user, not computed, estimated, or pulled from similar deals.

If all 9 checks pass, you may emit the payload preview for user confirmation. If any check fails, fix it first.

---

## 6. Enum value reference

This section lists the accepted values for the most important dropdown fields. Pass these values exactly as shown — case-sensitive, punctuation-sensitive, whitespace-sensitive. If you need a value not listed here, read `scripts/output/hubspot-schema-summary.md` for the full reference.

### 6.1 Grant Type (`grant_type`)

HubSpot has **180 valid `grant_type` values**. The complete enum is below, sorted alphabetically by display label. Pass the **Internal Value** column exactly — capitalization, punctuation, and whitespace are all significant.

⚠️ **23 values have display labels that differ from their internal values.** If the team member gives you a label from this subset, you MUST map to the internal value before writing the payload. Sending the display label where the internal value differs will cause a 400 "Invalid value for property" error. The differing values are called out in Section 6.1.A below.

⚠️ **3 values carry trailing whitespace in the HubSpot label.** Preserve it exactly. `"Accelerating Digital Career for Youth "` (with trailing space) is a different string to HubSpot than the trimmed version — Oracle's enum match is strict. The three affected labels: `"Accelerating Digital Career for Youth "`, `"Eco-Canada - Science/Tech "`, `"Trucking HR SWSP "`.

**Preview narration rule for preserved whitespace.** When Oracle references one of the three trailing-whitespace `grant_type`s in a dry-run preview, the narration must be unambiguous about preservation. Do NOT write *"Grant Type: Eco-Canada - Science/Tech (mapped from 'Eco-Canada - Science/Tech ' with trailing space)"* — that phrasing is ambiguous (a reader cannot tell whether the payload retains the trailing space or not) and the phrase *"mapped from X to Y"* is semantically wrong when the internal value equals the label. Correct narration: *"Grant Type: `Eco-Canada - Science/Tech ` (preserved exactly, including the trailing whitespace that HubSpot's enum stores)"*. Both the display and the payload value carry the trailing space; this is intentional, not a bug to be cleaned. The *"mapped from X to Y"* narration format is reserved for genuine label→internal-value mismatches from Section 6.1.A (e.g., `"Bio Talent SWPP"` → `Bio Talent`).

⚠️ **Similar-sounding names are frequently distinct programs.** `"Science Horizons BioTalent"` and `"Bio Talent SWPP"` are separate grants with separate internal values (`Science Horizons BioTalent` vs `Bio Talent`). `"Career Launcher"`, `"Career Launcher - CL"`, `"Career Launcher - CT"`, `"Career Launcher - Impact"`, `"Career Launcher - NR"` are five separate programs, not variants of one. Never group by surface similarity — look each one up independently.

**Full enum:**

| Display Label | Internal Value |
|---|---|
| `Accelerating Digital Career for Youth ` | `Accelerating Digital Career for Youth` |
| `Accelerating Manufacturing Scale Up` | `Accelerating Manufacturing Scale Up` |
| `Access to Talent` | `Access to Talent` |
| `Agriassurance` | `Agriassurance` |
| `AgriAssurance: SME Component` | `AgriAssurance: SME Component` |
| `AgriMarketing Program` | `AgriMarketing Program` |
| `AgriTalent SWPP` | `AgriTalent SWPP` |
| `AI Compute Access Fund` | `AI Compute Access Fund` |
| `Alberta Export Expansion Program` | `Alberta Export Expansion Program` |
| `Alberta Innovates Voucher` | `Alberta Innovates Voucher` |
| `Alberta Jobs Now` | `Alberta Jobs Now` |
| `Amber` | `Amber` |
| `Annual Fee` | `Annual Fee` |
| `Apprenticeship Service Program` | `Apprenticeship Service Program` |
| `BC Basin` | `BC Basin` |
| `BC Lean` | `BC Lean` |
| `BC Maritime` | `BC Maritime` |
| `BC SMB Recovery` | `BC SMB Recovery` |
| `BCAFE` | `BC MDP` |
| `BCCAF` | `BCCAF` |
| `BCMDP` | `BCMDP` |
| `Bio Talent SWPP` | `Bio Talent` |
| `Building Green Program` | `Building Green Program` |
| `Business Scale-Up and Productivity - PacifiCan` | `Business Scale-Up and Productivity - PacifiCan` |
| `Buy BC Partnership Program` | `BC Buy Local` |
| `CAJG` | `CAJG` |
| `Canada Summer Jobs (CSJ)` | `CSJ` |
| `Canada-Saskatchewan Job Grant (CSJG)` | `CSJG` |
| `Canadian Mining Work Placement Program` | `Canadian Mining Work Placement Program` |
| `Canadian periodical fund` | `CPF` |
| `Canadian Supply Chain Program` | `Canadian Supply Chain Program` |
| `CanExport - Innovation` | `CanEx Innovate` |
| `CanExport - SME` | `CanExport` |
| `CAP Value-Added` | `CAP Value-Added` |
| `CAPG` | `CAPG` |
| `Career Launcher` | `Career Launcher` |
| `Career Launcher - CL` | `Career Launcher - CL` |
| `Career Launcher - CT` | `Career Launcher - CT` |
| `Career Launcher - Impact` | `Career Launcher - Impact` |
| `Career Launcher - NR` | `Career Launcher - NR` |
| `Career Ready SWPP` | `Career Ready Internship` |
| `Career Ready with CTMA Expanding Opportunities` | `Career Ready with CTMA Expanding Opportunities` |
| `Career Starter` | `Career Starter` |
| `CareerLaunch: Workplace Training` | `CareerLaunch: Workplace Training` |
| `CF - Food` | `CF - Food` |
| `CJG - AB` | `CJG - AB` |
| `CLAC` | `CLAC` |
| `CleanBC Innovation Accelerator` | `CleanBC Innovation Accelerator` |
| `CMJG` | `CMJG` |
| `COIL` | `COIL` |
| `COJG` | `COJG` |
| `Communautique - DS4Y` | `Communautique - DS4Y` |
| `Competitiveness Consulting Rebate` | `Competitiveness Consulting Rebate` |
| `Creative Employment Options` | `Creative Employment Options` |
| `Creative Export Canada` | `Creative Export Canada` |
| `Culture Works Canada SWPP` | `Culture Works Canada SWPP` |
| `CVP` | `CVP` |
| `DELIA` | `DELIA` |
| `Deposit` | `Deposit` |
| `Destination Trade` | `Destination Trade` |
| `Digital Lift` | `Digital Lift` |
| `Digital Lift Tech Internship` | `Digital Lift Tech Internship` |
| `Digital Marketing Skills Experience (DMSE)` | `Digital Marketing Skills Experience (DMSE)` |
| `Digital Modernization and Adoption Program - DCC` | `Digital Modernization and Adoption Program - DCC` |
| `Digital Traction` | `Digital Traction` |
| `Digital Works - Pinnguaq` | `Pinnguaq Supercluster` |
| `Discovering Potential` | `Discovering Potential` |
| `Driver Training Grant For All Age Groups` | `Driver Training Grant For All Age Groups` |
| `DS4Y - BioTalent` | `DS4Y - BioTalent` |
| `DS4Y - Eco Canada` | `DS4Y - Eco Canada` |
| `DS4Y - ICNJ` | `DS4Y - ICNJ` |
| `DS4Y - IMAA` | `DS4Y - IMAA` |
| `DS4Y - Innovate BC` | `DS4Y - Innovate BC` |
| `DS4Y - Lighthouse Labs` | `DS4Y - Lighthouse Labs` |
| `DS4Y - PCPI` | `DS4Y - PCPI` |
| `DS4Y - Pinnguaq` | `DS4Y - Pinnguaq` |
| `DS4Y VCN` | `DS4Y VCN` |
| `DSYIP` | `DSYIP` |
| `Eco Canada` | `Eco Canada` |
| `Eco Canada - Science Horizons` | `Eco Canada - SH` |
| `Eco-Canada - Science/Tech ` | `Eco-Canada - Science/Tech` |
| `Eco-Canada Co-op` | `Eco-Canada Co-op` |
| `Eco-Canada YNR` | `Eco-Canada YNR` |
| `Employability Pathways Program` | `Employability Pathways Program` |
| `Employment Services` | `Employment Services` |
| `Empowering Futures` | `Empowering Futures` |
| `Enabling Accessibility Fund (EAF)` | `Enabling Accessibility Fund (EAF)` |
| `EnMax Amplifier` | `EnMax Amplifier` |
| `Environmental Employability Pathways` | `Environmental Employability Pathways` |
| `Environmental Foreign Talent Development` | `Environmental Foreign Talent Development` |
| `Environmental Jobs Growth` | `Eco Canada - SWSP` |
| `EPF` | `EPF` |
| `ETG - BC` | `ETG - BC` |
| `EWSY - Trucking` | `EWSY - Trucking` |
| `Experience Matters` | `Experience Matters` |
| `First Nations and Inuit Summer Work Experience Program` | `first Nations and Inuit Summer Work Experience Program` |
| `Food Processing` | `Food Processing` |
| `Food Processing Growth Fund` | `FPGF` |
| `Food Safety Program` | `Food Safety Program` |
| `FSDRP` | `FSDRP` |
| `Gearing Up SWPP` | `Gearing Up SWPP` |
| `Get BC working` | `Get BC working` |
| `GoodSpark` | `GoodSpark` |
| `Green Jobs - Clean Foundations` | `Green Jobs - Clean Foundations` |
| `Green Jobs - MiHR` | `Green Jobs` |
| `Green Shipping Corridor Program` | `Green Shipping Corridor Program` |
| `Greenworks` | `Greenworks` |
| `GYW` | `GYW` |
| `HDYIP` | `HDYIP` |
| `Housing Supply Challenge` | `Housing Supply Challenge` |
| `iAdvance Pathways` | `iAdvance Pathways` |
| `ICTC` | `ICTC` |
| `IDEA Fund` | `IDEA Fund` |
| `Indigenous Tech Circle` | `Indigenous Tech Circle` |
| `Industry Commercialization Associates` | `Industry R&D Commercialization` |
| `Industry R&D Associates` | `Industry R&D Associates` |
| `Infuse Student Work Placement Program (SWPP)` | `Infuse Student Work Placement Program (SWPP)` |
| `Innovate BC` | `Innovate BC` |
| `Innovate ISI` | `Innovate ISI` |
| `Innovation Booster` | `Innovation Booster` |
| `Intrapreneurship Program` | `Intrapreneurship Program` |
| `Invest North - Grow Stream` | `Invest North - Grow Stream` |
| `IRP` | `IRP` |
| `ISI-UBC` | `ISI` |
| `IT Immigrant` | `IT Immigrant` |
| `ITAC (Technation)` | `ITAC (Technation)` |
| `KPU Mitacs` | `KPU Mitacs` |
| `LNG Canada Trades Training Fund (TTF)` | `LNG` |
| `Magnet` | `Magnet` |
| `Manufacturing Jobs Fund` | `Manufacturing Jobs Fund` |
| `Market Diversification` | `Market Diversification` |
| `MITACS` | `MITACS` |
| `Mitacs Accelerate Entrepreneur` | `Mitacs Accelerate Entrepreneur` |
| `Mon Avenir` | `Mon Avenir` |
| `New Category` | `New Category` |
| `Opportunities Fund Program` | `Opportunities Fund Program` |
| `PICS` | `PICS` |
| `PLTC Green Jobs` | `PLTC Green Jobs` |
| `Product Demonstration Program` | `Product Demonstration Program` |
| `Propel SWPP` | `Propel SWPP` |
| `PSYIP` | `PSYIP` |
| `Regional Defence Investment Initiative` | `RDII` |
| `Regional Tariff Response Initiative` | `Regional Tariff Response Initiative` |
| `RELAY-Green Careers` | `RELAY-Green Careers` |
| `Renewal` | `Renewal` |
| `Scale AI` | `Scale AI` |
| `Scale AI Training Program` | `Scale AI Training Program` |
| `Scale up and Productivity` | `Scale up and Productivity` |
| `Science Horizons BioTalent` | `Science Horizons BioTalent` |
| `Science Horizons-Clean Foundation` | `Science Horizons-Clean Foundation` |
| `Securing Small Business Rebate Program` | `Securing Small Business Rebate Program` |
| `Skilled Newcomer Bio-Economy` | `Skilled Newcomer Bio-Economy` |
| `Start up and Scale up` | `Start up and Scale up` |
| `Supply Management Processing Investment Fund` | `Supply Management Processing Investment Fund` |
| `Talent Opportunities` | `Talent Opportunities` |
| `Time-limited funding under Sections 8 and 9 of the Indigenous Languages Act` | `Time-limited funding under Sections 8 and 9 of the Indigenous Languages Act` |
| `Traceability Adoption (TA) Program` | `Traceability Adoption (TA) Program` |
| `Trade Pathways` | `Trade Pathways` |
| `Trucking HR SWPP` | `Trucking HR SWPP` |
| `Trucking HR SWSP ` | `Trucking HR` |
| `TSSP` | `TSSP` |
| `UNAC-Green Corps-STIP` | `UNAC-Green Corps-STIP` |
| `Venture For Canada` | `Venture For Canada` |
| `WAGE` | `WAGE` |
| `Wage Financial Incentive` | `Wage Financial Incentive` |
| `Wage Subsidy - Lighthouse Labs` | `Wage Subsidy - Lighthouse Labs` |
| `WEF` | `WEF` |
| `Welcoming Newcomers` | `Welcoming Newcomers` |
| `WEOC National Loan Program` | `WEOC National Loan Program` |
| `WIL Digital` | `WIL Digital` |
| `WilWorks` | `WilWorks` |
| `Work to Grow` | `Work to Grow` |
| `Work XP` | `Work XP` |
| `WorkBC` | `WorkBC` |
| `Workers in Transition` | `Workers in Transition` |
| `Workplace Accessibility` | `Workplace Accessibility` |
| `YBBE` | `YBBE` |
| `YESP (Youth Employment and Skills Program)` | `YESP (Youth Employment and Skills Program)` |
| `Youth Job Connection` | `Youth Job Connection` |
| `Youth Job Match` | `YJM` |

#### 6.1.A Labels that differ from their internal values

These 23 values require label → internal-value translation before writing the payload. If the team member supplies a label from the left column (which is what they see in HubSpot's UI), convert to the right column before sending.

**Labels that differ from their internal values** (verify carefully):

- `Accelerating Digital Career for Youth ` → `Accelerating Digital Career for Youth`
- `BCAFE` → `BC MDP`
- `Bio Talent SWPP` → `Bio Talent`
- `Buy BC Partnership Program` → `BC Buy Local`
- `Canada Summer Jobs (CSJ)` → `CSJ`
- `Canada-Saskatchewan Job Grant (CSJG)` → `CSJG`
- `Canadian periodical fund` → `CPF`
- `CanExport - Innovation` → `CanEx Innovate`
- `CanExport - SME` → `CanExport`
- `Career Ready SWPP` → `Career Ready Internship`
- `Digital Works - Pinnguaq` → `Pinnguaq Supercluster`
- `Eco Canada - Science Horizons` → `Eco Canada - SH`
- `Eco-Canada - Science/Tech ` → `Eco-Canada - Science/Tech`
- `Environmental Jobs Growth` → `Eco Canada - SWSP`
- `First Nations and Inuit Summer Work Experience Program` → `first Nations and Inuit Summer Work Experience Program`
- `Food Processing Growth Fund` → `FPGF`
- `Green Jobs - MiHR` → `Green Jobs`
- `Industry Commercialization Associates` → `Industry R&D Commercialization`
- `ISI-UBC` → `ISI`
- `LNG Canada Trades Training Fund (TTF)` → `LNG`
- `Regional Defence Investment Initiative` → `RDII`
- `Trucking HR SWSP ` → `Trucking HR`
- `Youth Job Match` → `YJM`

### 6.1.1 Resolution procedure — do this every time you encounter a `grant_type` value

When the user gives you a grant type — in a spreadsheet cell, in a chat message, or anywhere else — follow this procedure. Do not ask the user to resolve an enum value before you have tried each of these steps in order.

**Step 1 — Exact match in this skill file (Section 6.1 table above).** If the user's value is a label in the table, use the mapped internal value. Examples: "BCAFE" → `BC MDP`, "Bio Talent SWPP" → `Bio Talent`, "CanExport - SME" → `CanExport`.

**Step 2 — Full schema lookup.** If the value is not in the Section 6.1 table, read `scripts/output/hubspot-schema-summary.md` (or `hubspot-schema-raw.json` if more detail is needed). Grep for the label. There are 180 valid `grant_type` values and Section 6.1 only lists the most common 17 — the vast majority of grant type values live in the full schema file, not here. Most user inputs that look unfamiliar to you are actually exact matches once you look. "Building Green Program" is a real, exact-match value in the schema. "Science Horizons BioTalent" is a real, exact-match value in the schema. So is "DS4Y - Eco Canada", "Eco-Canada Co-op", "Career Ready SWPP", "Manufacturing Jobs Fund", and 170+ others.

**Step 3 — Fuzzy match with caution.** If the exact label isn't in the schema but something close is, propose the close match to the user and confirm before using it. Example: the user types "WorkBC Wage Subsidy" and the schema has "WorkBC". Propose the match, get confirmation, don't assume.

**Step 4 — Only then ask the user.** If Steps 1–3 all come up empty, ask the user for the exact label they see in HubSpot when they create this type of deal manually. This is the last resort, not the first.

⚠️ **Critical: different labels map to different internal values.** Do not group labels together that look similar. "Science Horizons BioTalent" and "Bio Talent SWPP" are separate grant programs with separate internal values (`Science Horizons BioTalent` and `Bio Talent` respectively) — they are NOT the same program despite both referencing BioTalent. Treating them as the same produces wrong data for at least one of the deals. When in doubt, look each label up independently in the full schema file.

⚠️ **Do not ask the user to do your lookup work.** If you write the message "These don't match the standard HubSpot grant type enum values I have" or "I don't see X in my enum list" to a user without first having read `scripts/output/hubspot-schema-summary.md`, you are asking the user to do research you could have done yourself. The schema file is on disk and always available — use it.

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

Writing to HubSpot is not reversible in the sense that matters: a wrong deal creates downstream work for Grant Coordinators who now have to hunt down the error. Your confirmation flow is the guardrail that prevents this.

### 8.0 Defaulting behavior — three buckets

Every HubSpot deal field falls into one of three buckets. Knowing which bucket a field belongs to is what separates a competent batch-mode run from an annoying one.

**Bucket 1 — Auto-default with visible preview.** These fields have sensible defaults that are correct for the vast majority of grant deals. Apply the default in the proposed payload, show it explicitly in the preview, and tell the team member they can override. Do not ask about these fields unless the team member's input indicates an override is needed.

| Field | API Name | Default | Override trigger |
|---|---|---|---|
| Vacay % | `vacation` | `4%` | Team member explicitly says a different percentage, or client's payroll setup is known to differ |
| Vacation type | `vacay` | `Accrued` | Team member says "paid out" or specifies differently |
| Grant Reliant | `grant_reliant` | `Yes` for Hiring deals | Team member says the hire would happen regardless of funding |
| State | `state` | `Open` | Only differs for specific recovery workflows |
| Pipeline | `pipeline` | Derived from service tier + deal type (see Section 3.1) | N/A — this is derived, not defaulted |
| Deal stage | `dealstage` | The create stage of the chosen pipeline | N/A — always the create stage for new deals |
| Deal name | `dealname` | Auto-construct as `{Grant Type label} - {Month Year} - {Company name} - {Candidate name}` (e.g., `"Science Horizons BioTalent - January 2026 - Acme Foods - Samuel Vincent"`). Use the Grant Type **label** (not internal value) and the full month name so names stay human-readable. For deals without a candidate (e.g., Market Expansion, Misc), omit the trailing `- {Candidate name}` segment. | Team member gives an explicit name in the sheet or conversation, or specifies a different convention at session start |
| TP Paying (Training only) | `tp_paying` | `false` | Team member indicates a third party is paying |
| RA Complete (Market Expansion only) | `ra_complete` | `false` | Team member confirms the readiness assessment is done |

**How to present defaults in the preview:** List them explicitly in a "Defaults applied" block near the top of the preview. Example: "Applied defaults: Vacay % = 4%, Vacation type = Accrued, Grant Reliant = Yes, State = Open, Deal names built as `{Grant Type} - {Month Year} - {Company} - {Candidate}`. Tell me if any of these should be different."

**Bucket 2 — Always ask.** These fields have no safe default. If they're missing from the spreadsheet, ask.

- Client Reimbursement
- Actual Reimbursement (GG) — Granted Starter pipelines only
- Start Date
- End Date
- Candidate name (`participant_name`)
- Hourly Wage (Hiring only)
- Hours per week (Hiring only)
- Training course name (Training only)
- Tuition Fee per person (Training only)
- TP Company (Training only)
- Deal Owner (`hubspot_owner_id`) — ask once at session start, apply to whole batch
- Grant Coordinator (`grant_coordinator`) — ask once at session start, apply to whole batch
- WorkBC Location (`workbc_location`) — Granted Starter Hiring only, and only if the grant program is WorkBC

**Bucket 3 — Never set at creation.** See Section 5.4 for the full list. These are workflow-populated fields that should always be blank on a new deal.

**One nuance on WorkBC Location:** it's in Bucket 2 (always ask if missing) BUT only applies to Granted Starter Hiring deals targeting WorkBC. For a main-tier Hiring deal, or a Granted Starter Hiring deal for a non-WorkBC program, do NOT ask for a WorkBC Location. Asking about WorkBC Location for a main-tier Hiring deal is a common failure mode — WorkBC Location is required only by the `Pre-Submission Check - Starter Hiring` stage, not by `Hiring Pending Submission`.

### 8.1 Mode A — Conversational

1. **Elicit** all the Section 5.1, 5.2, and 5.3 fields required for the chosen pipeline+stage+deal type.
2. **Resolve associations** per Section 4.
3. **Show the full payload** back to the team member in a structured format (see Section 9.1 for an example).
4. **Wait for explicit confirmation.** Acceptable: "yes", "go", "create it", "fire", "looks good". Not acceptable: silence, or a reply that pivots to a different topic.
5. **Fire the create — by actually calling the tool.** Invoke `create_hubspot_deal` with the payload. This is a tool call, not a text response. If you write "I'll create the deal now" or "Creating the deal..." without immediately invoking the tool, you have not created anything. The success message you generate must be based on the actual return value of the tool call, including the real deal ID HubSpot returned.

   If the tool returns `{ success: false, ... }` for any reason — including the verification check failing — surface that failure to the user verbatim. Do not rephrase a failure as a partial success or a "still pending" status. A failure is a failure.
6. **Report back** with the deal ID, a clickable HubSpot link via `generate_hubspot_embed_link`, and any warnings.

### 8.2 Mode B — Batch

### 8.2.1 The Large Vetting Sheet (LVS) template — column parsing reference

The batch template the Granted team currently uses is the Large Vetting Sheet (LVS), a 16-column `.xlsx` typically named `Template_-_Large_Vetting_Sheet.xlsx` or a close variant. Every batch submitted via this template follows the structure below; deviations signal either a corrupted file, a pre-release version of the template, or a different template entirely — stop and confirm with the team member before parsing.

**File-level parsing rules:**

- **Headers live in row 2, not row 1.** Row 1 is intentionally blank (reserved for future title/instruction text). Do not treat row 1 as the header row; do not treat row 2 as data.
- **Data starts at row 3** and continues to the first fully-empty row. Empty rows below real data are padding — stop parsing at the first fully-empty row.
- **Date columns routinely arrive in mixed formats within the same file** — Excel serial numbers (e.g., `46174`), `DD/MM/YYYY` strings (e.g., `"31/07/2026"`), and occasionally `YYYY-MM-DD` strings. Accept all three, normalize every parsed date to ISO 8601 (`YYYY-MM-DD`) before payload assembly. If a cell value matches none of the three formats, mark the row blocked and surface in the preview — do not guess.
- **Excel serial arithmetic — use this exact reference point.** Excel serial `N` corresponds to ISO date `(1899-12-30 + N days)`. Do NOT use `1900-01-01` as the anchor — Excel's historical leap-year bug (it incorrectly treats 1900 as a leap year) offsets the starting reference to `1899-12-30` for every date after 1900-03-01, which covers every Granted deal date that will ever appear in the vetting sheet. Worked example: serial `46174` → `1899-12-30 + 46174 days` → `2026-06-01`. If you anchor to `1900-01-01` instead, you will produce dates that are 17 days off and the error will silently cascade into amount derivations, claim schedule calculations, and every downstream date-dependent computation.
- **Auditability requirement.** For every Excel-serial date Oracle normalizes, narrate the full arithmetic in the dry-run preview. Example: *"Start Date: 2026-06-01 (normalized from Excel serial 46174: 1899-12-30 + 46174 days = 2026-06-01)"*. This lets the team member catch off-by-N errors before they commit. A preview that reports only the output date (*"normalized from Excel serial 46174"*) without showing the arithmetic does NOT satisfy this requirement — the arithmetic must be visible for each serial conversion individually.
- **The literal string `"Granted"` appearing in the Associate Company column is a sentinel** carried over from template testing. It does NOT mean "associate to the Granted consulting firm" — Granted is the consulting firm doing the work, not the client. When you encounter `"Granted"` in Associate Company, treat it as equivalent to blank.
- **Test/sample rows.** If a row's values match the template's sample rows verbatim (notably `"Granted"` in Associate Company or known test contact names like `"Natalie Valenzuela"` in Associate Contact), treat the company/contact as sentinel-blank rather than a real association. Ask the team member in the preview whether these are intentional rows or leftover samples.

**Column → HubSpot property mapping:**

| LVS Column | HubSpot API Name | Type | Parsing / translation notes |
|---|---|---|---|
| Grant Coordinator | `grant_coordinator` | user ID | Name → user ID via `list_hubspot_owners`. If blank, apply session default (Section 5.6). |
| Candidate Name | `participant_name` | string | Name alone. Do NOT compose Job Title into this field — they are separate HubSpot properties. |
| Job Title | `job_title` | string | Separate property from `participant_name`. Populate directly from this column. |
| Student | `application___confirm_candidate_is_student` | enum | Template values are `Yes`/`No`. Pass through as-is. |
| Citizen | `candidate___citizenship_status` | enum | Template has `Yes`/`No`; HubSpot enum expects `Citizen by birth` / `Naturalized Citizen` / `Work Permit`. **Inference rule:** `Yes` → `Citizen by birth`; `No` → `Work Permit`. Surface the inference in the preview (e.g., *"Interpreted Citizen=Yes as 'Citizen by birth' — confirm or correct for naturalized citizens"*) so the team member can override before confirmation. Never silently commit the inference without the preview callout. |
| Deal Type | `dealtype` | enum | Template restricts to `Hiring` / `Training`. Pass through. |
| **Grant Type | `grant_type` | enum (180 vals) | Full enum in Section 6.1. Apply the resolution procedure in Section 6.1.1. The `**` prefix on the header matches HubSpot's double-asterisk label convention and is not a typo — do NOT strip it when comparing to schema labels. |
| Hourly Wage | `hourly_wage` | number | Numeric. Strip any `$` or `,` if present. |
| Hours Per Week | `hours_per_week` | number | Numeric. |
| Start Date | `start_date` | date | Normalize per the file-level date rules above. |
| End Date | `end_date` | date | Same. |
| Client Reimbursement | `client_reimbursement` | number | Numeric. Strip `$` and `,`. |
| Service Fee | `service_fee` | enum (%) | ⚠️ Inconsistent enum — see Section 6.11. Template values like `20.0` (float) must normalize to the enum value `20` (no decimal). Template values like `17.5` stay as `17.5`. Match exactly against the Section 6.11 table. |
| Associate Contact | contact association | — | Resolve via `search_hubspot_contacts` by name. Exactly one match → associate. Zero or multiple matches → associate with company only and flag the row in the preview as *"contact not uniquely resolvable by name — create deal with company association only, or provide email to create the contact."* Do NOT ask mid-parse for emails; flag and continue. |
| Associate Company | company association | — | Resolve via `search_hubspot_companies` by name. Same pattern as contact. Treat literal `"Granted"` as sentinel-blank per the file-level rule. |
| Notes | `description` | string (textarea) | Pass through verbatim. |

**Columns the LVS template does NOT capture** (apply Section 8.0 defaults or Bucket 2 ask rules):

- `dealname` — auto-derived per Section 8.0 Bucket 1 (`{Grant Type label} - {Month Year} - {Company name} - {Candidate name}`). No template column needed; the LVS deliberately omits it.
- `amount` — out of scope for Hiring and Training deal creation. A HubSpot workflow populates this field automatically on Hiring Grants, Training Grants, Granted Starter Hiring, and Granted Starter Training deals. Do not set it on the payload and do not derive it — anything Oracle sends will be overwritten. See Section 5.4.
- `grant_reliant` — apply default `Yes` (Section 8.0 Bucket 1).
- `vacation` (Vacay %) — apply default `4%` (Section 8.0 Bucket 1).
- `vacay` (Vacation type) — apply default `Accrued` (Section 8.0 Bucket 1).
- `hubspot_owner_id` (Deal Owner) — ask once at session start per Section 5.6. **Never default to a specific person (not Steph, not the Grant Coordinator, not anyone).** Deal Owner and Grant Coordinator are independent fields — they often differ.
- Pipeline-specific fields not in the template (`state`, `actual_reimbursement`, `workbc_location`, `training_course_name`, `tp_company`, `tuition_fee_per_person`, etc.) — apply Section 5.2 rules for the chosen pipeline. If required for the chosen pipeline and absent from the template, include them in the single Step 5 clarifier round — do NOT ask per-row.

### 8.2.2 Batch workflow steps

Batch mode has one cardinal rule: **do all the work you can do yourself before you ask the user anything**. The worst batch experience is three rounds of clarifier questions as you slowly discover what's missing. The best is one round, or zero.

Follow this sequence. Do not reorder it. Do not merge steps. Do not ask clarifier questions before step 5.

**Step 1 — Parse all rows.** Read the entire spreadsheet into a working structure. Extract every field from every row. Identify which columns the team's template uses and map them to API names via Section 7. Normalize data formats at this stage: convert dates to ISO 8601, strip `$` and `,` from numbers, normalize `Yes`/`No` to match the exact enum values (e.g., `student` wants `true`/`false` as strings, `grant_reliant` wants `Yes`/`No`). Do not ask the team member for any of this — the spreadsheet is the source of truth. If the input file is the Large Vetting Sheet, follow the parsing rules and column mapping in Section 8.2.1 rather than inferring columns fresh. Deviations from the 8.2.1 structure mean you're looking at a different template — stop and confirm with the team member before parsing.

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

**Step 6 — Dry-run preview.** Present the full payload for every row with three buckets.

**Preview format — human-readable prose, not JSON.** Write the preview the way a colleague would describe the deal at a team stand-up: short sentences, real names and dates spelled out, dollar amounts with currency symbols, grant programs referred to by their friendly names. Do not paste raw JSON, do not show property API names (`participant_name`, `grant_coordinator`, `dealstage`), and do not show internal IDs (pipeline IDs, stage IDs, owner IDs). The team member is confirming a deal, not reviewing a payload — your job is to make the intent unambiguous in their language. Use bullet points or a short paragraph per row. Reserve the structured payload for when the team member explicitly asks to see it ("show me the JSON" or similar).

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

Here's what I'm about to create:

**WorkBC - May 2026 - Acme Foods - John Smith** — a Granted Starter Hiring deal for Acme Foods Ltd., candidate John Smith. Program is WorkBC, based at the Delta 88th office. Deal Owner is Steph; Olivia is the Grant Coordinator. John starts May 1, 2026 and wraps October 17, 2026, working 40 hours a week at $22.50/hour, paid-out vacation at 4%. State is Open, and this hire is grant-reliant.

Client Reimbursement is $15,000 and Actual Reimbursement (GG) matches at $15,000. Associating to Acme Foods Ltd. and to a new contact for Jane Doe (jane@acmefoods.ca) that I'll create as part of this run.

Amount is intentionally omitted — HubSpot's workflow populates it automatically on Hiring deals.

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

- **v1.3** — Live-test fixes driven by observations from today's Oracle run:
  - `amount` removed from required fields on Hiring Grants, Training Grants, Granted Starter Hiring, and Granted Starter Training. A HubSpot workflow owns this field at creation time and overwrites anything Oracle sends. Removed from §5.1 required set (note added), §5.2 Hiring Pending Submission table, §5.2 Training Pending Submission table, §8.0 Bucket 2 (always-ask) list, and the §8.2.1 LVS template-gap list. The old §5.4.1 proposal-with-preview derivation exception is gone — the field simply isn't Oracle's to set on these pipelines.
  - Deal name convention fixed to `{Grant Type label} - {Month Year} - {Company name} - {Candidate name}` (e.g., `"Science Horizons BioTalent - January 2026 - Acme Foods - Samuel Vincent"`). Full month name, Grant Type label (not internal value). For deals without a candidate (Market Expansion, Misc.), omit the trailing `- {Candidate name}`. Updated in §8.0 Bucket 1 and §8.2.1 template-gap list; the §9.1 worked example now uses the new form.
  - Preview format requirement added: **human-readable prose, never raw JSON**. §8.2 Step 6 now opens with an explicit rule that the dry-run preview must be written as prose a colleague could read aloud — no JSON blocks, no API names, no internal IDs (pipeline, stage, owner) — unless the team member explicitly asks to see the payload. §9.1 rewritten from a JSON block plus notes list into a prose paragraph. The JSON representation remains the internal payload shape Oracle builds; it is no longer the user-facing confirmation.

- **v1.2.1** — Post-acceptance-test fixes:
  - §8.2.1: Pinned Excel-serial arithmetic to `1899-12-30 + N days` (Excel leap-year-bug anchor) with worked example, and required per-conversion formula narration in the dry-run preview for auditability. Triggered by a live observation of Oracle converting serial `46174` to `2026-05-15` instead of `2026-06-01` — a 17-day error that silently cascaded into an incorrect amount derivation.
  - §6.1: Added preview-narration rule for the 3 trailing-whitespace `grant_type` labels. *"Mapped from X to Y"* phrasing is now reserved for genuine label≠value mismatches (§6.1.A); preserved-whitespace cases use *"preserved exactly"* phrasing instead to remove the ambiguity observed in the acceptance test.

- **v1.2** — Sprint B: adapted the skill to parse the Large Vetting Sheet (LVS) batch template rather than requiring the template to be rebuilt.
  - Added Section 8.2.1 with the complete LVS column → property mapping, file-level parsing rules (row 2 headers, mixed date formats, `"Granted"` sentinel in Associate Company), and inference rules for the Citizen `Yes`/`No` → `candidate___citizenship_status` enum translation.
  - Reorganized current 8.2 body as 8.2.2 and added Step 1 cross-reference to 8.2.1.
  - Patched Section 5.4.1 Amount entry to permit proposal-with-preview derivation in batch mode (visible formula required); silent derivation still forbidden.
  - Updated Section 8.0 Bucket 1 Deal Name default to the LVS-specific batch convention (`{Candidate Name} - {Grant Type label} - {Start Date YYYY-MM}`); Mode A convention-ask pattern preserved.
  - Section 8.0 Bucket 2 Amount entry clarified: batch derivation proposal is allowed; preview IS the ask.
  - Replaced Section 6.1 with the full 180-value `grant_type` enum inlined, including callouts for the 23 label≠value mismatches and the 3 trailing-whitespace cases. Closes the Sprint C dependency on runtime file reads for `grant_type` lookups (Oracle can now resolve any grant type without consulting `scripts/output/hubspot-schema-summary.md`).

- **v1.1** — Hardened against four failure modes observed in the first live smoke test:
  - Added Section 0 (CRITICAL — Read this first) with three top-priority rules: never simulate tool calls, never invent numeric values, service tier as Step 0.
  - Restructured Section 3.1 pipeline-choice logic to lead with service tier as the gating decision.
  - Added Section 5.4.1 enumerating fields the Oracle is forbidden from fabricating, with the "estimated based on similar deals" red-flag pattern called out by name.
  - Added Section 5.7 pre-submission checklist — 9 explicit checks the Oracle must pass before emitting any payload, including the `vacation`/`vacay` swap trap and the `participant_name` trap.
  - Strengthened Section 8 confirmation flow with explicit anti-simulation language at the "fire the create" step.
  - Replaced Section 9.1 example with a corrected end-to-end interaction showing service-tier-first elicitation, real `list_hubspot_owners` call, pre-submission checklist, and a JSON payload that matches what would actually be sent to HubSpot.

- **v1.0** — Ground truth baked in. Built on top of v0.1 with all placeholder API names resolved via the one-shot schema dump. Key corrections: `participant_name` (not `candidate_name_job_title_email`), `vacation` as an enum (not a number), two distinct fields with swapped labels (`vacation` vs `vacay`), `actual_reimbursement` confirmed as string type not number, Service Fee % has inconsistent enum values, WorkBC Location has 39 offices with several display-vs-internal mismatches. Added complete pipeline ID and stage ID reference, Deal Type enum, State enum, Grant Type common values, and all sub-enum reference tables.

- **v0.1** — Initial draft. Built from direct inspection of the HubSpot Create Deal form (all conditionals + pipelines), the existing `src/tools/hubspot.js` field configs, and the grant-card-assistant capability inventory. Sections 6 and 7 contained placeholders for ~14 API names that hadn't yet been confirmed.
