# Oracle ↔ GG3: Use Cases for the Team

2026-09-28 · read-only investigation · builds on `oracle-gg3-investigation.md`

**Short version:** Oracle's logs show the team already asks it grant-data questions all the
time: about 45% of human conversations (roughly 390 of 875). Oracle answers them from a GG1
mirror that has not been refreshed since **2026-04-10**. The worst failures are counts and
inventory, "is it open?", and "is X in our database?". In each case Oracle either had no
access or gave a wrong number with confidence. Every v1 item, plus about 10 new ones, can be
built on `search-context` today. Match-explain, the review feed, and admin-side data (edit
history, tier visibility) are still blocked.

## Ranked use cases

Reachability:

- **Now:** buildable on `search-context` today. Oracle still needs the v1 tool before any of
  these work.
- **ME:** needs `REVIEW_FEED_TOKEN` (match-explain or review feed).
- **OPS:** needs the gg3-ai-service ops DB.
- **Jason:** needs admin or app-DB data that `search-context` omits.

| Rank | Use case | Serves | Job it does | Data needed | Reach | Value | Plan / evidence |
|---|---|---|---|---|---|---|---|
| 1 | Counts and reports: grants by industry, region, status, type or funder, with CSV to Sheets | Nat, Steph | Replace hand counts; give correct inventory numbers | status, industries/`eligibility_criteria.industry`, regions, grant_type, program_provider | Now | High | **v1**. Log theme 9 (wrong answers) |
| 2 | Completeness scan: blank cards, missing curated sections | Nat, Fadi, Souad/Kelly | Cut the 15–20 minute manual card check | `field_content` keys and lengths, amount, deadline | Now | High | **v1** |
| 3 | Contradiction check (e.g. $5k vs $4k vs $7k on one card) | Steph, Fadi | Catch internal inconsistencies | `grant_amount`, `contribution_percentage` vs numbers in `field_content` | Now | High | **v1** |
| 4 | Status/deadline audit: active with a past deadline, inactive with a future one | Nat, Fadi | Stop closed programs being shown or recommended | status, deadline, `rolling_intake`, `last_updated` | Now | High | **v1** (completeness). Log themes 1 and 7 |
| 5 | Bulk text hunt ("every SWPP with 70%") | Fadi, Souad/Kelly | Find every card needing the same fix | `field_content`, grant_name | Now | High | **v1** |
| 6 | Stale GG1 import text detector: old years, "recently changed" leftovers, GG1-era phrasing | Fadi, Steph | Flag imported text that needs rewriting | `field_content`, `last_updated` | Now | High | v1 (a bulk-search variant) |
| 7 | "Open now, what to market" list, with a live GG3 card per pick | Jade/marketing, Ruk | Grant blasts, blogs, webinars without closed picks | status, deadline, `rolling_intake`, `field_content` | Now | High | New. Log theme 3 (61 convs) |
| 8 | Guideline-vs-card diff: fetch the new guideline and compare to the card's current GG3 text | Souad/Kelly, Fadi | Program change detection and card updates | `field_content` plus web_fetch or Drive | Now (curated fields only) | High | New. Log theme 6 (failed on admin login and a missing mirror row) |
| 9 | Weekly "what changed in GG3" digest posted to a Chat space | Nat, Research, GCs | Team awareness of edits and status flips | `updated_since`, status, deadline | Now | High | New |
| 10 | Program change → affected active deals: status, deadline or VisualPing change × open HubSpot deals naming that program | Ruk, GCs | Warn deal owners before clients hit a change | search-context, VisualPing, HubSpot deals | Now | High | New (combination) |
| 11 | Client/role grant fit on live GG3 data, replacing the mirror for `search_getgranted` and lead enrichment | GCs, Ruk | Stop recommending closed or missing programs | regions, industries, `eligibility_criteria`, boosts, status | Now (needs search logic or a cache) | High | New. Log theme 1 (80 convs) plus 853 automated convs |
| 12 | Renewal/upsell prep: new or changed grants since the last call that fit this client | Ruk | Walk into renewals with fresh options | `updated_since` plus the HubSpot company's region/industry | Now | High | New. Several renewal-prep convs in the logs |
| 13 | Deadline radar per GC's client book: closing in N days × their HubSpot companies | GCs | Don't miss intakes | deadline, regions/industries, HubSpot owner | Now | High | New |
| 14 | Write findings into Fadi's fix-tracker sheet (deduped) | Fadi, Nat | Turn audits straight into work items | v1 output plus Sheets write (sheet ID needed) | Now | High | New |
| 15 | "Who do I report this to?", data-shape part: empty `field_content` → Fadi; empty `genre_scores`/`eligibility_criteria` → Chris; search-context error → Jason | Everyone | Route issues without guessing | search-context fields | Now (partial) | High | **v1.1** (partial) |
| 16 | Coverage check: "is X in our database?" against a list | Research, Ruk | Avoid duplicate cards; find gaps | grant_name, with fuzzy match | Now (watch the 700 cap and excluded titles) | Med | New. Log theme 8 (false "not in DB") |
| 17 | Tag audit and tag generation against current tagger scores | Fadi, Research, Chris | Review or propose tags against what GG3 already holds | `genre_scores`, `industries` vs `eligibility_criteria.industry` | Now | Med | **v1** (tag audits). Log theme 4 (34 convs) |
| 18 | Link to the live GG3 card | Everyone | Stop handing out GG1 links | `id` plus the GG3 URL pattern (from Jason) | Now (URL pattern needed) | Med | New. Log theme 5 |
| 19 | Program-rule answers from the team's own card text | GCs | Retroactivity, stacking, eligible-cost answers | `field_content`, `boost_attributes` | Now | Med | New. Log theme 2 |
| 20 | Check a post or email against the card | Marketing, Ruk | Accuracy before sending | `field_content`, amount, deadline | Now | Med | New. Log theme 10 |
| 21 | Coverage gaps by region, funder or industry | Nat, Steph | Research planning | regions, program_provider, industries | Now | Med | Part of **v1** reports |
| 22 | Low-confidence extraction triage | Chris, Fadi | Fix tagger inputs | `extraction_confidence`/`notes` | Now | Med | New |
| 23 | Match-explain: why grant X did or didn't surface for company Y | Steph, Chris, GCs | Diagnose match complaints | match-explain `verdict.kind`/`owner` | ME | High | **v1.1** |
| 24 | Full fix-owner triage (BAD_TAG / BAD_RECORD etc.) | Everyone | Settle "who owns this?" | match-explain verdicts | ME | High | **v1.1** |
| 25 | AI Final Review cut hotspots: grants often cut for wrong_region or wrong_industry | Chris, Fadi | Find likely bad tags | review feed or `ai_review_log` aggregates | ME / OPS | Med | New |
| 26 | Thumbs-down/dismiss hotspots and tagger failure history, grant-level only | Chris | Tagging and quality priorities | `grant_feedback`, `tagger_run_log` | OPS | Low–Med | New |
| 27 | Card edit history ("what was it before my edits?") | Souad/Kelly, Steph | Before/after for program changes | `grant_audit_logs`, `grant_changes` | Jason | Med | New. Asked in the RTRI Prairies audit conv |
| 28 | Tier visibility audit (fields hidden from Starter) | Steph | Product-truth check | `*_visibility_rules` joined to `roles` | Jason | Med | New |
| 29 | GG1↔GG3 reconciliation list | Steph, Chris | Migration closure | GG1 side (the mirror is stale) plus GG3, joined by name | Now for GG3; the GG1 side needs a fresh scrape | Med | New. Asked once and correctly refused |

## Step 1: Reachable data

**GG3 through ai-api-backend `search-context`.** Reachable from this machine with
`X-AI-Service-Token`. Oracle has no tool for it yet.

- It returns 17 keys per grant: `id` (grant_roots id), `grant_name`, `grant_type`,
  `program_provider`, `regions`, `industries` (human tags), `genre_scores` (tagger),
  `grant_criteria`, `grant_amount`, `contribution_percentage`, `deadline`, `best_practices`,
  `status`, `last_updated`, `boost_attributes` (18 keys, e.g. `rolling_intake`),
  `eligibility_criteria` (tagger, with `extraction_confidence`/`notes`), and `field_content`.
- `field_content` covers only 26 curated field keys, as flat HTML.
- Filters are `status[]`, `active_only` and `updated_since`. There is no per-id filter.
- The cap is 700 rows, with no pagination.
- Tier visibility, tab structure, admin fields and edit history are **not** included
  (`gg3-ai-service/gg3-grant-access-paths.md`).

**gg3-ai-service's own data (ops DB, owned by Chris).** Taken from migrations, not queried.

- `tagger_run_log`: success/error per grant, taxonomy and prompt version.
- `ai_review_log`: AI Final Review cut/move per grant, with category `wrong_industry` /
  `wrong_region` / `ineligible` / `off_goal`.
- `grant_feedback`: thumbs up/down, save, dismiss per grant.
- `grant_events`, `match_results`.
- **Review feed** (`src/lib/admin/review-feed.ts`) and **match-explain** both need
  `REVIEW_FEED_TOKEN`, which is not on this machine. The review feed returns cut/flag rows with
  `suspected_cause`, the engine evidence and the current tags, and about 61–68 rows per week.

**What Oracle reaches today.** The `internal-oracle` case of `getToolsForAgent` in
`src/tools/definitions.js`:

- The `ORACLE_TOOLS` array: `search_oracle_kb`, `get_visualping_alerts`,
  `check_blog_coverage`, `check_marketing_calendar`, `get_recent_granted_ca_post`,
  `search_recent_wins`, `search_getgranted` (the GG1 mirror), and
  `search_federal_grants_aggregate` / `_records`.
- Also: Google Drive, Dropbox, core HubSpot, Granola, Sheets read/write, Calendar,
  create_google_doc plus Docs edit, Chat history, tracked cards, web_search/web_fetch, and
  memory.
- **None of these reach GG3.**

**The GG1 mirror in production (queried live).** `grants` holds 598 rows: 537 `is_active`,
451 `currently_accepting`. `extracted_at` is all on **2026-04-10**, and there are **0 RTRI
rows**.

## Step 2: Log sweep

**Scope.** The Hub `messages` table joined to `conversations`, where
`agent_type='internal-oracle'`.

- **Range:** 2026-01-07 to 2026-09-26.
- **Volume:** 14,262 messages in 1,729 conversations. 3,606 user-role rows carry text; the
  rest are tool results.
- **853 conversations are automated HubSpot lead enrichment.** They made 333
  `search_getgranted` calls against the stale mirror. They are excluded from the themes below.
- **Human traffic:** 2,753 text messages in 875 conversations, including 63 Google Chat
  conversations since 2026-08-13.
- **Mirror usage:** 474 human-triggered `search_getgranted` calls across 196 conversations.
  About 2% returned zero rows or failed.

Theme counts use keyword matching on user messages under 1,500 characters, so they are
approximate and themes overlap. Examples are paraphrased with client and person names removed.

| # | Theme | Msgs / convs | Convs using mirror | Examples (paraphrased) | Answer quality |
|---|---|---|---|---|---|
| 1 | Grant fit for a client, lead or hire | 101 / 80 | 33 | "Any grants for a new-grad field role, not a student, BC?"; "What else could this manufacturer do besides CanExport?"; "Wage subsidy for mat-leave cover?" | **Poor on status.** Users came back with "all of the grants are closed", "most of these are inactive", "that program doesn't exist anymore", "don't suggest anything closed" (14 convs pushed back on closed or inactive suggestions) |
| 2 | Program rules (retroactivity, stacking, eligible costs, timelines) | 52 / 38 | 17 | "Is the youth program retroactive?"; "Can training go in a pivot budget?"; "Does this course qualify for ETG?" | Mixed. It leaned on web_fetch; in one conversation it could not see the card and apologized |
| 3 | Marketing: what's open to promote | 78 / 61 | 28 | "What grant for next week's email blast?"; "Grants to market that are currently open"; "Is CanExport open next week?" | Stale-risk. Uses `open_intakes_only` on April data |
| 4 | Tag/genre generation for cards | 39 / 34 | 17 | "Generate tags for [program]"; "Primary/secondary/tertiary genre for these grants" | Generates from scratch, with no comparison to GG3's existing `genre_scores`. Several conversations said "not in GetGranted", then fell back to the web |
| 5 | Grant card link / "give me the card" / write a card | 62 / 49 | 16 | "Give me the ETG card link"; "Where's the card for CIIP, is it active?" | Returns GG1 `app.getgranted.ca/grants/{id}` links. It cannot reach GG3 or admin |
| 6 | Program change vs card | 18 / 16 | 6 | "New guideline: any major changes vs our card?"; "What was different before my edits?"; "RTRI guide updated on the 21st, what changed?" | **Poor.** "Admin page requires login, I can't see the pre-edit card"; "RTRI isn't in GetGranted yet" (it is in GG3) |
| 7 | Is it open, active or closed | 37 / 33 | 20 | "Is it open now?"; "CFIN booster isn't open, should we remove it?" | Stale. The mirror's `is_active` is the GG1 label from April |
| 8 | Database coverage | 10 / 10 | 5 | "Is this program already in our database?"; "Which of these ~38 programs aren't in GG1?" | **Unreliable.** It said "not in GetGranted" for programs that are simply newer than the mirror. 21 conversations had "not in GetGranted / not synced" replies |
| 9 | Counts, inventory, master list | 9 / 8 | 4 | "How many active grants do we have?"; "Master CSV of every active grant"; "How many active in GG3?" | **Wrong.** It quoted "188+" from the tool description as fact, then built a CSV of 163 by sweeping 50-row pages; the user expected 206. The mirror actually has 537 `is_active`, and GG3 had 230 active in July. "Capped at 50" or "188+" appears in 64 assistant messages across 48 conversations |
| 10 | Is this post/email accurate? | 5 / 5 | 5 | "Confirm this CanExport deadline post is correct"; "Is this RTRI news post accurate?" | Checked against stale card data |
| 11 | GG1↔GG3 reconciliation | 2 convs | 1 | "Full GG1 active and inactive list for reconciliation against GG3; say so if you can't" | Correctly refused. It has no tool |

**Where the questions came from.** Grant questions come mostly through the web UI. The
Google Chat questions are dominated by RTRI rules and "what to market".

## Contradictions found

- **Tool description vs reality.** The `search_getgranted` description says "188+ grants,
  synced daily". Production has 598 rows, last extracted 2026-04-10. Oracle repeated "188+"
  to users as fact.
- **Two stale sync dates.** `oracle-gg3-investigation.md` and the committed
  `data/sync-log.json` say the last sync was 2026-03-12. Production actually ran later
  (April 10) and then stopped.
- **Wrong column in the prior report.** `oracle-gg3-investigation.md` lists `last_edited_at`
  as a mirror column. That column does not exist in the production `grants` table.
- **Two numbers the tool doesn't explain.** The mirror counts 537 active, but a
  50-row-capped sweep only surfaced 163, and users expected 206. GG3 had 230 active in July.

## Evidence

- **Queried live (Hub Postgres, read-only):** conversation and message volumes, the full
  Oracle message dump used for theming, and the mirror's freshness and RTRI count. Every
  query was a SELECT inside `BEGIN READ ONLY … ROLLBACK`.
- **Not called this session:** GG3, `search-context` and gg3-ai-service. Their fields come
  from the prior live call and the access-paths doc.
- **From code or docs only:** the ai-service tables (migrations), the review-feed shape, the
  Oracle loadout, and the Chat-conversation marker (the `Chat: ` title prefix set by
  `createConversation` in `src/api/chat-google.js`).
- **Not checked:**
  - Which team member asked what (`users` was not queried).
  - `lead_gen_conversations`.
  - Whether Railway's cron still runs the mirror sync.
  - The GG3 card URL pattern.
  - Current `search-context` corpus size against the 700 cap.
