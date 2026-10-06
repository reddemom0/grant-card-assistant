# Oracle ↔ GG3 v1: Pre-build Fact-check

**Date:** 2026-09-29. Read-only. No files, code, config or databases were changed.

## 1. Sheets: what Oracle can do

In `getToolsForAgent` (`src/tools/definitions.js`), the `internal-oracle` case spreads
`GOOGLE_SHEETS_READWRITE_TOOLS`. It does not spread `GOOGLE_SHEETS_CREATE_TOOLS`. The tools
are implemented in `src/tools/google-sheets.js` and dispatched from `src/tools/executor.js`:

- `read_sheet_range` (`readSheetRange`, `values.get`): read an A1 range.
- `read_sheet_metadata` (`readSheetMetadata`): read the title and list the tabs.
- `update_sheet_range` (`updateSheetRange`, `values.update`): overwrite an A1 range.
- `append_sheet_row` (`appendSheetRow`, `values.append`): add rows to the end of a table.
- `check_marketing_calendar` (in `ORACLE_TOOLS`): a read-only wrapper around the marketing
  calendar sheet.

**Oracle cannot create a spreadsheet or add a tab.** No `spreadsheets.create` or `addSheet`
batchUpdate is exposed to it. The only create tool is `create_advanced_budget`
(`createAdvancedBudget` in `src/tools/google-sheets-advanced.js`), and it only accepts budget
templates. It is wired only to canexport-writer, readiness-strategist and the orchestrator
(through `ALL_TOOLS`).

Auth is the asking user's own OAuth, via `getUserOAuth2Client` (`src/tools/google-docs.js`).
The `spreadsheets` scope is requested in `src/api/auth.js`. In Google Chat, `user.id` is the
sender, so a sheet written there is written as that person.

## 2. Sheets-related skills

Any agent can load any registered skill, and Oracle has `LOAD_SKILL_TOOL`, so Oracle can load
every row marked registered below.

| Skill | Path | What it does with Sheets | Oracle loadable? |
|---|---|---|---|
| `staff-meeting-recap` / overview | `.claude/skills/staff-meeting-recap/SKILL.md` | Writes the Oracle Notes column of a fixed spreadsheet ID using `update_sheet_range`. Each section is written in its own batch. | Yes |
| `rtri-tariff` / BUSINESS_PLAN | `.claude/skills/rtri-tariff/BUSINESS_PLAN.md` | Reads a budget sheet: metadata first, then each range | Yes |
| `hubspot` / DEAL_CREATION | `.claude/skills/hubspot/DEAL_CREATION.md` | Mode B: creates deals in batch from a spreadsheet, with a dry-run preview first. Read only. | Yes |
| `granted-marketing` / DATA_SOURCES | `.claude/skills/granted-marketing/DATA_SOURCES.md` | Points to `check_marketing_calendar` | Yes |
| `canexport-writer` / STAGE_1_BUDGET_GUIDE | `.claude/skills/canexport-writer/STAGE_1_BUDGET_GUIDE.md` | Guidance on the client budget template. Content only, no tool calls. | Yes (content only) |

**No skill in this repo builds or formats a new spreadsheet.** The user-level Claude Code
skills `xlsx` and `google-workspace` are under `~/.claude/skills/synced/…`. Oracle cannot load
them at runtime because they are not in `SKILL_PATHS`. There are no repo plugin folders.

## 3. Corpus size (live, **dev not prod**)

- **Host:** `https://gg3-ai-api-backend-development.up.railway.app`
- **Status names:** confirmed from code. `resolveGrantStatusFilter` (`grant-status-labels.ts`)
  checks labels against a catalog stored in the database, and an unknown label returns a 400.
  `gg1-gg3-closure-check.md` records an earlier HTTP 200 for these same four statuses.
- **`waitlisting`:** appears only in backend tests (`route-contract.test.ts`,
  `keys.test.ts`). Not confirmed in the dev catalog, and not sent.

**Result: HTTP 200, 681 rows**

| Status | Rows |
|---|---|
| active | 208 |
| inactive | 189 |
| archived | 279 |
| draft | 5 |
| **Total** | **681** |

All 681 ids are distinct. `last_updated` runs from 2025/11/25 to 2026/09/28. That leaves
**19 rows of headroom under 700**, so the result is **not truncated**, but the cap will be hit
soon.

**The real total is higher.** `EXCLUDED_TITLE_TOKENS` sits in the backend
(`grant-search-context-service.ts`). It is applied in SQL before the `LIMIT`, and again in JS
through `isExcludedGrantTitle`. It matches substrings, so `test` also drops titles containing
"contest" or "latest", for example. `liveGrantPredicate` also hides soft-deleted and non-live
versions.

Other notes:

- The response is cached (`remember`, keyed by version).
- `filters.active_only:false` returns every status in the catalog, which is a simpler way to
  ask for everything.

## 4. GG1 search callers

The chain is `searchGrants` / `searchByGenreScores` (`scripts/create-search-function.js`) →
`searchGetGranted` (`src/tools/getgranted-search.js`, Redis-cached) → tool `search_getgranted`.

**Live callers:**

- **Oracle tool (live):** `search_getgranted` is in `ORACLE_TOOLS`. Its handler is the
  `search_getgranted` case in `src/tools/executor.js`, which runs a standard search and returns
  grants to the model.
- **HubSpot auto-enrichment (live, `/api/hubspot-webhook` in `server.js`):**
  `src/api/hubspot-webhook.js` runs `internal-oracle` headlessly. Its prompt says to "Use
  search_getgranted with active_only=true (MANDATORY)".
- **Lead-gen (live):** the same executor case runs `runFocusedSearch`
  (`src/services/grant-search-pipeline.js`), which calls `searchByGenreScores` and
  `searchGetGranted`. The results are written to `conversation_memory` as `categorization`,
  `merged_estimate` and `auto_matched_grants`, and flow on to HubSpot.
  `src/api/lead-gen-init.js` does not search; it only categorizes.
- **Card, `matchProgram` (live):** `src/cards/watch-match.js`, reached from
  `src/api/chat-google.js`. Uses `include_inactive:true` and returns name, url, deadline and
  amount for watch cards.
- **Card, `programsToMention` (live):** `src/cards/lead-lookup.js`, reached from
  `src/cards/lead-card.js`. Returns up to 3 programs for lead cards.
- **`/search-grants` (live, `server.js`):** `search-grants-endpoint.js` calls `searchGrants`
  directly.

**Other live SQL on `grants`:**

- `server.js`: batch-retag, embeddings and the tagging endpoints
- `/import-grants`: runs `import-grants-endpoint.js`, which does `DELETE FROM grants` and
  requires a secret
- `src/api/admin.js`: `/generate-embeddings`

**Scripts only:** the `scripts/*` importers and taggers, `src/services/grant-tagger-batch.js`,
and the root one-off files (`batch-tag-*.js`, `diagnose-db.js`, and so on).

**Dead:** `api/admin-import-grants.js`, `api/admin-generate-embeddings.js` and
`api/import-from-file.js`. Their importers were not traced, but `api/` is mostly dead per
`CLAUDE.md`.

## 5. GG1 sync setup

- **Schedule:** `railway-cron.json` sets `0 10 * * *` (10:00 UTC, which is 2 AM Pacific). Its
  start command is `node scripts/sync-getgranted-database.js`. The alternative route is
  `RUN_MODE=sync` in `server.js`, which uses `execSync` on the same script.
- **Chain:** the sync script calls `node scripts/export-all-grants-by-id.js`, a Playwright
  scrape of `app.getgranted.ca`. It reads the env vars `GETGRANTED_EMAIL` and
  `GETGRANTED_PASSWORD`, and **has hardcoded fallbacks on this path** (values not printed).
  The DB write uses `DATABASE_URL`.
- **Probable cause of the April freeze (code inference, not verified):** commit `42186ec8`
  (2026-04-10) added `last_edited_at` to the sync's `INSERT` and added migration
  `018_add_last_edited_at.sql`. That column is missing in prod. The sync does `DELETE` and then
  inserts row by row inside one `BEGIN`. The first insert that fails aborts the transaction,
  and the `COMMIT` then silently rolls back. That would freeze the mirror at 2026-04-10.

## 6. Scheduled jobs

There are two patterns:

- **node-cron inside the web process (`server.js`):** lead-gen finalization every 10 minutes,
  `startChatListen` (`src/chat-listen/jobs.js`, hourly at :17) and `startTrackedCards`
  (`src/cards/jobs.js`, hourly at :05 and daily at 13:00). They use
  `{timezone:'UTC', noOverlap:true}`, a `guarded()` wrapper and a `*_DISABLED` env switch,
  and assume a single instance.
- **Separate Railway cron service:** used only by the GG1 sync.

HubSpot is driven by webhooks, not a scheduler. An hourly GG3 refresh fits the node-cron
pattern best: it would be one HTTP call, the same shape as the chat-listen and tracked-cards
jobs. The Railway cron exists because the Playwright scrape takes 30–45 minutes.

## 7. DB pattern

- **Location and naming:** `migrations/NNN_name.sql`, using `IF NOT EXISTS` with a header
  comment. Numbers 001–005 and 014 are duplicated. **The latest is
  `037_team_lessons_pending.sql`.**
- **Applying:** it is manual, with `node migrations/run-migration.js <file>` (its verify step
  is hardcoded to `conversation_memory`) or the authenticated `GET /run-migration?file=` route.
- **Nothing runs migrations on deploy.** Migration 018 not being applied to prod shows this.

## 8. GG3 links

**No GG3 grant-card URL pattern exists** in any of the three repos:

- This repo only has GG1 patterns, `app.getgranted.ca/grants/${id}` (in the scrapers and
  `import-grants-upsert.js`).
- `admin.getgranted.ai/<uuid>` appears only as asset URLs inside grant HTML in ai-service
  snapshots.
- The backend checkout has only API routes, with no frontend pages.

On the id: `search-context` `id` is `grantRoots.id` (the `id: row.grantRootId` mapping in
`grant-search-context-service.ts`, and `gg3-grant-access-paths.md` agrees). No URL was found,
so it's unconfirmed that the URL uses that id.

## Open questions / blockers for v1

1. The GG3 card URL pattern, and whether it keys on the root id. Needs Jason.
2. Oracle can't create sheets or tabs. That needs a new tool: `spreadsheets.create` plus an
   `addSheet` batchUpdate.
3. The dev versus prod host and token for Railway. Counts from prod are unknown.
4. Whether `waitlisting` is in the catalog.
5. The title filter hides real grants ("contest").
6. The hardcoded fallbacks mean GG1 credentials are still in the repo.

## Evidence

- **Live:** only the Step 3 counts.
- **From code:** everything else. The sync-freeze cause is an inference.
- **External calls:** two identical `POST` requests to the dev host
  `/api/v1/ai/grants/search-context`, body
  `{"filters":{"status":["active","inactive","archived","draft"]},"limit":700}`. Both returned
  HTTP 200. The first response was lost to a shell parsing error, so the request was re-run
  once. The response was counted from a temp file that was then deleted. No other network or
  database calls were made.
