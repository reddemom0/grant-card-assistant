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

**How to choose the right pipeline:**

- Is the client on the Granted Starter service tier? → One of the two Starter pipelines (Hiring or Training).
- Is this a hiring grant (someone being hired, wage subsidized)? → Hiring Grants.
- Is this a training grant (someone being trained)? → Training Grants.
- Is this an export/market expansion grant (CanExport, etc.)? → Market Expansion.
- None of the above? → Misc Grant. Always confirm with the team member before defaulting here.

If you genuinely can't tell, ASK. Pipeline is not a field you can guess at — getting it wrong lands the deal in the wrong place and breaks every downstream workflow.

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

Writing to HubSpot is not reversible in the sense that matters: a wrong deal creates downstream work for Grant Coordinators who now have to hunt down the error. Your confirmation flow is the guardrail that prevents this.

### 8.1 Mode A — Conversational

1. **Elicit** all the Section 5.1, 5.2, and 5.3 fields required for the chosen pipeline+stage+deal type.
2. **Resolve associations** per Section 4.
3. **Show the full payload** back to the team member in a structured format (see Section 9.1 for an example).
4. **Wait for explicit confirmation.** Acceptable: "yes", "go", "create it", "fire", "looks good". Not acceptable: silence, or a reply that pivots to a different topic.
5. **Fire the create.** Call the deal-create tool, then associate the company and contact.
6. **Report back** with the deal ID, a clickable HubSpot link via `generate_hubspot_embed_link`, and any warnings.

### 8.2 Mode B — Batch

1. **Parse** the uploaded spreadsheet. Map columns to HubSpot property API names using Section 7.
2. **Validate every row** against Section 5's requirements for the target pipeline/stage/deal type.
3. **Resolve associations for every row** — look up the Company (and Contact if provided).
4. **Present a dry-run preview** with three buckets:
   - ✅ **Ready to create** — rows that validate cleanly. Show count + a sample row.
   - ⚠️ **Needs attention** — rows with resolvable issues. Show count + specifics.
   - ❌ **Blocked** — rows that can't be created as-is. Show count + specifics per row.
5. **Wait for explicit confirmation** on what to do with each bucket.
6. **Execute the batch sequentially**, not in parallel. Sequential means a failure partway through doesn't create half a batch of mystery state.
7. **Report results**: total created, total skipped, total failed, and for each failure, the row and the reason.

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

Oracle: I'll set that up. Quick clarifiers:
• Is Acme Foods a Granted Starter client or a main-tier client?
• Who's the Grant Coordinator and Deal Owner for this one?

User: Granted Starter. Olivia is the GC, Steph is the owner.

Oracle: Got it. A few more things I need for the create stage:
• End date (WorkBC is typically 6 months, so ~October 31 unless different)
• Client Reimbursement amount
• WorkBC Location (which office — and note that "Delta 88th" and "Delta" are
  two separate offices, so I'll need the exact one)
• Grant Reliant — yes/no?
• Vacay % — default 4% unless you say otherwise

User: Oct 31 end, $15K reimbursement, Delta 88th, yes grant reliant, 4% vacay.

Oracle: [searches HubSpot for Acme Foods]
Found one company matching "Acme Foods" — Acme Foods Ltd. (acmefoods.ca).
Using that for the association.

Primary contact email?

User: Jane Doe, jane@acmefoods.ca

Oracle: [looks up contact, doesn't find one]
No existing contact for that email. I'll create Jane Doe as a new contact
and associate her to Acme Foods and this deal.

Here's the full payload:

• Pipeline: Granted Starter Hiring Grants Pipeline (48715861)
• Stage: Pre-Submission Check - Starter Hiring (100592664)
• Deal Type: Hiring
• Deal name: Acme Foods - WorkBC - 2026
• Grant Type: WorkBC
• Company: Acme Foods Ltd. (Primary association)
• Primary contact: Jane Doe (jane@acmefoods.ca) — will be created new
• Deal Owner: Steph
• Grant Coordinator: Olivia
• State: Open
• Client Reimbursement: 15000
• Actual Reimbursement (GG): "15000" (as string)
• Start Date: 2026-05-01
• End Date: 2026-10-31
• Candidate (participant_name): John Smith
• Hourly Wage: 22.50
• Hours per week: 40
• Vacay % (vacation): 4%
• Grant Reliant: Yes
• WorkBC Location: Delta 88th

Proceed?

User: yes

Oracle: [creates contact, then deal, then associations]
Deal created: https://app.hubspot.com/contacts/[portal]/deal/[id]
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

- **v1.0** — Ground truth baked in. Built on top of v0.1 with all placeholder API names resolved via the one-shot schema dump. Key corrections: `participant_name` (not `candidate_name_job_title_email`), `vacation` as an enum (not a number), two distinct fields with swapped labels (`vacation` vs `vacay`), `actual_reimbursement` confirmed as string type not number, Service Fee % has inconsistent enum values, WorkBC Location has 39 offices with several display-vs-internal mismatches. Added complete pipeline ID and stage ID reference, Deal Type enum, State enum, Grant Type common values, and all sub-enum reference tables.

- **v0.1** — Initial draft. Built from direct inspection of the HubSpot Create Deal form (all conditionals + pipelines), the existing `src/tools/hubspot.js` field configs, and the grant-card-assistant capability inventory. Sections 6 and 7 contained placeholders for ~14 API names that hadn't yet been confirmed.
