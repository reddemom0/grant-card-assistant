# Oracle ↔ GG3 Connection: Investigation (2026-09-28)

Read-only investigation. No code, config or prompts were changed, and no database was
connected to. One live read call was made (see Evidence).

**Short answer:** Oracle has no connection to GG3 today. All its program data comes from a
GG1 mirror (the `grants` table), filled by a Playwright scrape of `app.getgranted.ca`. The
quickest way in is the ai-api-backend `search-context` endpoint. It's reachable from this
machine and one live call confirmed it works. It returns industry, region, funder, status,
deadline, tagger scores and `field_content` on every record. So aggregate reports, status
audits and completeness checks are easy once there's a client for it. Match-explain and the
matching engine are blocked on authentication.

## 1. Blueprints

- **`docs/oracle.md`** exists. It says nothing about where grant data comes from: no mention
  of GG1, GG3, the mirror or the sync. Its "Tool loadout" section only says `ORACLE_TOOLS (9)`.
- **`docs/platform-map.md`** does not exist.

## 2. Oracle's current grant data source (GG1 mirror)

**Where it comes from.** `scripts/sync-getgranted-database.js` runs
`scripts/export-all-grants-by-id.js`. That script logs into `https://app.getgranted.ca` with
Playwright and scrapes `/grants/{id}` plus `/admin/grants/{id}/edit_history`. It writes
`data/getgranted-all-grants-by-id.json`. The sync then does `DELETE FROM grants` and
re-inserts every row in one transaction.

After the insert, the sync runs these steps in order:

1. `applyCurrentlyAcceptingHeuristics`.
2. `reimportSmartTags`, which reads `smart-tags-export.json` from the repo root. That file
   was committed 2026-03-10.
3. `reimportGenreScores`, which reads `data/genre-scores-all.json`. That file is also
   committed.
4. `scripts/genre-tagger-incremental.js`.

**Schedule.** The sources disagree:

- `railway-cron.json` sets cron `0 10 * * *` (2 AM PT) with start command
  `node scripts/sync-getgranted-database.js`.
- In `server.js`, `RUN_MODE=sync` runs the same script once and exits.
- The header comment in the sync script says "weekly".
- The `search_getgranted` tool description says "188+ grants, synced daily".
- The committed `data/sync-log.json` shows the last success on **2026-03-12** (590 grants,
  527 active).

Not confirmed: whether a Railway service actually uses `railway-cron.json`, or when
production last synced.

**Tools that read the mirror.** All go through `searchGrants` in
`scripts/create-search-function.js`, via `searchGetGranted` in
`src/tools/getgranted-search.js` (Redis cache, TTL 1 hour):

- the `search_getgranted` tool in `ORACLE_TOOLS`, dispatched in `src/tools/executor.js`
- `src/cards/watch-match.js` and `src/cards/lead-lookup.js`
- the lead-gen agent, through `src/services/grant-search-pipeline.js`

`search_federal_grants_*` reads a different dataset, `proactive_disclosure_grants`.

**Columns.**

- From the sync insert: `grant_id` (a GG1 id), `grant_name`, `grant_type`, `grant_amount`,
  `url`, `regions`, `industries`, `program_provider`, `deadline`, `max_spend`,
  `contribution_percentage`, `difficulty`, `grant_criteria`, `best_practices`,
  `recently_changed`, `full_page_text`, `last_updated`, `extracted_at`, `is_active`,
  `intake_cycle`, `last_edited_at`.
- From migrations 004, 005 and 017: `currently_accepting`, `last_verified_at`,
  `exclusion_reason`, `embedding`, `smart_tags`.
- `genre_scores` is used in code but **no migration file creates it**.

There is no GG3 id and no status label; status is only the `is_active` boolean.

**GG3 calls from this repo.** There are none. Grepping for gg3, ai-api-backend,
search-context and X-AI-Service-Token finds only prose. The `/watch` entry in `DECISIONS.md`
requires that cards never name "GetGranted, GG3 or our database".

## 3. GG3 read paths

### a. `POST /api/v1/ai/grants/search-context` (ai-api-backend)

- **Code:** `src/app/api/v1/ai/grants/search-context/route.ts` and `getGrantSearchContext`
  in `src/server/services/ai/grant-search-context-service.ts`. The local checkout is on
  branch `feat/profile-write-phase1`, not main.
- **Base URL:** `AI_API_BACKEND_URL` in `gg3-ai-service/.env` points to
  `https://gg3-ai-api-backend-development.up.railway.app`. A production host,
  `gg3-ai-api-backend-production.up.railway.app`, appears in that repo's
  `.claude/settings.local.json`, but it was not used.
- **Auth:** header `X-AI-Service-Token`, which needs scope `ai:grants:search-context:read`;
  or a Clerk bearer token. The token file `~/.ai-api-backend-token` exists with mode 600.
- **Request:** `{filters:{status?:string[], active_only?:bool, updated_since?:"YYYY/MM/DD"}, limit?:int ≤700}`.
  Status defaults to `["active"]`.
- **Live result:** HTTP 200. The response is `{grants:[…]}` with these fields and types:

| Field | Type / shape |
|---|---|
| `id` | number (grant root id) |
| `grant_name` | string |
| `grant_type` | string |
| `program_provider` | string |
| `regions` | string[] |
| `industries` | string[] |
| `genre_scores` | `{scores (13 fields, each a map of genre to score), association_scores (13 entries of {total_score, association_pct}), scored_at}` |
| `grant_criteria` | string |
| `grant_amount` | number |
| `contribution_percentage` | string or null |
| `deadline` | string |
| `best_practices` | string or null |
| `status` | string (all 5 sampled rows `"active"`) |
| `last_updated` | string |
| `boost_attributes` | object, 18 keys (e.g. `rolling_intake`, `covers_salaries`, `turnaround_time_days`) |
| `eligibility_criteria` | `{size, stage, industry, business_type, ownership_demographics, extraction_confidence, extraction_notes, prompt_version, extracted_at}` |
| `field_content` | map of curated keys (e.g. `grant_overview_2`, `general_requirements_2`, `eligible_expenses_2`) |

- **Status labels** come from a DB catalog. Code and tests reference active, inactive and
  waitlisting. The ai-service reconciliation of 2026-07-29 counted active 230, inactive 145,
  archived 280, draft 1: **656 in total**.
- The service silently excludes titles containing test, demo, sample, template, `[inactive]`,
  `(pending)` and similar markers (`EXCLUDED_TITLE_TOKENS`).

### b. gg3-ai-service endpoints (from code only)

- **`/api/v1/ai/{chat, recommend-grants, conversations, format-field, feedback, grant-events, reviews/prewarm, admin/beta-stats}`:**
  need a Clerk RS256 JWT, and the `sub` claim is the GG3 user. `recommend-grants` takes no
  profile in the request; it reads the caller's own profile. Its response shape is documented
  in `docs/ai-service-endpoints-live.md`.
- **`GET /api/v1/ai/internal/review-feed?days=1-14`** and
  **`GET /api/v1/ai/internal/match-explain?grant_id=&company_id=&track=`:** use a static
  bearer, `REVIEW_FEED_TOKEN`. If that token is unset the routes return 404. **The token
  isn't stored anywhere on this machine.**
  - Match-explain takes a GG3 `companies.id` that must have a match run in the last 180
    days; otherwise it returns 422. `track` must be one of the 12 canonical goals.
  - It makes no LLM calls and reads the database inside a READ ONLY transaction.
  - It returns `stages`, `eligibility.axes`, `current_tags`, `profile_used`, `not_modelled`
    and `known_limits`, plus a `verdict` with
    `{kind, owner, summary, next, would_pass, independent_blockers}`. `kind` is one of
    SURFACED, CORRECT_REJECTION, BAD_TAG, BAD_RECORD, FILTERED_IN_TAIL,
    LANGUAGE_TWIN_DROPPED or NO_TRACK_GENRES.

### c. Stored Postgres credentials (existence only; not connected)

- `gg3-ai-service/.env`:
  - `JASON_READ_DB_URL`: the username looks read-only.
  - `DATABASE_READONLY_URL`: the username looks read-only, but the match-explain SKILL.md
    says it is malformed.
  - `DATABASE_URL`: the ai-service's own ops DB.
- `~/.gg3-app-db-url`: username looks read-only; file dated Sep 16.
- `~/.gg3-db-url`: the ai-service ops DB, per its docs.
- There is no `~/.pgpass`.

## 4. Can a "grant count by industry" report be built from 3a alone?

Yes. Industry, region, funder, status and deadline are populated on every sampled row, and
genre/goal tags are in `genre_scores`. Two cautions:

- **Record cap:** there is **no pagination**. The default and maximum are both 700, rows are
  ordered by `updated_at` descending, and the whole corpus was 656 in July. Once it passes
  700, the oldest-updated grants will silently drop out.
- **`industries` vs `eligibility_criteria.industry`:** `industries` comes from
  human-applied GG3 tags, while `eligibility_criteria.industry` comes from the tagger. Pick
  one deliberately.

## 5. What Oracle could serve

| Use | Rating | What's missing |
|---|---|---|
| Aggregate reports (industry, region, status) | **Easy** | A new tool, a token env var in Railway, and a guard for the 700 cap |
| GG1↔GG3 reconciliation against an ID list | **Needs work** | GG1 and GG3 ids don't overlap (GG1 36–7505, GG3 907–1823), so the join has to be by normalized name, as in `gg1-gg3-reconciliation.md`. The mirror can supply the GG1 side, but it may be stale |
| Card completeness (`field_content`) | **Easy** | Nothing beyond the tool. Limit: only curated keys are returned, and the JSON can't show whether prose is truncated inside the source |
| Tag audits (tagger scores per grant) | **Easy** for the scores | Tagger failure history (`tagger_run_log`) is only in the ai-service DB |
| Answering questions from live GG3 instead of GG1 | **Needs work** | Search and filter logic over the payload (about 17KB per grant), or a cache table. `DECISIONS.md` also forbids naming the source in cards |
| Running GG3 matching for a client or lead | **Blocked** | Needs a Clerk JWT for a GG3 user; leads and HubSpot clients have no GG3 profile |
| Match-explain | **Blocked** | `REVIEW_FEED_TOKEN` isn't available here, and the company needs a match run in the last 180 days. When it runs, `verdict.kind`/`owner` gives the cause, and `stages`/`eligibility.axes` show which axis blocked it |
| Issue-ownership triage | **Needs work** | Signals only partly separate the owners (below) |

**Ownership signals:**

- **Grant data (Fadi/GCs):** BAD_RECORD, or FILTERED_IN_TAIL with the `must_haves` tail;
  empty `field_content`; wrong `status` or `deadline`.
- **AI layer (Chris, gg3-ai-service):** BAD_TAG, `no_sidecar`, NO_TRACK_GENRES, or empty
  `genre_scores`/`eligibility_criteria`.
- **Backend (Jason, ai-api-backend):** no verdict ever names Jason. Backend faults appear
  only as errors: 502 `profile_unavailable`, 422 `company_mismatch`, or search-context
  failing.
- **Frontend:** not visible anywhere.

Where it is ambiguous:

- BAD_RECORD ("absent from corpus") could be Fadi's data, the backend's title/status
  filters, or the 700 cap.
- The owner label "research / tagger" mixes Fadi and Chris.
- The `genre_zero` tail is explicitly "undetermined".

## 6. Other uses the data supports

1. Deadline radar: programs closing in the next N days, by region.
2. A weekly diff of what changed, using `updated_since`.
3. A `/watch` feed from GG3 status changes, so it no longer depends on scraping.
4. Funder coverage: counts by `program_provider`, and gaps by region.
5. Low-confidence extraction triage, using `extraction_confidence` and `extraction_notes`.

## Evidence

- **Verified live:** one call,
  `POST https://gg3-ai-api-backend-development.up.railway.app/api/v1/ai/grants/search-context`
  with body `{"filters":{"status":["active"]},"limit":5}` and the `X-AI-Service-Token`
  header. It returned HTTP 200. Field names and shape come from those 5 rows; record contents
  were not read. No database connections and no other network calls were made.
- **From code and docs only:** everything else, including the 656 total and status counts
  (from the ai-service reconciliation doc of 2026-07-29), the production sync schedule, and
  match-explain behaviour.

**Gotchas:**

- `scripts/export-all-grants-by-id.js` has a **hardcoded fallback login email and password**
  for `app.getgranted.ca`. They're used when `GETGRANTED_EMAIL`/`GETGRANTED_PASSWORD` are not
  set.
- The mirror's `genre_scores` comes from a local file on a different taxonomy version, not
  from GG3's sidecar.
