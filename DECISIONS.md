# Decisions Log

Append new entries at the **top**. Each entry is short — 3-5 lines max. Claude Code reads this for recent context.

Format:
```
## YYYY-MM-DD — short title
**What:** one line
**Why:** one line
**Impact:** files/systems touched
```

---

## 2026-08-18 — Shared Drive roots renamed: Clients / Current Clients

**What:** `All Clients` → `Clients`, `Live Clients` → `Current Clients`, renamed
in place via `files.update` on `name` (folder IDs and parents unchanged). Mapping
and copy ledger migrated to match.
**Why:** "All Clients" beside "Live Clients" read as two populations of clients
rather than a set and a view of it. Files live exactly once under `Clients`;
`Current Clients` holds only shortcuts, so the new name says what it is.
**Impact:** `scripts/mapping-lib.mjs` (roots exported there now as the single
source of truth — `CLIENTS_ROOT`, `CURRENT_ROOT`, `ARCHIVE_ROOT`, `PROGRAMS_ROOT`),
`full-mapping.mjs` and `canexport-mapping.mjs` import them instead of declaring
literals, `pilot-copy.mjs` defaults updated (a stale default would create a
second top-level tree on the next copy), `copy-ledger.jsonl` (19,193 destination
strings rewritten, root segment only; backup
`copy-ledger.jsonl.bak-2026-08-18-rootrename`). Regenerate
`dist/inventory/drive-folders.txt` after any root rename — the case-fold reads
Drive spellings from it and silently falls back if the roots no longer match.

## 2026-08-18 — Conditional tool inclusion must be per-conversation, not per-request

**Status:** Constraint established, not built. Applies to model routing,
request-conditional tool assembly, and writer-agent consolidation.

**What:** If Oracle's tools array ever becomes conditional, the variant is
selected once at conversation start and held fixed for the life of the
conversation. Do not assemble the tool set per request, and do not change it
mid-conversation.

**Why.** Anthropic renders tools before system, and the single system-side
`cache_control` sits on `systemBlocks[0]` (`client.js:561`, 5-minute default
TTL), so the tools array is cached transitively and sits at the *front* of the
24,529-token cached prefix. Varying tools per request fragments that prefix into
one cache entry per variant, each paying its own write; changing tools
mid-conversation invalidates everything behind it and forces a fresh
~24,529-token write. July billing: cache writes were $104 of a $136 Hub/Oracle
bill (69%), because writes price at 12.5–20× reads per token. Trimming ~6,000
tokens of cached *reads* to buy a 24,500-token *write* is a net loss — the naive
implementation, classify per request and assemble per request, is the losing one.

**What makes it worth doing anyway.** 6,070 tokens (32.0% of the array) are
dedicated to four specific skills — granted-marketing 2,352, sales-consultant
1,686, hubspot/DEAL_CREATION 1,022, staff-meeting-recap 1,010. With
`load_skill`'s registry overhead the skill-attributable share is roughly half the
array, and a lookup-shaped conversation needs none of it. The seam is already
clean: all 52 tools are unconditional today, the only call site is
`getToolsForAgent(agentType)` at `client.js:513`, and every input a conditional
mechanism needs — user message, `userIdentity`, history, attachments, classifier
result — is resolved 200+ lines earlier at `client.js:299-309`. No reordering
required.

**The blocker this shares with model routing.** Both decisions want skill
identity before the first API call, and both learn it after: `MODEL` is fixed at
`client.js:305`, outside the agent loop, while skill identity first exists at
`client.js:903-917` when `load_skill` dispatches — iteration ≥ 1, minimum one
full Sonnet call after the model was set. This is one blocker, not two. The fix
is cheap up-front skill-intent classification before the first call, NOT a model
field bolted onto `SKILL_PATHS` with tools solved separately later; scope them as
a single piece of work. Consequence for ETG: as things stand, ETG-as-a-skill pays
one Sonnet call per conversation before it can route itself back to Haiku — a
cost `etg-writer` does not pay today, since it starts on Haiku. Decide whether
that floor is acceptable before conversion work begins, not during.

**Superseded.** The prompt audit was framed as the primary cost lever. It targets
5,589 tokens (22.8% of prefix) against the tools array's 18,940 (77.2%) — roughly
1/3.4 the leverage, and understated further because Anthropic's per-tool schema
rendering bills above tiktoken's count. The audit still has behavioural value
(migration-era "be maximally thorough" instructions make the model do extra work
per call) but it is no longer the headline structural lever.

**Measurement caveat for anything validated against this.** Oracle conversation
volume is declining — May 1,383, Jun 1,001, Jul 898, Aug 421 (partial, through
the 18th) — so a post-change cost drop is not automatically a change effect.
Compaction also hard-deletes messages (`client.js:387`, `deleteOldMessages`) and
31 conversations have summaries, so all tool call counts are floors, biased low
precisely on the longest and most tool-heavy conversations.

**Impact:** No code changed. Constrains future work in `src/claude/client.js`
(the `client.js:513` tools seam and the `client.js:305` model binding),
`src/tools/definitions.js` (`getToolsForAgent`), `src/tools/load-skill.js`
(`SKILL_PATHS`), and the ETG writer-agent conversion. Figures from read-only
prefix and tool-inventory investigations, 2026-08-18; token counts are
`cl100k_base` proxies, not Anthropic's tokenizer.

## 2026-07-30 — Lead-gen email authorization + Starter booking policy

**Email send authorization.** `hasEmailBody` was a sufficient condition
to send. The prompt mandates writing `email_summary_body` on the first
`save_lead_data` call, so the email authorized itself and sent on turn
one, unrequested — then burned the one-send-per-session lock, blocking
the prospect's actual request and rendering "Try again" in the widget.
131 of 194 sends over 60 days had no click anywhere in the session.

Authorization is now: recorded click in `lead_gen_events`, OR
`cta_selected === 'email_summary'` (strict — malformed blob values must
not authorize), OR `forceGenerate` (cron). `hasEmailBody` is content
source only.

`deliverPendingSummaries()` added. Without it the gate would be a
regression: `finalizeInactiveSessions` selects `WHERE finalized = FALSE`,
but any session calling `save_lead_data` is finalized at that instant,
so deferred summaries would have been stranded permanently rather than
delivered late. 24h recency floor prevents a first-run blast to stale
leads (verified backlog 30 → 0).

**Starter booking policy.** Per product owner: Granted Starter gets no
call booking. Enforced server-side via `NO_LINK_PRODUCTS` in
`booking-link-routing.js` — the single chokepoint covering agent email,
chat, cron fallback email, and HubSpot note. Prompt is advisory; this
is not. Thirteen prompt locations offering Starter a call removed (ten
Starter-specific, three tier-agnostic that reached Starter: the pricing
deflection and two suggested-question chips).

Starter CTA: `granted.ca/granted-starter` (explainer) then
`app.getgranted.ca` (signup).

**Product decisions — tier gate (implementation pending):**
1. Revenue/employee/industry gate is a *precondition* for offering a
   call, not a replacement for the estimate ladder. Estimate size still
   decides which product is recommended.
2. Leads clearing neither bar are Starter. No third bucket.
3. Form revenue buckets unchanged. `$2.5M – $5M` assigned wholesale as
   Pro-eligible.
4. Business age criterion dropped — not collected, and the existing
   proxy (`is_incorporated_1yr`) is the revenue dropdown relabeled.
5. Exception industries: 34 of 81 form values (see
   `PRO_EXCEPTION_INDUSTRIES` — constant not yet created; the validated
   list is pending implementation).

**Known gaps, deferred:** funding figures in the email are model-authored
and don't match the deterministic baseline; HubSpot form 400s on every
website-less lead; empty chat bubbles from tool-narration discard;
Nonprofit still resolves to a booking link via `getBookingLink`
fallthrough.

**Impact:** `src/api/lead-gen-finalization.js` (authorization gate,
`hasSummaryClick`, `email_send_reason` marker, two `[BOOKING-LINK-LEAK]`
detectors, `deliverPendingSummaries` + `[PENDING-SUMMARY-STALE]` log),
`src/api/booking-link-routing.js` (`NO_LINK_PRODUCTS`),
`.claude/skills/lead-gen-variant-b/{system-operations,client-communication}.md`,
`scripts/smoke-booking-link.js` (two Starter assertions inverted, Pro Lite
control case added — 57/57). Blocked on the tier gate:
`employee_count` is clobbered by `save-lead-data.js:139` writing agent
free text to the form's key (32% of tool-firing sessions), and no test in
the repo imports `lead-gen-finalization.js`. Uncommitted at time of logging.

## 2026-07-27 — Lead-gen upgrade send: one tailored summary may supersede a fallback-only send
**What:** When the only prior email on a session was a cron fallback, exactly one later tailored summary supersedes it — once per session, trigger-agnostic (widget button and natural agent finalization both funnel through `saveLeadData → sendLeadGenEmail`). Send kind tracked as JSONB keys in `prospect_data` (`email_sent_kind: 'fallback'|'agent'`, `email_upgraded_at` = the hard cap). No re-tiering on upgrade — HubSpot PATCH writes the stored `best_fit_product` and tailored `email_summary_body` only. Sends predating the kind marker are deliberately NOT upgrade-eligible (no surprise emails to stale leads). `save_lead_data` now returns a truthful top-level `email_outcome` (`sent`/`upgraded`/`already_sent`/`not_sent`) and the widget renders from it instead of asserting "✓ Summary sent!".
**Why:** Two intentional features collided. The inactivity cron (Feb 19, `39aa70d8`) plus fallback-on-timeout (Mar 31, `0a6842a5`, driven by 9/9 walk-away users receiving zero emails) spent the one-send budget on a generic template; the duplicate-send guard (Mar 10, `de2afdcd`/`044a4399`), built to enable the summary button, then blocked the tailored summary that button exists to deliver. Production since Feb 19: 137 cron sends, 0 tailored; 8 prospects kept talking after their send; 3 pressed the button and were told it sent when it hadn't. Both original features stay — the fix is the interaction.
**Alternatives rejected:** Raising the 5-min threshold (defensible — p90 of reply gaps is ~3.5 min — but only makes the collision rarer, doesn't fix it); re-running tiering on upgrade (a second judgment on evidence the agent already used, and another silent-failure surface — the agent writing a tailored summary is itself the signal); new table columns via migration (overlaps the deferred send-ledger task).
**Deferred:** Send observability — 129 finalized sessions with no send record, 50 never finalized, zero failure records; "skipped" and "broke" are indistinguishable; the future ledger should consolidate `email_sent_at` + the new JSONB keys rather than add a third store. Tier freshness — upgrade writes the stored `best_fit_product`, so a not_a_fit contact can receive a full summary while HubSpot still shows not_a_fit. `scripts/inspect-conversation.js` doesn't read the lead-gen JSONB store and under-reports for this agent. No prior DECISIONS.md entry covered the cron, the guard, or fallback-on-timeout — intent was reconstructed from commit messages and `docs/archive/`.
**Impact:** `src/api/lead-gen-finalization.js` (guard → upgrade eligibility, kind marker, fixed ack line on upgrade emails, upgrade-only side effects, shared `createHubSpotClient`), `src/services/lead-notification.js` (`notifyTeamOfUpgrade`, `[UPGRADE]` subject + existing-lead banner), `src/tools/save-lead-data.js` (`email_outcome` + fix: body-less saves no longer null a stored `email_summary_body` via the JSONB merge), `widget/getgranted-widget.js` (reads the `save_lead_data` `tool_result` SSE event; truthful button states). Uncommitted at time of logging.

## 2026-07-02 — Added strategy-consulting skill (internal edition of GetGrantedAI strategic consulting v3)
**What:** New Oracle-loadable skill `strategy-consulting` with 7 sub-skills (overview, DISCOVERY, SIZING, SEQUENCING, CONVERSATIONS, RED_FLAGS, TIMING), ported from `docs/reference/getgrantedai-strategic-consulting-skill-v3.md` and reframed for the internal consulting team.
**Why:** Oracle is being positioned as the internal company strategist (landing-page redesign prep); the v3 doc held the consultant-thinking playbook but was client-facing and only live in gg3-ai-service. Internal edition inverts the program-name-secrecy rule, drops §10 program mechanics (points to granted-insights/grants instead), and strips hardcoded pricing/coupons.
**Impact:** New `.claude/skills/strategy-consulting/` (7 files); `src/tools/load-skill.js` (SKILL_PATHS); `src/tools/definitions.js` (enums + LOAD_SKILL_TOOL description). No tool-subset changes — skill teaches only tools already in Oracle's loadout. Source doc untouched.

## 2026-06-09 — Section 5 (Program Details) voice fix — two-cause
**What:** Two independent edits (commit 43b5d4b5, railway-migration): added a standalone `## Reviewing or Correcting an Existing Card` section to grant-card-generator.md — placed outside Alternate Modes so it doesn't inherit line 43's "no skill load" — that forces a `grant-card-writing` load (OVERVIEW + type) before any section rewrite; and added a "bullets only — no prose, no bold sub-headers" rule plus a third worked bad/good example to OVERVIEW.md's Section 5 block.
**Why:** Souad's Program Details kept rendering as prose paragraphs under bold sub-headers (e.g. BC Wood) despite the June 3 centralization, from two independent causes — (1) no review/correction workflow existed, so card-correction requests never triggered a skill load (zero-load path); (2) the Section 5 rule banned fragment bullets and bold-label pairs but not prose-under-sub-headers, so even a loaded skill let the shape through. Fixing only one would leave the other live; both confirmed by read-only investigation before editing.
**Impact:** `.claude/agents/grant-card-generator.md` + `.claude/skills/grant-card-writing/OVERVIEW.md` (2 files, +18). RULE_LINE B from the spec dropped as a duplicate of OVERVIEW line 81; the 9 sub-skill files left as pure pointers (no inline examples); `_souad-merge-2026-05-20.md` untouched. Pending: re-test Souad's review→rewrite flow on a known-bad card. Reserve lever if it still drifts with the skill loaded: add inline few-shot Section 5 examples to the 9 sub-skills.

## 2026-06-03 — Centralized Section 5 (Program Details) bullet-voice in grant-card-writing/OVERVIEW.md
**What:** Added a single "Section 5 (Program Details) — bullet voice" block to OVERVIEW.md (mandates complete-sentence bullets, bans the bold-label fragment pattern, reframes opening-variety guidance, carries Souad's worked examples verbatim); removed the duplicated per-file "Language style" + "Formatting" blocks from all 9 sub-skills and replaced each with a one-line pointer to OVERVIEW.md; added a Section-5 voice anchor bullet to grant-card-generator's Operating Principles.
**Why:** Triage of Souad's feedback found Section 5 producing fragmented/keyword bullets (esp. bold-label fragments like `**Application window:** …`); the old spec was duplicated 9× (and had drifted in the parenthetical examples + Group-by lists), never mandated complete sentences, never banned the bold-label pattern, and its "avoid Projects must/Funding is/Applicants must openings" rule actively contradicted the desired declarative style. Single source of truth eliminates 9-way drift; sub-skills now depend on OVERVIEW being loaded (acceptable — OVERVIEW always loads first per the skill's workflow).
**Impact:** Modified OVERVIEW.md (+block after General Formatting Rules) and 9 sub-skills (RD, BUSINESS_ASSESSMENT, MARKET_EXPANSION, HIRING_TRAINING, SYSTEMS_PROCESSES, CAPITAL_COST, LOANS, INVESTMENT, PRIZES_CONTESTS) + `.claude/agents/grant-card-generator.md`. MARKET_EXPANSION's Common inclusions block preserved; Sections 2/3.1/3.2/6.3, granted-insights, grant-card-tagging, and _souad-merge-2026-05-20.md untouched. 11 files, +45/−91.

## 2026-06-03 — granted-insights voice upgrade: EXEMPLAR sub-skill + always-load voice anchor
**What:** Added a 7th sub-skill `EXEMPLAR.md` (a fenced strategist-voice worked example + unfenced annotations) and replaced OVERVIEW's thin "Audience and voice" section with explicit anti-AI-pattern voice discipline (kill contrastive negation / telegraphing / em dashes / generic intensifiers / passive voice / rhythm flatlining / tic phrases; use contractions, specifics, direct opinions; vibe-check before delivering).
**Why:** First-pass insights read AI-flavored. A concrete exemplar anchors voice/rhythm better than abstract "plain language" rules, and naming the exact patterns to avoid is more enforceable. New "always load EXEMPLAR alongside the type sub-skill" convention wired in both OVERVIEW and Oracle's prompt.
**Impact:** New `.claude/skills/granted-insights/EXEMPLAR.md`; modified OVERVIEW.md (voice + "## Always load" section after the if-ambiguous line), `load-skill.js` (SKILL_PATHS → 7 keys), `definitions.js` (sub_skill enum + description body + description string), `internal-oracle.md` (always-load line). 5 type files byte-identical to 6ed05f1e; grant-card-generator and all other skills/agents untouched.

## 2026-06-03 — Added granted-insights skill (Oracle); decision-useful, distinct from grant-card Insights Mode
**What:** New `granted-insights` skill — OVERVIEW + 5 type files (HIRING, TRAINING, MARKET_EXPANSION, RD_CAPEX, REPAYABLE_FUNDING) — giving Oracle consultant-grade go/no-go reads (fit, effort, competitiveness, watchouts).
**Why:** Deliberately distinct from grant-card-generator's conversion-oriented "Insights Mode" (marketing copy + "book a call" CTA); granted-insights is explicitly non-marketing, restates no eligibility, appends no CTA. Both intentionally coexist.
**Impact:** New `.claude/skills/granted-insights/` (6 files); `src/tools/load-skill.js` (SKILL_PATHS); `src/tools/definitions.js` (skill_name + sub_skill enums + LOAD_SKILL_TOOL.description); `.claude/agents/internal-oracle.md` (Available-Skills entry + trigger). Touchpoint 6 no-op (search_getgranted + web_search already in Oracle loadout). Enum-global but Oracle-only by prompt. grant-card-generator untouched.

## 2026-05-21 — service_tier_recommended is documentation-only; best_fit_product is the source of truth

**Scope:** lead-gen agent, HubSpot enrichment, admin dashboard

The lead-gen system-operations prompt (system-operations.md:51-66) instructs the agent to call `memory_store('service_tier_recommended', ...)` after delivering an estimate. The intent was to preserve the agent's judgment about which tier to recommend in HubSpot notes, separate from the deterministic best_fit_product calculation.

The agent has been calling it as instructed. But the executor's prospectDataKeys allowlist at src/tools/executor.js:339-349 doesn't include `service_tier_recommended`, so the memory_store call writes to the `memories` table but the merge into `lead_gen_conversations.prospect_data` silently drops it. The field is mostly null in production.

**Decision:** Treat `prospect_data->>'best_fit_product'` (written deterministically by `computeBestFitProduct()` at src/api/lead-gen-finalization.js:1285-1306) as the canonical tier recommendation. It's already the source for HubSpot PATCH and the new admin dashboard Tier Funnel card.

**Follow-up (not blocking):** Either add `service_tier_recommended` to the executor allowlist OR strip the instruction from system-operations.md. The current state where the prompt lies to itself is the worst of both worlds. Park until next lead-gen prompt revision.

---

## 2026-05-21 — widget_mode canonical values are 'floating' and 'inline' (not 'popup')

**Scope:** lead-gen widget, lead_gen_events schema docs

Migration 014 (`migrations/014_lead_gen_events.sql`) includes a comment claiming widget_mode values are `'inline' / 'popup'`. The live widget code uses `'floating'` and `'inline'` (widget/getgranted-widget.js:39, 1505-1506, 2495, 2649).

**Decision:** `'floating'` and `'inline'` are canonical. The admin dashboard renders `'floating'` as "Popout" for staff readability (this label transform lives in admin-conversations.html, not in event data).

**Follow-up (not blocking):** Update the migration 014 comment in a future cleanup pass. No data change needed — only a stale comment.

---

## 2026-05-20 — Lead-gen booking-link sentinel substitution
**What:** Replaced URL-regex rewrite with `{{BOOKING_LINK}}` sentinel substitution. Prompts (Variant B `client-communication.md` + `system-operations.md`) now require the model to emit the literal `{{BOOKING_LINK}}` string in Pro/Pro Waitlist chat and email output. Code substitutes via new `substituteBookingLink` in `src/api/booking-link-routing.js`, applied in both `lead-gen-finalization.js` (email finalization) and `src/claude/streaming.js` (chat end_turn flush, plus the lead-gen unstreamed-text flush in `client.js`). On missing routing data (Pro/Waitlist + no industry, or sentinel present + no best_fit_product), hard-fails with `BookingLinkRoutingError` rather than fallback to Natalie — email refuses to send; chat aborts the stream with an SSE error event. Also corrected Pro pricing in prompts to `$5,000/year + 20% success fee` (was being hallucinated as 25% from Starter's number) and changed Pro/Pro Waitlist booking-call language from "15-minute intro" to "30-minute discovery." Starter / GetGranted / Not-a-Fit copy untouched per scope.
**Why:** Verification on 4 recent Pro leads (Heather/Tech-AI, Fora/Healthcare, Jeremie/Construction, Lee/Food-Manufacturing) found 3 had broken emails: literal `[booking link will be inserted by system]` shipped, or no link at all. Root cause: URL-regex rewrite pattern (`finalization.js:1014-1018`) only caught hardcoded `meetings.hubspot.com/...` URLs, but the prompt actively instructed the model NOT to write that URL — so most LLM outputs slipped past the rewrite step. Sentinel pattern aligns the prompt's instruction ("emit this exact string") with the code's substitution surface ("substitute this exact string"). Smoke test extended to 56 assertions covering sentinel substitution, null-tier paragraph/inline strip, URL-rewrite backward-compat, and hard-fail paths — all pass.
**Hard-fail rationale:** No silent fallback to Natalie's link if routing data missing — wrong consultant for a Pro lead is a tangible commercial cost; loud failure is preferable for monitoring (`[BOOKING-LINK-FAILURE]` log lines name session, contact, tier, industry, reason). Sentinel-less content still flows through the legacy URL-rewrite path inside `substituteBookingLink`, keeping in-flight Starter sessions intact.
**Impact:** `src/api/booking-link-routing.js` (+ `substituteBookingLink`, `BookingLinkRoutingError`, `BOOKING_LINK_SENTINEL`), `src/api/lead-gen-finalization.js` (regex block replaced + try/catch), `src/claude/streaming.js` (lookupLeadGenRouting + applyChatBookingSubstitution + end_turn substitution + signature change), `src/claude/client.js` (conversationId threaded; unstreamed-text flush also substitutes), `.claude/skills/lead-gen-variant-b/client-communication.md` + `system-operations.md` (Pro→30-min, sentinel rule, $5K+20% pricing line; Starter unchanged), `scripts/smoke-booking-link.js` (sentinel + hard-fail fixtures).

---

## 2026-05-06 — Lead-gen booking links: tier + industry-based routing (logged 2026-05-20)
**What:** Built `getBookingLink({best_fit_product, industry})` in `src/api/booking-link-routing.js`. Pro/Pro Waitlist leads route to Rukshaar Ali or Stephanie Sang via industry mapping in `data/rates/consultant-routing.json` (28 + 56 industries). Starter / Pro Lite / Nonprofit / Unknown route to Natalie's 15-min link. Get Granted / Not a Fit return null link (CTA stripped from email body). Commits: `a3cd49ca` (route booking links by best_fit_product + industry; strip CTA for Get Granted / Not a Fit) and `1b9de108` (update consultant routing — remove Jorge, reassign to Ruk/Steph per Apr 2026 sheet).
**Why:** Replace flat single-link routing with consultant-by-industry assignment for higher-value Pro/Waitlist leads so the call lands with the consultant who can actually advise the prospect.
**Caveat (in retrospect, logged 2026-05-20):** Email-body integration was URL-regex-based — it rewrote `https://meetings.hubspot.com/*` URLs in the LLM-emitted body to the routed consultant URL. This only worked when the LLM happened to emit such a URL, but the prompt actively discouraged the model from writing it ("system inserts URL automatically; do not hardcode"). The result was that 3 of 4 recent Pro leads had broken emails (literal placeholder text or no link). See the 2026-05-20 entry above for the sentinel-substitution architectural fix that aligns the prompt and code contracts.
**Impact:** `src/api/booking-link-routing.js` (new), `src/services/grant-categorization.js` (`assignConsultant`), `data/rates/consultant-routing.json`, `src/api/lead-gen-finalization.js` (regex rewrite block at lines 1005-1033 — now replaced by sentinel substitution per 2026-05-20).

---

## 2026-05-19 — Federal-grants Oracle tools verified live — 8/8 tests pass, shipped
**What:** End-to-end verification of `search_federal_grants_aggregate` + `search_federal_grants_records` against live Oracle on Railway: all 8 scenarios passed — correct tool selection via anti-pattern callouts (even on Haiku-tier), matview-vs-latest_view routing observable through `query_path`, `having_distinct` (~3.4s), NAICS label resolution + raw prefix, multi-metric aggregates with median, defensive enum rejection without 500s, and Oracle spontaneously surfacing the honesty caveats (program-name dedup, null-BN buckets, federal-vs-provincial framing) without per-query prompting. Three non-blocking refinements captured for future work — NOT scheduled, revisit only if usage shows they matter: (1) `description_keyword` trigram queries ~30s each — root cause unconfirmed, needs EXPLAIN ANALYZE on idx_pdg_description_trgm GIN usage; (2) `stripBilingual` misses the "EN |FR" separator (pipe without surrounding spaces) — cosmetic; (3) optional `include_recipient_name` enrichment on aggregate would collapse the aggregate→records lookup pattern (~8 calls) into 1.
**Why:** Federal-grants dataset (1.26M rows) is now queryable by the team for marketing intelligence, lead-gen, and strategic questions; the program-name noise flagged during vocabulary discovery is being caught and surfaced by Oracle automatically rather than silently misleading users.
**Impact:** Federal-grants build complete (discovery → schema → ingest → Oracle wiring → live verification) — deployed on railway-migration and in use. No code changes from this verification pass; three deferred items captured above for prioritization when usage signals demand.

---

## 2026-05-14 — Federal grants ingest v1 shipped — three follow-ups deferred
**What:** Ingested Government of Canada proactive disclosure grants (1.26M rows) into Railway Postgres via migration 021 + scripts/ingest-federal-grants.js. Oracle tool wiring deferred to next task. Three quality items intentionally deferred: (1) Granted-industry vocabulary alignment — v1 uses StatsCan NAICS labels directly; see .claude/scratchpad/granted-industry-vocabulary.md. (2) `prog_name_en` aliasing — top-10 queries visibly show "International Development Assistance program" vs "Program" as separate rows; build an alias table when noise becomes a real problem. (3) `naics_labels.parent_code` self-FK was dropped after StatsCan data violated it — capture in 022_drop_naics_parent_fk.sql when convenient.
**Why:** Each deferred item is "nice to have", not blocking. Punting keeps v1 focused on shipping queryable data, not perfecting it.
**Impact:** migrations/021_proactive_disclosure_grants.sql, scripts/ingest-federal-grants.js, package.json (+pg-copy-streams, +csv-parse), naics_labels + proactive_disclosure_grants + proactive_disclosure_meta + pdg_latest_amendments view + pdg_program_yearly matview on Railway Postgres. Oracle wiring (next task) unblocked.

---

## 2026-05-13 — Added check_blog_coverage tool

Wrapped tool over granted.ca WP REST API. Built because Oracle reliably
skipped raw `web_fetch` calls against /wp-json/... across three layers of
prompt salience (SKILL §3, EXPLORATION §4, BLOGS §4). Hypothesis under
test: model reaches for named tools but skips URL-pattern prose.

Surface: topic | slug | modified_after | category (at least one required).
10s AbortController timeout. Schema in definitions.js only. Whitelist:
Oracle + Orchestrator (acceptable); lead-gen excluded (correct).

Phase 2 not done until "got any blog ideas for me?" produces a
check_blog_coverage call in testing.

---

## 2026-05-11 — Grant card agent rewrite to skill-based architecture
**What:** Replaced 1,288-line `grant-card-generator` prompt with 172-line workflow orchestrator. Added `grant-card-writing` skill (parent `OVERVIEW` + 9 grant-type sub-skills: `RD`, `BUSINESS_ASSESSMENT`, `MARKET_EXPANSION`, `HIRING_TRAINING`, `SYSTEMS_PROCESSES`, `CAPITAL_COST`, `LOANS`, `INVESTMENT`, `PRIZES_CONTESTS`) and `grant-card-tagging` skill (`OVERVIEW`: 13 fields × 52 genres, 0-3 scoring, GG2 v2 mirror-taxonomy compatible). Deleted `genre-tagging` stub. Added `LOAD_SKILL_TOOL` to `grant-card-generator` loadout — meaningful capability change. New uppercase `OVERVIEW` sub-skill entry coexists with existing lowercase `overview` (both intentional).
**Why:** Old prompt cited 4 non-existent KB docs (`GRANT-CRITERIA-Formatter Instructions`, `PREVIEW-SECTION-Generator`, `GENERAL-REQUIREMENTS-Creator`, `MISSING-INFO-Generator`), advertised a fictional `searchGrants` tool (real tool is `search_getgranted`, already wired), and instructed `load_skill` calls the agent couldn't make. Skill-based architecture separates orchestration (agent prompt) from general format rules (`OVERVIEW`) from type-specific section rules (per-type sub-skill) from tagging taxonomy — each piece individually editable.
**Impact:** `.claude/agents/grant-card-generator.md` (rewritten), `.claude/skills/grant-card-writing/` (new, 10 files), `.claude/skills/grant-card-tagging/` (new, 1 file), `.claude/skills/genre-tagging/` (deleted), `src/tools/load-skill.js`, `src/tools/definitions.js` (`SKILL_PATHS`, `skill_name` + `sub_skill` enums, `LOAD_SKILL_TOOL.description`, `grant-card-generator` loadout), root `CLAUDE.md`, `.claude/skills/CLAUDE.md`, `.claude/recipes/add-skill.md`.

---

## 2026-04-30 — Granola MCP integration: 4-task architectural arc
**What:** First remote-MCP-as-tool-source integration in the hub, shipped across Tasks 1 (streamable-HTTP client foundation), 2 (per-user OAuth token storage), 3A-C (DCR client storage, OAuth flow, tool wiring), and 4 (connection UI). Seven decisions worth preserving:
1. **SDK-managed OAuth ceremony** — implement only `OAuthClientProvider` storage adapters; the SDK handles DCR, PKCE, and refresh. Avoided ~200 lines of hand-rolled crypto.
2. **Plaintext tokens** — re-affirmed for `user_oauth_tokens` (see separate entry below). Same deferral applies to all per-user OAuth tokens going forward.
3. **Deployment-scoped DCR** — `mcp_dcr_clients` is one row per provider per deployment, not per user. First user's DCR registration is reused for all subsequent users.
4. **Unconditional tool advertisement** — Oracle sees Granola tools regardless of user connection state; unconnected users get a "please connect" error from the first tool call. Avoids per-message DB lookup to filter tools.
5. **Redis for ephemeral OAuth state** — state + PKCE verifier in Redis with 10-min TTL (separate from long-lived tokens in Postgres). Mirrors existing per-module ioredis pattern.
6. **Generic remote-MCP wrapper** — `createRemoteMCPClient` accepts either `bearerToken` or `authProvider` (XOR). Future remote MCP servers inherit the wrapper without modification.
7. **Fail-quiet status UI** — Granola card on Oracle welcome screen renders nothing when `/api/auth/granola/status` errors, rather than showing a broken card.
**Why:** This arc established patterns the next remote MCP integration will inherit. Capturing rationale here lets future contributors and Claude sessions distinguish principled choices from expedient ones.
**Impact:** `src/mcp/remote-client.js`, `src/database/user-oauth-tokens.js`, `src/database/mcp-dcr-clients.js`, `src/api/granola-oauth-provider.js`, `src/api/granola-auth.js`, `src/utils/granola-oauth-state.js`, `src/tools/granola.js`, `src/tools/definitions.js`, `src/tools/executor.js`, `unified-agents.html`, migrations 019 + 020. Known follow-ups: (a) `src/database/redis.js` shared connection helper is a hygiene refactor target; (b) encryption-at-rest revisit triggered by compliance/audit/partner-contract pressure; (c) generic Connections UI when a second connector ships.

## 2026-04-30 — Plaintext OAuth tokens for `user_oauth_tokens` table
**What:** New generic per-user OAuth token table (migration 019) stores access/refresh tokens as plaintext `TEXT`, mirroring the existing Google convention on the `users` table (migration 004).
**Why:** No application-layer encryption infrastructure exists in the repo today. Introducing it (key management, rotation, BYTEA + IV/tag columns) is a larger lift than this scaffolding warrants and was not requested. Deferred until a concrete trigger appears (compliance, audit, partner contract).
**Impact:** `migrations/019_create_user_oauth_tokens.sql`, `src/database/user-oauth-tokens.js`. Generic table shape allows encryption columns to be added later without breaking changes — refresh_token / access_token columns can be replaced with encrypted variants behind the same CRUD API.

## 2026-04-21 — Oracle model upgraded to Sonnet 4.6 alias (dated-snapshot convention broken)
**What:** Repo-wide swap of `claude-sonnet-4-5-20250929` (dated snapshot) to `claude-sonnet-4-6` (alias) across 14 files; added `sonnet-4-6` branch to `calculateRequestCost` with identical $3/$15 pricing to 4.5.
**Why:** Anthropic hasn't published a dated snapshot for Sonnet 4.6 as of 2026-04-21. Alias is the only available form.
**Impact:** Breaks the repo's dated-snapshot pinning convention. When Anthropic publishes a dated snapshot (e.g., `claude-sonnet-4-6-20260217` or similar), do a follow-up repo-wide swap to restore the convention. Meanwhile the alias floats to whatever Anthropic's latest 4.6 snapshot is.

## 2026-04-21 — Authoring-copy drift — project knowledge can lag live repo
**What:** v1.4 authoring started from a stale `/mnt/project/hubspot-deal-creation-skill-v1_0.md` while the live file was already at v1.3; Claude Code caught the old_str mismatch at install time and aborted before applying bad edits.
**Why:** Authoring copies in the claude.ai project aren't auto-refreshed when the live file is edited elsewhere — five versions (v1.1, v1.2, v1.2.1, v1.3) shipped without the authoring copy being re-uploaded.
**Impact:** Convention — for any skill editable outside this project (GitHub web edits, other Claude Code sessions, other authors), Step 1 of an authoring session is to pull the current live file via Claude Code, or re-upload after significant revisions. No code changes.

## 2026-04-21 — Inspector timestamp fix — no storage skew, only client-side cast bug
**What:** scripts/inspect-conversation.js:95-96 was silently dropping rows from --after/--before windows; fixed by casting bounds as ::timestamptz (mirrors find-oracle-conv.js:25-26).
**Why:** Apparent +2h skew on `conversations.created_at` was a node-pg read-side display artifact on non-UTC hosts (Europe/Madrid). Storage is correct UTC — column populated by `DEFAULT CURRENT_TIMESTAMP` on a UTC server, cross-checked against HubSpot `createdate` in tool_result payloads; zero future-dated rows across 19 audited naked-TS columns.
**Impact:** scripts/inspect-conversation.js (2-line change, commit 1b6115a). No migration, no backfill — a bulk -2h correction would have corrupted clean data. Backlog: learning_applications.learning_updated_at (src/database/learning-tracking.js:51) is the one column that actually binds a JS Date to a naked-TS column; cosmetic only, zero read-side filters.

## 2026-04-20 — Session 2C: diagnostic CLI installed
**What:** Added scripts/inspect-conversation.js as the canonical conversation trace tool for any agent; wraps getConversationToolTrace() with CLI flags.
**Why:** Replaces ad-hoc dump-oracle-trace.js pattern; enables fast triage when team members report issues with a timestamp + agent.
**Impact:** scripts/inspect-conversation.js (new), .claude/commands/inspect-conversation.md (new). The 4 existing ad-hoc scripts remain in place for now; retire in a follow-up after the CLI sees real use.

## 2026-04-20 — Session 2B: root CLAUDE.md + 3 sub-CLAUDE.md orientation system
**What:** Overwrote root CLAUDE.md (Vercel-era → Railway-era) and added .claude/skills/CLAUDE.md, .claude/agents/CLAUDE.md, src/tools/CLAUDE.md. Each fact-checked against live code.
**Why:** Fresh Claude Code sessions were starting with false information (Vercel references, dead file paths). Architecture is now documented in files Chris controls.
**Impact:** CLAUDE.md, .claude/skills/CLAUDE.md, .claude/agents/CLAUDE.md, src/tools/CLAUDE.md.

## 2026-04-20 — Session 2A: skill registry drift resolved
**What:** Added granted-marketing and genre-tagging to skill_name enum + SKILL_PATHS; added OTHER_CONTENT, FOUNDATIONS, COMPANY_CONTEXT, GRANT_BLASTS, BLOGS, DATA_SOURCES to sub_skill enum; removed dead 'writing' entry from enum.
**Why:** Enum was drifting from on-disk reality — granted-marketing worked in production despite being unadvertised (enum is a hint, not server-enforced), genre-tagging existed with no registration at all. Registry now matches disk.
**Impact:** src/tools/definitions.js, src/tools/load-skill.js.

## 2026-04-20 — Session 1: AI hub cleanup
**What:** Removed 15 dead backup/unused files; deleted dead Agent SDK path (config/agent-sdk-config.js, api/agent-sdk-handler.js, POST /api/agent route); archived 137 historical docs to docs/archive/2025-2026/; moved 2 skill-source docs to docs/reference/; redacted 12 credential allow-rules in .claude/settings.local.json; installed researcher subagent + 3 slash commands (/investigate, /ship-check, /log-decision); fixed Vercel-stale dev/deploy scripts in package.json.
**Why:** Multi-session cleanup. Codebase had significant organizational debt making Claude Code slow to orient. ~32K lines of deletion in one commit.
**Impact:** ~161 files changed. Branch: railway-migration. Commit: 63f13e6.

## 2026-04-20 — Adopted Plan Mode for multi-file Claude Code tasks
**What:** Standing convention: any Claude Code task touching 2+ files or requiring judgment uses Plan mode (Shift+Tab) first. Single-file mechanical edits can use auto mode.
**Why:** Manual plan approval caught real issues (OTHER_CONTENT omission in 2A, missing files in 2B install prompt) before execution.
**Impact:** Workflow convention, no file changes.

## 2026-04-20 — Flagged but deferred: src/tools/index.js dead code
**What:** src/tools/index.js references 5 non-existent modules (broken imports). Flagged during Session 2B fact-check. Left in place.
**Why:** Not urgent; nothing imports it. Removal is a Session 3+ cleanup task.
**Impact:** None currently. Future cleanup target.

## 2026-04-20 — Flagged but deferred: dual HubSpot client layer
**What:** services/hubspot-service.js (used by server.js:454 only) and src/tools/hubspot.js (used by executor.js, lead-gen-finalization, hubspot-webhook, tests) are parallel implementations. Bug fixes must be applied to both.
**Why:** Real refactor, not a pre-launch blocker. Documented in src/tools/CLAUDE.md so future changes don't miss either side.
**Impact:** None currently. Phase 3 consolidation target.
