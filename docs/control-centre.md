# Control Centre — data layer

The Control Centre reads two databases. It never writes to either one. This doc covers the
connections, the rules that decide what counts as "live", the Hub-side roll-ups and review
queue, and the known limits of the data. There's no UI yet.

Code: `src/control-centre/` — `db.js`, `health.js`, `identity.js`, `live-sources.js`,
`rollup.js`, `review-queue.js`, `review-routes.js`.
Tests: `tests/unit/control-centre-*.test.js`.

## The two connections

| DB | What it is | Env var | Role |
|---|---|---|---|
| **app** | GetGranted's ai-api-backend Postgres (companies, users, grants, watchlists) | `APP_DB_READONLY_URL` | `read_user` |
| **ops** | gg3-ai-service Postgres (chat_turns, conversations, match_results, events, …) | `GG3_OPS_DB_READONLY_URL` | `oracle_readonly` |

The ops connection is the existing pool in `src/services/gg3-ops-db.js`, so it isn't copied
here. Its runbook is `docs/runbooks/gg3-readonly-access.md`, and it can see only six tables.

Every query goes through `runReadOnly` in `db.js`, which applies three layers of protection:

1. The role itself can only `SELECT`.
2. Every session opens with `default_transaction_read_only=on`.
3. Every query runs inside `BEGIN READ ONLY` with `SET LOCAL statement_timeout = 10000`,
   and is rolled back on any error.

On top of that, `getAppReadPool` refuses a URL that logs in as `postgres`. Superuser URLs,
including `~/.gg3-db-url`, never go in code.

Logs name the statement and the error code only. They never include params, SQL text or
driver messages.

If an env var is unset, the matching helper throws `NotConfiguredError` (code
`not_configured`). The Hub keeps running.

### Health

`GET /api/control-centre/health` is admin only. It runs `SELECT 1, now()` on each DB and
returns:

```json
{ "app": { "ok": true, "server_time": "…", "ms": 41 },
  "ops": { "ok": false, "error": "not_configured" },
  "checked_at": "…" }
```

It returns 200 when both DBs are ok and 503 otherwise. Errors are reported as a Postgres
code or error name only. The body never contains a URL, host, role or driver message.

## Live-source rules

All of these read the app DB. Each helper takes an injectable `query`, so tests run on
fixtures.

### Identity — `identitiesForClerkIds(clerkIds)`

The ops DB knows people only by their Clerk id (`user_…`). The mapping is:

- `users_clerk.clerk_id` gives `user_id`.
- `company_users.user_id` gives `company_id`.

Soft-deleted rows are ignored on both sides. Each company is chosen in this order:

1. The membership marked `primary`.
2. Otherwise, the user's only membership.
3. Otherwise `null`. All memberships are always listed in `company_ids`.

The lookup is one batched query, so it serves a single chat and an events page equally well.

### Company profile — `companyProfile(company_id)`

Returns the profile **as the matching engine sees it**, followed by everything else on record.

| Field | Engine reads (default) | Also on record |
|---|---|---|
| Industries | `company_metadata.primary_industries` (jsonb array) | `company_industries` → `industries` |
| Province / regions | `company_metadata.provinces` (comma-separated varchar, split) | `company_regions` → `regions`, and `headquarters_province` |
| Size | `employee_range`, else `num_employees` | — |
| Revenue | `recurring_revenue_range`, else `annual_revenue` | — |

The result also includes:

- `differs.industries` and `differs.regions` are true when the engine's source and the other
  source disagree. They are compared as case-insensitive sets.
- `empty_for_engine` lists every engine field that's empty: `industries`, `provinces`,
  `employee_count`, `annual_revenue`.

**The source is set by one switch.** The `ENGINE_PROFILE_SOURCE` constant in `live-sources.js`
defaults to `'company_metadata'`, which is the agreed rule and matches ai-api-backend `main`.

ai-api-backend `origin/release/1.2.2` (`toAiProfile`) reverses the priority. It reads
`company_industries` / `company_regions` first and falls back to the metadata columns. Once
that release is confirmed in production, set the constant to `'company_tables'`.

This matters for real companies. Company 48 has three `primary_industries` but only one
`company_industries` row.

### Live grants — `liveGrant(root_id)`, `liveGrants()`

A grant is live when all three of these hold:

- `grants.id = grant_roots.live_version`
- `grants.deleted_at IS NULL`
- its status is `active` in the **grant** scope: `statuses.label = 'active' AND scope_id = 1`.
  Scope 2 holds application statuses, and one of those is also called `draft`.

Root ids are the stable identity. Watchlists and the engine use them. `grants.id` identifies
one version. `liveGrant` returns `null` when the root has no live version. On 2026-10-14
there were 212 live grants.

### Watchlist — `watchlist(company_id)`

`watchlists` joined with `watchlist_grants`, both excluding `deleted_at`. Results are grouped
per watchlist, and empty watchlists are kept.

**`watchlist_grants.grant_id` is a `grant_roots.id`** (it has a foreign key to grant_roots),
not a grant version. Each entry is joined to its live version using the rule above and
returned with `is_live`, `live_grant_id` and `title`.

`company_watchlist` and `company_watchlist_grants` are a separate pair. The second is empty,
so the helper doesn't read either.

## Daily roll-up tables (migration 043)

The ops DB deletes match_results after 180 days. A nightly job,
`src/control-centre/rollup.js`, copies what Control Centre needs into three Hub tables first,
so day, week, month and year ranges keep working after the source rows are gone.

`day` is always the calendar date in **America/Vancouver**. Each day is read as
`[00:00, next 00:00)` Vancouver time, which stays correct across daylight-saving changes:
2026-11-01 is a 25-hour day. Every table has `created_at` and `updated_at`.

### `cc_daily_matches`
**Source:** ops `match_results` + `ai_review_log`.
**Key:** `(day, company_id, grant_id, section)`.

| Column | Meaning |
|---|---|
| `grant_id` | grant **root** id (match_results always stores roots) |
| `section` | track name, or `funding_matches` |
| `times_computed` | distinct result sets that included the grant, shown or not |
| `times_shown` | distinct result sets that showed it |
| `best_position` | lowest **0-based** position when shown (0 = top); null if never shown |
| `best_score` | highest `match_score` across all computed rows, not only shown rows |
| `eligibility` | from the latest row that day |
| `ai_review_action` | latest AI review action (`cut`, `flag`, `moved_up`, `moved_down`); null if none |

A review is matched to its match row on result set, grant and `section = track`. It is
counted on that match's day and company, even when the review itself lands just after
midnight.

### `cc_daily_views`
**Source:** app `grant_view_sessions`.
**Key:** `(day, company_id, grant_root_id, source)`, where `source` is
`presentation_context->>'source'`.

| Column | Meaning |
|---|---|
| `sessions` | grant-detail view sessions started that day |
| `visible_seconds_capped` | total visible seconds, with each session capped at 600 s |
| `median_visible_seconds` | median of the capped per-session seconds |
| `users` | distinct app users |

### `cc_daily_ratings`
**Source:** app `grant_recommendation_feedback_events`.
**Key:** `(day, company_id, grant_root_id)`.

| Column | Meaning |
|---|---|
| `ups` | events that rated the grant up that day |
| `downs` | events that rated it down |
| `changed` | events that replaced an earlier rating (`previous_rating` set) |

These count rating **events**, not each user's final rating.

### What's excluded

Exclusions are applied before aggregation. The tables keep no user ids, so excluded rows
can't be added back later.

- **Ops rows:** only real Clerk users (`user_…`) are kept. This drops the smoke, probe,
  profile and stability test harnesses, which make up about 30% of match_results.
- **Staff are kept.** During beta, staff and client usage are deliberately blended, so the
  roll-up ignores `GG3_INTERNAL_USER_IDS`. Pulse still excludes staff. Because the tables
  hold no user ids, staff rows written now can't be separated out later. If staff need to be
  excluded in future, re-run the affected days with the filter added. Upserts never delete,
  so keys that belong only to staff would also have to be removed by hand.

### Re-runs

Every write is an **upsert on the key. Nothing is ever deleted.**

- Re-running a day refreshes its rows and catches rows that arrived late.
- Re-running a day that has already aged out of the source leaves the stored rows untouched.
- If a re-run no longer produces a key (for example, because a filter was added later), the
  old row for that key stays.

Each day is written in its own transaction. If one day fails, the error code is logged and
the remaining days still run. Logs show days and counts only.

### Schedule

The job runs nightly at **03:00 America/Vancouver** and re-runs the **last 3 days**, so rows
that arrive late are still counted. It is off unless **`CC_ROLLUP_ENABLED=true`** is set on the
Railway service, and it also needs `APP_DB_READONLY_URL` and `GG3_OPS_DB_READONLY_URL`. It
uses the same node-cron scheduler as gg3-refresh, with `noOverlap`, and doesn't run at
startup.

### Running it by hand: `scripts/cc-rollup.mjs`

```
node scripts/cc-rollup.mjs                     # dry run, last 7 days (default)
node scripts/cc-rollup.mjs --days 3            # dry run, last 3 days
node scripts/cc-rollup.mjs --backfill          # dry run, 2026-08-26 → today
node scripts/cc-rollup.mjs --backfill --write  # upsert everything into the Hub DB
```

A dry run is the default and writes nothing. Only `--write` touches the Hub DB. The local
`.env` `DATABASE_URL` is the **production** Hub DB, so `--write` from a laptop writes to
production. The script prints per-day source-row and output-row counts.

## Review queue (migration 044)

Staff review bad matches and bad chat answers in one queue in the Hub DB. Code:
`review-queue.js` (logic, sweep) and `review-routes.js` (API). Diagnosis is a stub until
step 5.

### Tables

| Table | What it holds |
|---|---|
| `cc_review_items` | One row per thing to review. `kind='match'` is keyed on `(company_id, grant_root_id)`. `kind='chat'` is keyed on `chat_turn_ref`. Both keys are partial unique indexes. |
| `cc_review_flags` | Each flag on an item. `source_ref` is UNIQUE, so re-sweeps never double-count. `source_created_at` is the source event's own time. |
| `cc_review_events` | The audit log. Every mutation writes one row: `created`, `flagged`, `reopened`, `diagnosed`, `status`, `owner`, `closed`. |

Status runs `new` → `diagnosed` → `in_progress` → `closed`. Only `close` reaches `closed`.
A match item can't close without `expected_match` (`should` / `shouldnt`). It's optional
for chat.

### Flags

| Source | `source_ref` | `actor` |
|---|---|---|
| `client_thumbs_down` | the app rating's uuid | Clerk id |
| `staff_flag` | `staff:<uuid>` | staff email |

`addFlag` creates the item on its first flag and bumps `flag_count` on each new one. A
duplicate `source_ref` changes nothing, not even on a closed item. A new flag on a
**closed** item reopens it to `new`, sets `flagged_again`, and clears the owner, diagnosis,
narrative, client notice and close fields. The old close stays in the events log.

### Owners (`OWNER_ROUTING`)

| Owner | Fixes |
|---|---|
| `client` | company profile |
| `research` | grant data / card copy |
| `chris` | tagger, engine, chat answers; **default when the cause is unclear** |
| `jason` | app bugs |

### Where client 👎s come from

App `grant_recommendation_feedback_events`, the same table as `cc_daily_ratings`.

- A 👎 is `rating = 'down'`. A CHECK allows only `up` / `down`.
- `grant_root_id` is a root id.
- The row's uuid `id` is the `source_ref`.
- The row holds the app's integer `user_id`, so the Clerk rule (`user_…` only) is applied
  through `users_clerk`. This drops legacy `old-u…` accounts.
- Ratings carry no comment.
- A 👎 later changed to 👍 stays in the queue. There's no auto-close.

Chat items come only from staff flags for now. There's no client chat 👎 source.

### Hourly sweep

`runReviewSweep` reads 👎s newer than the latest `source_created_at` already filed, minus a
1-hour overlap that `source_ref` dedupes. On the first run it reads every 👎. It then files
each one as a flag and runs diagnosis on every `new` item. While `diagnose` returns `null`,
items stay `new`.

It runs hourly at :17 America/Vancouver with `noOverlap`, only when
**`CC_REVIEW_SWEEP_ENABLED=true`** and `APP_DB_READONLY_URL` is set. Logs carry counts and
error codes only.

```
node scripts/cc-review-sweep.mjs           # dry run: how many 👎s it would file
node scripts/cc-review-sweep.mjs --write   # file them and diagnose
```

The dry run reads the Hub DB only for the cursor and the refs already filed. The local
`.env` `DATABASE_URL` is **production**, so point it elsewhere before using `--write` to
test.

### API — `/api/control-centre/review`

Behind `authenticateUser` + `requireAuth`. Every signed-in staff member has full access,
with no admin check.

| Route | Does |
|---|---|
| `GET /` | `?status=&owner=&kind=`, most recently updated first (a re-flag or any change moves an item up), with `flag_count` and `latest_comment` (max 500) |
| `GET /:id` | item, flags and events, plus `names`: Clerk actors → company name (via `identity.js`), staff emails → Hub `users.name` |
| `POST /flag` | staff flag `{kind, company_id, grant_root_id | chat_turn_ref, comment}`; actor is the signed-in email |
| `PATCH /:id/status` | `{to}`; `closed` is refused (use close) |
| `PATCH /:id/owner` | `{owner}`; `null` clears it |
| `POST /:id/close` | `{expected_match, close_note}` |

Bad input returns 400, an unknown id 404, closing twice 409. A 503 (`not_configured`)
comes back only when the app DB is needed and unset. Client names aren't in the app DB
(`users` has no name or email), so clients are shown by company.

### Diagnosis (step 5)

`diagnose(item)` returns `null` for now. Step 5 fills it in with match-explain's bad-match
mode plus an Oracle narrative. It returns `{owner, diagnosis, narrative, client_notice}`.
`runDiagnosis` then records those and moves the item to `diagnosed`. It runs outside the
transaction, and the result only lands if the item is still `new`.

## Known limits

- **History starts Aug–Sep 2026.** The ops tables hold nothing earlier, so trends can't reach
  back past that.
- **match_results keeps 180 days.** Older matches are deleted, so a long-range match history
  isn't possible from this source.
- **`chat_turns.company_id` is mostly empty.** Resolve the company from `user_id` (Clerk) with
  `identitiesForClerkIds` instead.
- **Size and revenue are mostly ranges** (`"5-10 employees"`, `"$500k-$1M CAD"`), not numbers.
  The numeric columns are a fallback and are usually null.
- **One company per user today.** The identity helper still handles several memberships.
