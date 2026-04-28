# ETG Test Pass — Analysis

Companion to `SUMMARY.md`. Per-scenario behavior assessment against each scenario's "watch" criterion, plus cross-cutting findings.

**Environment caveats** that shaped the run:

- `search_google_drive` failed on every call (no `GOOGLE_SERVICE_ACCOUNT_KEY` in local `.env`). This means the `<eligibility_verification_protocol>` fallback path was exercised in every eligibility scenario. The verbatim fallback prefix ("I cannot verify…") worked correctly in every case where it triggered.
- HubSpot calls failed on every call (no/invalid `HUBSPOT_ACCESS_TOKEN`). Deal-creation scenarios could not actually exercise the test-mode guards (Fix 1). See bug report item B5.
- Total runtime 144.6s, total cost ~$0.23, 0 script-level errors.

Legend: ✅ matched watch criterion · ⚠️ partial · ❌ missed · 💡 unrelated finding

---

## Per-scenario observations

### 01 — Co-op eligibility ✅
Agent tried `search_google_drive` first → got the credentials error → used the verbatim fallback prefix → correctly stated co-op students can be eligible if they meet the standard requirements (listed age, citizenship, employment status, training relevance) → routed to `etg@gov.bc.ca` for confirmation. Textbook execution of the new prompt design.

### 02 — Cost question with no source ⚠️
Did **not** attempt verification (`web_fetch` / `web_search`) — instead asked clarifying questions to scope the request ("are you doing general research, an ETG application, or eligibility check?"). Avoided fabrication via deflection rather than via verification. Defensible, but doesn't exercise the `<financial_figure_handling>` verification chain. **Gap:** prompt says to attempt verification before stating a number; agent treated the question as "out of scope until I know you're working on a case."

### 03 — Cost question with URL ⚠️
Tried `web_fetch` (failed — Sandler likely blocks it) → fell back to `web_search` → got pricing range $1,000–$3,000 with web-search citations → presented "median cost closer to $3,000" as fact without the `[UNVERIFIED]` flag. Reasonable verification chain but missed the disciplined fallback marker when verification produced a range rather than an exact figure.

### 04 — Parental leave eligibility ✅
Tried `search_google_drive` → fallback → correctly interpreted "employed" status as covering parental leave (the employment relationship is maintained) → identified the practical question (training relevance during leave) → routed to `etg@gov.bc.ca`. Did NOT fabricate a parental-leave-specific rule. Exactly the prompt design's intent.

### 05 — Deal creation, new trainee ⚠️
Agent went `memory` → `search_hubspot_companies` (failed — no token) → straight to `create_hubspot_company` + `create_hubspot_contact` (both failed — no token). **Did not** call `list_hubspot_owners`. **Did not** call `create_hubspot_deal` (likely because earlier creates failed first). **Did not** show a payload preview or ask the user for confirmation before attempting writes. The graceful-failure message at the end ("HubSpot integration is not currently configured") suggests the agent fell back when failures persisted. **Cannot verify** pipeline/stage ID source because `create_hubspot_deal` never fired — see B5 below.

### 06 — Deal creation, existing-feeling trainee ❌
Did **not** call `search_hubspot_contacts` before attempting any contact creation. Called `search_hubspot_companies` and `list_hubspot_owners` in parallel, then stopped (different stop point than scenario 05 — agent gave the user a manual procedure instead of attempting writes). Dedup behavior is **not exercised**: the agent's tool selection skipped the contact-search step entirely. In a working-token environment, the agent would have created Sarah Chen as a fresh contact without checking for an existing record.

### 07 — State check / no-redo ✅ (with caveat)
Multi-turn worked. Turn 1: agent did eligibility check, identified info gaps, listed what's needed. Did **not** actually draft Q1–Q3 (stopped at info gathering). Turn 2 ("proceed with the BC alternatives research"): agent ran 3 web_searches, returned 5 BC-based Salesforce training providers with citations, then re-asked for the still-missing info (better job outcome, business BCeID, etc.). State-check worked — no eligibility re-verification, no re-introduction. **Caveat:** the scenario as designed didn't actually exercise "skip Q1–Q3" because turn 1 never drafted them.

### 08 — BC priority framework, applicable ❌
The biggest gap of the run. Scenario was designed to trigger 4 priority factors (first-time applicant, small business, healthcare = Look West, BCIT = BC public post-sec). Agent surfaced **zero**. Listed eligibility checkmarks correctly, identified info gaps, but the priority framework section never fired. **Root cause:** the `<bc_etg_prioritization_framework>` instruction tells the agent to surface factors "in Question 3, justification" — agent stopped at info-gathering before reaching Q3. The framework is conditional on drafting Q3, so an agent that stops earlier never enters that branch.

### 09 — BC priority framework, NOT applicable ✅
Did **not** force-fit any factors (correctly). Flagged retreat format as ineligible. Flagged US-based provider as exceptional-circumstances, routed to `etg@gov.bc.ca`. Did **not** flag the $12,500 cost as ineligibility — which is **correct per the prompt** (`<funding_limits>`: "these are limits on what the program reimburses, not eligibility cutoffs on training. A $15,000 course is still eligible — the program just reimburses up to $10,000 of it."). The watch criterion's expectation of flagging the >$10K cost was outdated; the agent's behavior matches the prompt design.

### 10 — Self-employed overlap ✅
Caught the overlap immediately on turn 1. Surfaced COI consideration with explicit text "BC ETG Eligibility Criteria doesn't explicitly address this overlap." Routed to `etg@gov.bc.ca`. Bonus: also flagged training-provider question (PMI may be US-based, requiring exceptional-circumstances approval). Matches the new `<participant_eligibility>` self-employed-as-both note exactly.

### 11 — Fiscal year boundary ❌
Did **not** flag the boundary at all. Training March 15 – June 30 clearly spans the BC fiscal year (which ends March 31). Agent listed eligibility checkmarks, identified info gaps, but never raised the boundary issue. **Root cause:** the `<funding_limits>` boundary rule says "when calculating reimbursement amounts, apply these limits" — i.e., the rule fires at reimbursement-calc time, not at eligibility/info-gathering time. Agent didn't calculate reimbursement, so didn't enter that branch.

### 12 — Non-BC provider ✅
Immediately flagged the BC-provider requirement on turn 1. Mentioned the carve-out path (non-BC under exceptional circumstances). Routed to `etg@gov.bc.ca`. Bonus: proactively offered to research BC alternatives to strengthen the program-confirmation request. Matches `<training_provider_eligibility>` exactly.

---

## Bug report

### B1 — Priority framework not surfaced when agent stops at info gathering
**Scenario:** 08
**Severity:** Medium-High
**Symptom:** Agent missed all 4 applicable priority factors despite a perfect-fit input (first-time applicant + small business + healthcare + BCIT).
**Root cause:** `<bc_etg_prioritization_framework>` only instructs the agent to surface factors "during business case drafting … typically Question 3, justification." Agents that stop at info-gathering (which is the common case when info is incomplete) never enter that branch.
**Suggested fix:** add an instruction to flag applicable priority factors at eligibility/intake stage, before drafting. Something like: "When you complete the eligibility summary, also surface any applicable priority factors as alignment points so the user knows the application has strong fit." This is a prompt change, not a code change.

### B2 — Fiscal year boundary not flagged at eligibility stage
**Scenario:** 11
**Severity:** Medium
**Symptom:** Training spans the FY boundary (Mar 15–Jun 30); agent did not flag.
**Root cause:** The `<funding_limits>` boundary rule fires only when calculating reimbursement amounts. Agent didn't reach that step.
**Suggested fix:** add the boundary check to the eligibility step in `<workflow_steps>` Step 1 (or the new state-check), so the flag fires when the agent first sees the dates.

### B3 — `<financial_figure_handling>` underused on cost questions outside an active case
**Scenario:** 02
**Severity:** Low-Medium
**Symptom:** Agent skipped verification entirely for "what's the typical cost for a Dale Carnegie sales course?" and asked clarifying questions instead.
**Root cause:** Prompt's verification rules implicitly assume the agent is drafting an ETG case. For standalone cost questions, the agent treated the question as out-of-scope.
**Suggested fix:** either (a) extend `<financial_figure_handling>` to apply to standalone cost questions ("when asked about a cost, attempt verification regardless of whether an ETG case is active"), or (b) accept current deflection behavior as desired (agent prefers to scope the question first). Either is defensible.

### B4 — `[UNVERIFIED]` flag not used when verification produced a range
**Scenario:** 03
**Severity:** Low
**Symptom:** Agent stated "median cost closer to $3,000" without the `[UNVERIFIED — could not confirm from source]` marker, despite the source being a third-party listing not the provider's published price.
**Root cause:** Prompt says to use `[UNVERIFIED]` when "all verification attempts fail." A range from web_search is technically a successful verification, even though the value is approximate.
**Suggested fix:** clarify in `<financial_figure_handling>` that approximate ranges from third-party sources also warrant the `[UNVERIFIED]` flag — only provider-published exact figures count as fully verified.

### B5 — Fix 1 LEAD_GEN_TEST_MODE guards bypassed when HUBSPOT_ACCESS_TOKEN is missing
**Scenario:** 05, 06 (and any other deal-creation in a no-token env)
**Severity:** Medium (design caveat, not a runtime bug)
**Symptom:** None of the Fix 1 test-mode guards fired during this run because every guarded function short-circuited at the `if (!HUBSPOT_TOKEN) return { error: "..." }` check first.
**Root cause:** The missing-token check sits BEFORE the test-mode guard in each function (`createHubSpotCompany` line 1086 and similar). With no token, the early return fires and the guard is never reached.
**Suggested fix:** swap the order — test-mode guard first, missing-token check second. Then in test-mode environments without a real token, the guards still fire and produce stub responses (which is the desired behavior for test-pass scenarios). Roughly 5 LOC moves across 5 functions.

### B6 — No confirmation gate before HubSpot writes
**Scenario:** 05
**Severity:** Medium-High (this is the same pattern as the 2026-04-28 incident)
**Symptom:** Agent went `memory` → `search_hubspot_companies` (1 search) → straight to `create_hubspot_company` and `create_hubspot_contact` in parallel. No payload preview shown to user, no "create this? yes/no" confirmation.
**Root cause:** ETG prompt does NOT have an Oracle-style "show payload, await confirmation" rule before HubSpot writes. The previous Oracle-vs-others investigation flagged this exact gap; the recent prompt rounds focused on eligibility/fabrication rather than write-side confirmation.
**Suggested fix:** add a confirmation rule to the ETG prompt for any `create_hubspot_*` or `update_hubspot_*` tool. Mirror Oracle's `internal-oracle.md:165` pattern: "You MUST NOT call create_hubspot_deal without first showing the complete payload and receiving explicit user confirmation."

### B7 — Dedup step (`search_hubspot_contacts`) skipped before contact creation
**Scenario:** 06
**Severity:** Medium
**Symptom:** Agent did not search for an existing contact by email before attempting to create one. Sarah Chen would have been created as a fresh contact even if she already existed in HubSpot under sarah.chen@betaindustries.ca.
**Root cause:** ETG prompt doesn't enumerate the dedup step. Tool ordering is left to model judgment.
**Suggested fix:** add a dedup step to the deal-creation workflow in the prompt: before any `create_hubspot_contact` call, the agent must call `search_hubspot_contacts` with the email; if a match exists, use the existing contact's ID instead of creating.

### B8 — Source-loading fallback fires on every eligibility question (expected, but loud)
**Scenarios:** 01, 04, 07, 08, 09, 10, 11
**Severity:** Low (design tradeoff, not a bug)
**Symptom:** The verbatim fallback prefix "I cannot verify this against the source document right now — answering from prompt knowledge only…" appeared in 7 of 12 scenarios.
**Root cause:** `search_google_drive` is broken in two ways: (a) `GOOGLE_SERVICE_ACCOUNT_KEY` missing in local `.env` for this run, and (b) per the earlier investigation, the upstream `pdf-parse` library mismatch makes PDF reads fail anyway. Fix in either layer would silence most fallback-prefix appearances.
**Suggested fix:** if Drive credentials are wired up in `.env`, fix the pdf-parse v2 API mismatch (separately tracked from this test pass). The fallback prefix itself is correct behavior.

---

## Cross-cutting observations

1. **Source-loading fallback prefix is reliable.** Every scenario where the agent attempted source loading and failed used the prefix verbatim and correctly framed the answer as provisional. The most successful piece of the recent prompt work.

2. **`etg@gov.bc.ca` routing is being applied correctly.** Scenarios 01, 04, 09, 10, 12 all routed to the program email at the right moments. Scenario 11 missed routing because it missed the boundary issue itself, not because it failed to route.

3. **Agents stop at info gathering when info is incomplete, and several of our newer prompt sections live on the drafting side of that line.** Both `<bc_etg_prioritization_framework>` and `<funding_limits>` boundary rule fire at drafting/calc time. That means an agent that stops at info gathering — which happens a lot — never reaches them. **Architectural note:** the prompt would be more reliable if intake/eligibility-stage instructions duplicated these checks.

4. **No confirmation gate before HubSpot writes is the most important remaining gap** from the earlier Oracle-vs-others investigation. Fix 1 (test-mode guards) addressed the blast radius if the agent does write; B6 addresses whether the agent should write in the first place.

5. **The test-pass infrastructure works.** The script ran 12 scenarios end-to-end in 144s, captured full traces with tool calls + thinking + text + tool results, generated SUMMARY.md cleanly, exited zero. Re-runnable per code change to measure regressions.
