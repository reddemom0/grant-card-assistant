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

Seven tools, assembled by name rather than by spreading groups. The case opens with a
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

## Tier policy lives in four places

This is the most important thing on this page. Tier and product decisions are expressed in
four independent locations that do not agree.

| # | Where | What it decides |
|---|---|---|
| 1 | Variant-B prompt files | `lead_score` rubric (8 signals, −2 to +2), thresholds 10+ HOT / 5–9 WARM / 0–4 COOL, and a tier ladder |
| 2 | `data/rates/tier-rules.json` via `determineTier` in `src/services/grant-categorization.js` | `service_tier` — ordered rules through a hand-rolled condition evaluator; default fallback is `starter` |
| 3 | `computeBestFitProduct` in `src/api/lead-gen-helpers.js` | `best_fit_product` — **the value that actually governs the outcome** |
| 4 | `tierReminder` injected by `src/tools/executor.js` | Runtime guidance forbidding tier talk, pitches, and booking links for not-a-fit leads |

**`lead_score` is prompt-only.** Nothing in code computes, validates, or clamps it. The
model emits it in `save_lead_data` and it is stored as given.

**The thresholds disagree.** `$30K` appears in the prompt rubric and in
`determineServiceTier`, but `computeBestFitProduct` — whose output drives the booking link —
uses a single `$15K` threshold and never sees `$30K`.

**Hard disqualifiers** are in both layers. `tier-rules.json` lists four `not_a_fit` rules:
non-profit, not incorporated ≥1 year, pre-revenue, and fewer than 2 FTEs. The prompt
restates a readiness gate, and the executor injects the third layer at runtime.

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
by email with retry (HubSpot's eventual-consistency window), persist `best_fit_product`
locally **unconditionally**, PATCH the AI-derived properties, look up the company, and
create-or-update a Note attached to both.

**Email** — `sendLeadGenEmail` via the Gmail REST API (Railway blocks SMTP), branded
template, sent to the prospect. Authorization requires `cta_selected === 'email_summary'` by
**exact equality, not substring** — at least two sessions hold malformed blobs where a
closing tag was swallowed into the value, and a substring match would treat that corruption
as consent. Alternatives are a recorded summary-button click or the cron's `forceGenerate`.
Duplicate sends are blocked by a marker, with exactly one permitted "upgrade" send when the
earlier one was a cron fallback and a tailored body now exists.

**Partial failure** — every step degrades independently and continues: form submit, contact
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

- Tier policy expressed in four disagreeing places; `$30K` vs `$15K` threshold split
- `lead_score` is model-emitted and never validated
- `lead-gen-variant-a.md` is dead but still on disk and still documented as live
- Two widget files on disk; live embed target unconfirmed
- Sentinel leaks logged but unfixed — prompt-side fix outstanding
- Stale "max 20 messages" comment against a constant of 12
- No retention policy for finalized conversations
