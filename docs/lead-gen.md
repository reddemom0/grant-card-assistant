# Lead-gen — current state

Blueprint for the public lead-gen agent. Current state lives here; CLAUDE.md carries
structure only. No line numbers — name the file and the symbol.

> Captured while six lead-gen files were modified in the working tree
> (`lead-gen-init.js`, `lead-gen-helpers.js`, `lead-gen-finalization.js`,
> `save-lead-data.js`, `lead-gen-context.js`, and both variant-B skill files).
> This describes the working tree, not HEAD.

## What it is

The only public, unauthenticated agent. Runs as a widget on granted.ca, qualifies inbound
visitors, and hands a scored lead to HubSpot plus an emailed funding estimate. It never
names specific programs.

Because it is public, its tool set is deliberately restricted and its output path is not
the shared streaming path. Treat "safe for an anonymous stranger" as the governing
constraint for any change here.

## Surfaces

| Route | Handler | Auth | What it does |
|---|---|---|---|
| `POST /api/lead-gen/init` | `handleLeadGenInit` in `src/api/lead-gen-init.js` | None | Creates a session from the pre-chat form, runs deterministic intake categorization, kicks off background website extraction, returns `session_id` |
| `POST /api/lead-gen/chat` | `handleLeadGenChat` in `src/api/lead-gen.js` | None | Validates, rate-limits, resolves or creates a session, waits on extraction for the first message, calls `runAgent` with SSE |
| `POST /api/lead-gen/event` | `handleLeadGenEvent` in `src/api/lead-gen-event.js` | None | Fire-and-forget analytics into `lead_gen_events`. 8 valid event types, 100/min per IP, always returns 204 |
| `GET /api/lead-gen/analytics` | `handleLeadGenAnalytics` in `src/api/lead-gen.js` | Yes | Staff-facing read |

Four admin routes sit under a different prefix (`/api/admin/lead-gen-*`) in
`src/api/admin-lead-gen.js`, all authenticated, plus the `/admin-lead-gen` page.

**Two frontends, and the distinction matters.** `lead-gen.html` is the standalone hosted
page. `widget/getgranted-widget.js` is the embeddable widget that runs on granted.ca — it
requires an `apiUrl` config, renders into Shadow DOM, and calls all three public endpoints.
`widget/getgranted-widget-old.js` is a superseded copy still on disk that never calls
`/event`. ❓ Which file the live granted.ca embed points at is unconfirmed.

## Variant switch

`loadAgentPrompt` in `src/agents/load-agents.js` reads `LEAD_GEN_VARIANT`, uppercases it,
and branches on `'B'`.

- **Variant B** — concatenates three files from `.claude/skills/lead-gen-variant-b/` in
  fixed order: `base-system-prompt.md`, `client-communication.md`, `system-operations.md`.
  A missing file throws with the expected path, so B fails loudly.
- **Anything else** — loads `.claude/agents/lead-gen.md`. Unset, invalid, and `A` all land
  here. There is no validation; `LEAD_GEN_VARIANT=Z` silently runs A while logging "VARIANT Z".

**`lead-gen-variant-a.md` is dead.** It exists on disk and is referenced by no JavaScript
anywhere. Root CLAUDE.md claims it loads; it does not.

❓ Which variant is live cannot be determined from source — `LEAD_GEN_VARIANT` is set in the
Railway dashboard only, and appears in no committed config. It is logged at boot and per
request, so it is observable at runtime.

## Tool loadout

Seven tools in legacy mode, six with `LEAD_GEN_MATCHER=gg3` (no `search_getgranted`; see
"Matcher switch"), assembled by name rather than by spreading groups. The case opens with a
comment headed "Public chatbot — deliberately restricted tool set for security."

Included: `web_search`; `memory_store` / `memory_recall` / `memory_list`;
`search_getgranted`; `search_lead_gen_knowledge`, `search_lead_gen_strategy`,
`save_lead_data`.

Both name lookups use a defensive `...(tool ? [tool] : [])` spread, so an upstream rename
drops the tool rather than injecting `undefined`.

Excluded, with stated reasons:
- `ANTHROPIC_MEMORY_TOOL` — shared on-disk storage; a public agent could corrupt memory
  files read by internal agents.
- `web_fetch` — arbitrary URL fetching is a prompt-injection surface on a public endpoint.
- All HubSpot writes, Google Drive, Oracle tools.

The HubSpot exclusion is stated as **temporary** — a comment says writes will return "once
proper controls are in place."

**Note the asymmetry:** the agent has no HubSpot tools at all, yet HubSpot records are
written on every finalized lead. That happens server-side, not by the model.

## Conversation lifecycle

**Start.** Normally `POST /init` from the widget's pre-chat form
(`createLeadGenSessionWithFormData`). Fallback is `POST /chat` with no `session_id`, which
creates an IP-only session. `session_id` doubles as the `conversations.id` used by
`runAgent`.

**State.** `lead_gen_conversations` (migrations 011–014). `prospect_data` JSONB is the real
working store and holds far more than the migration comment lists — service tier, best-fit
product, funding estimate, email body, industry, revenue and headcount buckets, opt-in, and
the email-send markers. Updated by `prospect_data || $1::jsonb` merge, never wholesale
replacement.

**The `messages` JSONB column is a duplicate.** Authoritative history for `runAgent` lives
in the standard `messages` table keyed by the same `session_id`. The JSONB column is an
export snapshot kept in sync by `appendLeadGenMessages`.

**No TTL, no cleanup job.** Finalized rows persist indefinitely. The only deletion path is
the manual admin endpoint. ❓ No retention policy found.

**Bounds** (constants at the top of `src/api/lead-gen.js`): 10 new sessions per IP per hour,
20 per day, 12 messages per session, 500 chars per message, $50/IP/day API spend, and a
per-session cost cap defaulting to $5.00. An inline comment claims "max 20 messages" while
the constant is 12 — the comment is stale.

**`LEAD_GEN_TEST_MODE` is misnamed.** It mocks HubSpot writes across *all* agents, at
fifteen call sites. It does **not** stop email sending.

## Matcher switch (`LEAD_GEN_MATCHER`)

Where the funding figures come from. `legacy` (default, and anything other than `gg3`)
is everything else on this page: the rate-table baseline, then the model's own estimate.
`gg3` makes one stored estimate the only source of figures.

**Sticky per session.** `/init` reads the env once and writes `prospect_data.lead_gen_matcher:
'gg3'`. Legacy sessions don't have the key. Everything after reads the session's value
(`isGg3Session`), so flipping the env mid-session can't mix the two. The one exception is
the tool loadout, which `getToolsForAgent` builds from the env per request; a gg3 session
that is offered `search_getgranted` anyway gets a refusal from the executor.

**Intake** (`runGg3IntakeCategorization` in `src/api/lead-gen-init.js`):
- **Concurrent:** `categorizeProspect(skipHaiku)` runs for `service_tier` (the not_a_fit rules) and the consultant. `fetchLeadGenEstimate` (`src/services/lead-gen-gg3-estimate.js`) calls gg3 match-lead with an 8 s timeout.
- **Goals** (`mapWidgetToGoals`):
  - Training Budget (anything but "None planned") → Hire or Train People.
  - Market Expansion budget → International Growth.
  - `planned_activities` free text → passed as-is; gg3's own cue table maps it.
  - **Hiring Plans is never a goal source.**
- **Budgets** (since 2026-11-03): `training_budget`, `expansion_budget` and `hiring_plans` are also sent as the raw widget strings, en dashes intact, or `null` when unset. gg3 uses them to cap goal totals and owns the cap rules (gg3-ai-service DECISIONS.md, 2026-11-03). Lead-gen does no capping of its own.
- **Province:** the widget's comma-joined list is split. "Just me" → 1.
- **Stored on `prospect_data.gg3_estimate`:** `{ status, low, high, per_goal, matches_used, revenue_band_used, notes, inputs_used, dropped, cards }`, where status is `ok | confirm_needed | insufficient_profile | unavailable`. `cards` holds gg3's top-5 names and providers, for the internal Note only. Failure or timeout → `unavailable`, logged `[LEAD-GEN-GG3-ESTIMATE-FAIL]`.
- **Tier — always locked here, never pending** (`computeGg3BestFitProduct`):
  - status `ok` → `computeBestFitProduct` on the estimate formatted low-first, so the $15,000 Starter threshold reads `estimate.low`;
  - anything else → the size rule alone: Pro gate → Granted Pro, else Get Granted.

  Nonprofit and not_a_fit win as always. The tier still locks if categorization throws.
- **`estimated_funding`** is `formatEstimateRange(estimate)`, full dollars ("$50,000–$250,000"), only when status is `ok`. The rate-table baseline is never shown.

**Chat.** `getLeadGenFormContext` adds a "Funding estimate" block to `<lead_info>`:
- **`ok`:** the exact total and per-goal ranges, marked as overriding any estimation method in the prompt.
- **`confirm_needed`:** "matching programs exist; amounts confirmed on review", no figure.
- **Otherwise:** no figure and no claim of matches.

Both prompts (`.claude/agents/lead-gen.md`, Variant B `system-operations.md`) carry one `<precomputed_estimate>` rule that defers to the block. `getStrategicContext` returns null for gg3 sessions.

**The model can't change a figure.** Each write path is pinned to the stored estimate (`pinFundingToGg3`):
- **`memory_store`:** writes of `estimated_funding`, `available_now_funding` and `programs_matched_count` are not merged into `prospect_data`.
- **`save_lead_data`:** these fields are pinned. `matched_programs` becomes gg3's card names.
- **`loadEnrichedSessionData`:** pins the same fields, so the form, Note, fallback email and team notification all read the stored value.

**Email.** `composeLeadGenEmailBody` (`src/api/lead-gen-finalization.js`) picks the body. In gg3 mode:
- The agent's `email_summary_body` is kept only if every dollar figure in it is a stored figure: the estimate's bounds, or the form's own bucket bounds (`findForeignFigures`).
- Otherwise the template is sent, built from the stored estimate (`generateFallbackEmail`'s gg3 branch), and `[ESTIMATE-MISMATCH]` is logged.
- That send has kind `gg3_template`, which is not upgrade-eligible, and an upgrade send whose body was refused is skipped.

**HubSpot.**
- **Note:** a "Funding Estimate (gg3 match-lead)" section (total, per goal, matches, band, goals, notes). It replaces the rate-table baseline line.
- **AI-property PATCH:** adds `grant_calc_min` / `grant_calc_max` (number properties) when status is `ok`.
- **`email_summary_body`:** the composed (validated or template) body.

**Verified 2026-11-02** (local, TEST_MODE, prod gg3, three leads): every figure was identical on every surface.
- **Surfaces checked:** match-lead's estimate, `<lead_info>`, chat, email, Note, `grant_calc_*`, and the `estimated_funding` column.
- **Chat formatting:** chat abbreviates ("$368.5K"), but the values are the same.
- **Legacy:** intake, `<lead_info>` and loadout were byte-identical to HEAD.

## HubSpot form rejections

`submitLeadGenForm` (`src/api/hubspot-form-submission.js`) no longer gives up on the first failure. Both modes:
1. **Transient failures** (no response, 5xx, 429) are retried twice (1 s, 3 s). A 4xx isn't retried as-is.
2. **A rejection naming `website`** (`parseFormErrors`) is retried once with `https://<email domain>`. Free-mail domains get no repair. The forms token lacks the forms scope, so the form's required fields could not be read; this is keyed off HubSpot's error message, not the schema.
3. **Still rejected:** finalization logs `[HUBSPOT-FORM-REJECTED]` and calls `upsertLeadGenContact`. That upserts the Contact by email via `/crm/v3/objects/contacts/batch/upsert`: first with every form field, then with core identity fields only. The PATCH, Note and email then carry on. The lead has no form-submission event (reporting bucket).
4. **The outcome** is written to `prospect_data.hubspot_sync = { form: submitted|repaired|rejected, fallback: none|crm_upsert|failed, errors, at }`. If even the upsert fails, `[HUBSPOT-LEAD-LOST-RISK]` is logged.

## Tier: one value, locked once

This is the most important thing on this page. The product a lead is told about is
`best_fit_product`, computed by `computeBestFitProduct` in `src/api/lead-gen-helpers.js`
and **locked**: decided once, then only read. Chat, the HubSpot form, the AI-property
PATCH and the note's "Service Tier Recommended" all name the stored value, so they can't
disagree. (Before 2026-11-02 they came from three sources and did: the prompt's own ladder,
`computeBestFitProduct` on the model's later range, and `determineServiceTier`, now deleted.)

**When it locks.** (Legacy. gg3 mode always locks at intake; see "Matcher switch".)
At intake, in `runIntakeCategorization`, from the baseline estimate —
unless that baseline is $0 (no rate table or no data; `isTierPendingFirstEstimate`). Then
the key stays unset and `lockBestFitProduct` locks it in `finalizeLeadGenConversation`, i.e.
at the model's first `save_lead_data`, from the range it saved in `estimated_funding`.
Non-profit and `not_a_fit` leads always lock at intake. The lock UPDATE only writes when no
value is stored, so a later estimate can't change it.

**How the model learns it.** `describeRecommendedProduct` puts a "Recommended product"
line in `<lead_info>` (`getLeadGenFormContext`) on every turn. A pending lead gets the rule
instead (low end ≥ $15,000 → Starter, else Get Granted; Pro-eligible → Pro once there is a
dollar figure), so what the model names is what locks. The search handler's
`tier_specific_reminder` repeats the same line for every tier (not_a_fit keeps its own
text). The Variant B prompt no longer has a tier ladder; it names the given product.

| Where | What it decides |
|---|---|
| Variant-B prompt files | `lead_score` rubric (8 signals, −2 to +2), thresholds 10+ HOT / 5–9 WARM / 0–4 COOL. **Not** the tier |
| `data/rates/tier-rules.json` via `determineTier` in `src/services/grant-categorization.js` | `service_tier` — ordered rules through a hand-rolled condition evaluator; default fallback is `starter`. Feeds `computeBestFitProduct` (`not_a_fit`) |
| `computeBestFitProduct` + `lockBestFitProduct` in `src/api/lead-gen-helpers.js` | `best_fit_product` — the tier, everywhere |

**`lead_score` is prompt-only.** Nothing in code computes, validates, or clamps it. The
model emits it in `save_lead_data` and it is stored as given.

**Hard disqualifiers** are in both layers. `tier-rules.json` lists four `not_a_fit` rules:
non-profit, not incorporated ≥1 year, pre-revenue, and fewer than 2 FTEs. The prompt
restates a readiness gate for framing.

**`not_a_fit` is enforced structurally, not just by prompt.** `computeBestFitProduct` maps
it to `Get Granted`, which is in `NO_LINK_PRODUCTS`, so the booking link is stripped
regardless of what the model wrote.

**The revenue gate in code is deliberately looser than the policy.** `isProCallEligible`
ranks the widget's form buckets ordinally and passes on either (a) revenue ≥ $2.5M–$5M with
5–19+ employees, or (b) a `PRO_EXCEPTION_INDUSTRIES` match with revenue ≥ $500K–$2.5M and
5–19+ employees. The comment is candid that bucket edges round the stated policy down, and
that this is intentional: a missed conversation costs more than an extra one. It reads only
form fields, never the agent's free-text figures, because those cannot be ranked. Missing
input returns false — "no data is not evidence of fitness."

Two further facts: `computeBestFitProduct` never returns `Waitlist` (that comes from
HubSpot manual edits or workflows), and a former sub-$2.5M cap was removed because
`parseFundingEstimate` reads only the first number in a string, so `$1.5M–$3M+` parses as 1.

## The `{{BOOKING_LINK}}` sentinel

**In prompts:** only in the two variant-B skill files. Nothing in
`.claude/agents/lead-gen.md`. ❓ If Variant A is live, the sentinel is never emitted and the
whole path runs in legacy URL-rewrite mode.

**Prompt rules, each encoding a past failure:** the sentinel must sit alone in its own `<p>`
block — on no-link tiers the system removes the entire paragraph, so any sentence sharing it
is destroyed, and a sentinel outside a `<p>` isn't recognised and ships raw. Never inside a
list item, heading, or `href`. Never a self-invented bracketed stand-in. Pro and
Pro-Waitlist only. Non-assumptive phrasing.

**Substitution in code:** `substituteBookingLink` in `src/api/booking-link-routing.js`,
called from `lead-gen-finalization.js` (`mode: 'email'`) and from `src/claude/streaming.js`
(`mode: 'chat'`, at end-turn flush).

**Routing** — `getBookingLink`, keyed on `best_fit_product` alone:
- `NO_LINK_PRODUCTS` = Get Granted, Not a Fit, Nonprofit, **Granted Starter** → `null`.
  Starter's inclusion is deliberate: a Starter-shaped lead that deserves a conversation
  isn't Starter at all, it's Pro.
- `INDUSTRY_ROUTED_PRODUCTS` = Granted Pro, Waitlist → `assignConsultant(industry)`.
- Everything else → Natalie's intro link.

The design note is worth keeping: product and call eligibility are **one** decision, not
two. `getBookingLink` needs no other input.

**When no rule matches** — three behaviours:
1. Pro/Waitlist, missing industry, no sentinel present → falls back to Natalie's link.
2. Sentinel present with missing industry or missing product → throws
   `BookingLinkRoutingError`. Hard-fail is intentional; in the email path this means **no
   email is sent**, logged as `[BOOKING-LINK-FAILURE]`.
3. Sentinel absent → legacy mode: rewrite hardcoded HubSpot meeting URLs, strip CTA
   paragraphs on null tiers.

**Two known leaks, logged but not repaired:** a sentinel that survived substitution because
it wasn't wrapped in its own `<p>` (`[BOOKING-LINK-LEAK]`), and model-invented bracket
placeholders. Fifteen sessions shipped one of these, one confirmed in a recipient's inbox.
The stated position is that the fix belongs in the prompt — a partial repair in code would
be guesswork.

## Finalization

Two triggers, both landing in `finalizeLeadGenConversation` in
`src/api/lead-gen-finalization.js`: `contact_captured` (the agent calls `save_lead_data`)
and `inactivity_timeout` (the cron).

**`save_lead_data`** (`src/tools/save-lead-data.js`) has `conversationId` injected by the
executor — the agent never passes it. Requires name and email. **It overrides the model's
own claims** from stored conversation memory: auto-matched grants take precedence over the
agent's `matched_programs`, along with counts and funding figures. Every override is logged
with both values.

**Sequence:**
1. **Atomic claim** — `UPDATE … SET finalized = TRUE … WHERE finalized = FALSE RETURNING *`.
   A second caller gets zero rows and returns `alreadyFinalized`. This is the race guard
   between the tool trigger and the cron.
2. Merge form data as fallbacks only — form never overrides agent-collected data. Bails
   without a company name.
3. No `HUBSPOT_ACCESS_TOKEN` → mark finalized, skip HubSpot.

**HubSpot write shape** — deliberately *not* a direct object create. It goes through
`submitLeadGenForm` as a form submission so leads land in the same reporting bucket as
legacy forms and HubSpot auto-associates the company by email domain. Then: resolve contact
by email with retry (HubSpot's eventual-consistency window), write the locked
`best_fit_product` (locked right after the claim, before the HubSpot-token check), PATCH the AI-derived properties, look up the company, and
create-or-update a Note attached to both.

**Email** — `sendLeadGenEmail` via the Gmail REST API (Railway blocks SMTP), branded
template, sent to the prospect. Authorization requires `cta_selected === 'email_summary'` by
**exact equality, not substring** — at least two sessions hold malformed blobs where a
closing tag was swallowed into the value, and a substring match would treat that corruption
as consent. Alternatives are a recorded summary-button click or the cron's `forceGenerate`.
Duplicate sends are blocked by a marker, with exactly one permitted "upgrade" send when the
earlier one was a cron fallback and a tailored body now exists.

**Partial failure** — every step degrades independently and continues: form submit (now with
retries and a direct-upsert fallback; see "HubSpot form rejections"), contact
lookup, AI-property PATCH, company lookup, local product persist (which warns that CTA
stripping may fall back to Natalie). **The one hard abort is booking-link routing — that
sends no email at all.**

Because the session is marked finalized first, a mid-sequence failure leaves a row flagged
complete with partial HubSpot state and no automatic retry.

## Cron

**Not in `railway-cron.json`.** Lead-gen finalization is `node-cron`, registered inline at
`*/10 * * * *` → `finalizeInactiveSessions(5, 50)` → `deliverPendingSummaries(5, 50)`. It
selects unfinalized sessions inactive >5 minutes with a company name and at least one
message, oldest first, capped at 50.

`deliverPendingSummaries` runs on **every** tick, including when no session was finalized.
It sends the stored summary to already-finalized sessions that went quiet 5 minutes to 24
hours ago and were never emailed, click or no click (the cron is an authorization path in
`sendLeadGenEmail`). Older ones are logged as `[PENDING-SUMMARY-STALE]` and never sent.
Until Nov 2026 an empty batch returned early and skipped it, so it rarely ran.

A comment records a past incident: email generation used to live in the cron loop and
produced mis-routed Starter pitches to `not_a_fit` leads. It is now consolidated inside
`finalizeLeadGenConversation`.

**Local development.** This registers on every boot including local dev, and fires on the
wall-clock 10-minute boundary — not 10 minutes after startup. When it runs it sends real
email and writes to HubSpot. `LEAD_GEN_FINALIZATION_DISABLED=true` is the opt-out, and it is
a **third** flag distinct from `LEAD_GEN_TEST_MODE` — which mocks HubSpot but not email. So
disabling the cron is the only thing that stops real mail to real prospects from a dev box.

`railway-cron.json` is the unrelated daily GetGranted DB sync.

## Behaviour worth knowing

- **The first message deliberately blocks up to 5 seconds.** `handleLeadGenChat` polls every
  250 ms waiting for background website extraction so the first turn has company context.
  Labelled "RACE CONDITION FIX" in source. Any latency work must account for this stall.
- **Intake categorization is deterministic and runs before the conversation.**
  `runIntakeCategorization` uses `skipHaiku` mode to write tier, product, and estimate at
  init. Failure is swallowed and logged as `[INTAKE-CATEGORIZATION-FAIL]`; the comment warns
  this silently recreates an empty-tier failure mode and names a monitoring query as an
  ongoing canary.
- **Lead-gen streaming is not the shared path.** `streamToSSE` buffers text instead of
  streaming when `agentType` is lead-gen, specifically to keep tool narration from leaking
  to a public visitor, and applies booking-link substitution at end-turn flush.
- **No empty replies.** When the model writes the reply alongside a tool call, the final
  step can be only the `<!--suggestions-->` comment. `streamToSSE` holds such a step back
  (`hasVisibleText`), and `runAgent` keeps the earlier substantive text (200+ chars) and
  flushes it with the suggestions, instead of replacing it. With no earlier text, the
  empty-response fallback runs. The widget's `formatAssistantMessage` shows a short
  "didn't come through" line rather than an empty bubble.
- **Cost caps are a first-class control** and live only in `src/api/lead-gen.js`. Tuning the
  model or iteration count spends against them; the failure mode is a 429 reading "We're
  experiencing high demand."

## Documentation elsewhere

Nothing in `docs/` covers lead-gen. What exists:
- `widget/README.md` — install and chat contract. Stale: no `/event`, which the current
  widget uses.
- `widget/DEPLOYMENT.md` — embed instructions. Same gap.
- `patches/client-js-lead-gen-context-injection.md` — ❓ currency unverified.
- Migration headers 011–014 — the most accurate schema documentation that exists, and
  already partly outdated relative to what `prospect_data` actually holds.

## Open items

- Tier *policy* (thresholds, the Pro gate) is pending the GetGranted launch; the mechanism is single-source since 2026-11-02
- A $0 baseline: the prompt still says not to manufacture estimates, so a pending lead with no dollar figure locks to Get Granted
- `lead_score` is model-emitted and never validated
- `lead-gen-variant-a.md` is dead but still on disk and still documented as live
- Two widget files on disk; live embed target unconfirmed
- Sentinel leaks logged but unfixed — prompt-side fix outstanding
- Stale "max 20 messages" comment against a constant of 12
- No retention policy for finalized conversations
