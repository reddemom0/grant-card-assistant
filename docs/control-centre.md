# Control Centre — data layer

The Control Centre reads two databases. It never writes to either one. This doc covers the
connections, the rules that decide what counts as "live", the Hub-side roll-ups and review
queue, the `/control-centre` page (Overview live, other tabs coming), and the known limits
of the data.

Code: `src/control-centre/` — `db.js`, `health.js`, `identity.js`, `live-sources.js`,
`rollup.js`, `review-queue.js`, `review-routes.js`, `diagnosis.js`, `overview.js`,
`overview-routes.js`. Page: `control-centre.html`, `public/js/control-centre.js`,
`public/css/control-centre.css`.
Tests: `tests/unit/control-centre-*.test.js`.

## The two connections

| DB | What it is | Env var | Role |
|---|---|---|---|
| **app** | GetGranted's ai-api-backend Postgres (companies, users, grants, watchlists) | `APP_DB_READONLY_URL` | `read_user` |
| **ops** | gg3-ai-service Postgres (chat_turns, conversations, match_results, events, …) | `GG3_OPS_DB_READONLY_URL` | `oracle_readonly` |

The ops connection is the existing pool in `src/services/gg3-ops-db.js`, so it isn't copied
here. Its runbook is `docs/runbooks/gg3-readonly-access.md`, and it can see only seven tables
(`ai_review_log` among them, for the roll-up and grant-pattern cards).

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

## Review queue (migrations 044, 045, 047)

Staff review bad matches, bad chat answers and grant patterns in one queue in the Hub DB.
Code: `review-queue.js` (logic, sweep), `grant-patterns.js` (grant-pattern cards),
`diagnosis.js` (step 5 diagnosis) and `review-routes.js` (API). Oracle's chat-issue detector
(`src/services/pulse-roundup.js`) and its `log_issue` (`src/tools/gg3-conversations.js`) file
chat cards; Oracle reads the queue with `control_centre` (below).

### Tables

| Table | What it holds |
|---|---|
| `cc_review_items` | One row per thing to review. `kind='match'` is keyed on `(company_id, grant_root_id)`. `kind='chat'` is keyed on `chat_turn_ref`. `kind='grant_pattern'` is keyed on `(grant_root_id, pattern_category)` with no company. All three keys are partial unique indexes. |
| `cc_review_flags` | Each flag on an item. `source_ref` is UNIQUE, so re-sweeps never double-count. `source_created_at` is the source event's own time. |
| `cc_review_events` | The audit log. Every mutation writes one row: `created`, `flagged`, `reopened`, `diagnosed`, `diagnosis_failed`, `status`, `owner`, `closed`, and `recheck` (on a match card, when a pattern card linked to it closes). |
| `cc_review_links` | Related cards (047): `item_id` a grant-pattern card, `linked_item_id` a match card for the same grant root, `relation = 'same_grant'`. Unique per pair. |

Migration 045 adds the diagnosis columns to `cc_review_items`: `snapshot` (the frozen
evidence), `snapshot_at`, `diagnosis_attempts` (default 0) and `last_error`. Migration 047
adds `kind = 'grant_pattern'`, `pattern_category` (the AI review category of a pattern card),
`conversation_id` (the ops conversation of a chat card, when known), the two new flag
sources, and `cc_review_links`. 047 is idempotent (`DROP CONSTRAINT IF EXISTS` / `ADD`).

Status runs `new` → `diagnosed` → `in_progress` → `closed`. Only `close` reaches `closed`.
A match item can't close without `expected_match` (`should` / `shouldnt`). It's optional
for chat.

### Flags

| Source | `source_ref` | `actor` |
|---|---|---|
| `client_thumbs_down` | the app rating's uuid | Clerk id |
| `staff_flag` | `staff:<uuid>` | staff email (from Oracle's `log_issue`: the asker's email) |
| `ai_review_cut` | `ai_review:<ai_review_log id>` | the client's Clerk id |
| `oracle_detected` | `oracle:<conversation>:<issue>:t<turn>` (a conversation review) or `oracle:turn:<turn_id>` (a failed turn) | `system:oracle-chat-review` |

`addFlag` creates the item on its first flag and bumps `flag_count` on each new one. A
duplicate `source_ref` changes nothing, not even on a closed item. A new flag on a
**closed** item reopens it to `new`, sets `flagged_again`, and clears the owner, diagnosis,
narrative, client notice, close fields, snapshot and diagnosis attempts — so the next
diagnosis takes a fresh snapshot. The old close stays in the events log.

**Grant-pattern exception:** a closed pattern card reopens only on a cut whose
`source_created_at` (the cut's `occurred_at`) is **after** the card's `closed_at`. An older cut
that arrives late is still added as a flag (evidence, `flag_count` up, a `flagged` event with
`late_evidence: true`) but the card stays closed (`reopensClosed`).

A filer that already has the evidence (Oracle's chat cards) passes `snapshot` to `addFlag`;
it's stored only when the item has none — on creation or after a reopen. The HTTP route never
accepts one.

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

Chat cards come from Oracle (below) and staff flags. There's no client chat 👎 source.
`chat_turn_ref` is either the ops DB `chat_turns.turn_id` of one flagged turn (a staff flag
from the API) or `conv:<conversation id>:<issue>` (Oracle's cards: one card per issue per
conversation).

### Grant-pattern cards (migration 047)

The AI Final Review (gg3-ai-service, ops `ai_review_log`) cuts grants from a client's list
with a reason category (`wrong_industry`, `wrong_region`, `ineligible`, …). When it cuts the
**same grant for the same reason for 3+ distinct companies in 7 days**, the grant's own data is
the likelier problem, so `grant-patterns.js` files one card per `(grant root, category)`.

- **Read:** `CUTS_SQL`, ops `ai_review_log` where `action = 'cut'`, the last 7 days, real Clerk
  users only (`company_id LIKE 'user\_%'` — the column holds the Clerk id). Read-only.
- **Companies:** each Clerk id → company through the app DB (`identitiesForClerkIds`).
  Internal accounts count and are tagged in the evidence; a Clerk user with no company is
  filed as evidence but doesn't count toward the 3.
- **Flags:** every cut in a qualifying group is a flag (`ai_review_cut`, comment = the
  review's reason). A card that already exists keeps collecting its pair's cuts after the
  7-day count drops below 3.
- **Links:** every run inserts pattern × match pairs for the same grant root
  (`LINK_PATTERNS_SQL`, idempotent), so later match cards are linked too.
- **Closing a pattern card** writes a `recheck` event on every linked match card
  (`{pattern_id, message: "re-check — pattern #X was fixed"}`). The match cards aren't moved,
  reassigned or closed. A pattern card closes without `expected_match`.
- **Snapshot (diagnosis):** the grant's current tags (`grantTags`) and card text
  (`cardSections`) from the Hub's `gg3_grants` copy, and the newest 40 cuts behind the card,
  each with company name and internal tag, re-read by id from `ai_review_log`.
- **Owner routing:** `wrong_region` → research always (`region_list_wrong` or
  `card_missing_restriction` — region lists are backend data). Otherwise Sonnet reads the
  card: it states the restriction the tags missed → `tag_missed_restriction` → chris; it
  doesn't → `card_missing_restriction` → research; the reviews look wrong → `unclear` → chris.
  A grant missing from `gg3_grants` → `bad_record` → research.
- Runs inside the hourly sweep; a failure there (e.g. ops DB unset) is logged and never
  stops the 👎 path.

On 2026-10-15, 193 cuts in 7 days formed 57 grant/reason groups; 15 reached 3+ companies.

### Chat cards from Oracle's detector (migration 047)

The Pulse morning roundup (08:00 Vancouver, `src/services/pulse-roundup.js`) is Oracle's
chat-issue detector. It reads the last 24h of client chat (staff left out by
`GG3_INTERNAL_USER_IDS`): failed `chat_turns`, and each active conversation read once by Haiku
against a fixed rubric (asked again, pushed back, asked for a person, left unanswered). **The
grouping call is gone.** For a flagged conversation only, a second small Haiku call
(`locateFlagged`) names the client message whose reply went wrong, from a transcript with the
client messages numbered; an answer that isn't a shown message, or a failed call, falls back
to the last client message.

The review call itself is unchanged from before 047 on purpose. Putting message numbers or a
message field into it changed what Haiku flags: on 2026-10-15 the Oct 14 NYA Ventures
conversation (#290, `left_unanswered`, flagged 3/3 by the original prompt) was flagged 0/3 with
numbers plus the field. The original prompt plus the separate locate call flags it and picks
the right message (the client's question about the consulting engagement).

- **One card per issue per conversation:** `chat_turn_ref = conv:<conversation>:<issue>`. The
  issue is the review's main flag (asked for a person > pushed back > asked again > left
  unanswered), or `chat_broke` / `empty_reply` for a failed turn; all of a conversation's
  failed turns of one kind land on one card.
- **One flag per detection,** keyed on the flagged turn, so re-reviewing a conversation the
  next day adds nothing for a turn already filed. `source_created_at` is the conversation's
  last activity (or the failed turn's time).
- **Snapshot, frozen at filing:** the flagged client message, the 3 turns before it and the
  assistant's reply, **verbatim** (`chatTurnsAround` — no clipping; only the model's copy is
  clipped). A card that loses its snapshot on a reopen gets the conversation's last client
  turn and the 3 before it.
- **`company_id`** from the app DB when it can be resolved; `conversation_id` always.
- **Diagnosis** adds five required fields for every chat card, stored in `diagnosis.chat`:
  `client_asked`, `assistant_replied`, `what_was_wrong`, `good_answer` (only facts in the
  evidence), `suggested_fix`. Owner chris by default, research for `chat_wrong_grant_facts`.
- **The DM** lists the cards filed or added to this morning — name, client, Oracle's take,
  its suggested owner, and the card link — at most 5, then "…and N more", and ends with the
  Control Centre link. A run where every detection was already on file sends nothing.
- **Oracle's `log_issue`** (in `gg3_conversations`) files a chat card as a `staff_flag` from
  the asker for one of the client's conversations (`conv:<id>:staff_report`; repeat reports
  pile onto it), with the same verbatim snapshot, and returns the card link.

Dry runs (nothing filed, nothing sent): `node scripts/pulse-roundup-check.mjs [--hours N]`,
and for one conversation with its full card and the diagnosis it would get:
`node scripts/pulse-roundup-check.mjs --conversation <id> --diagnose` (prints client text —
keep it in your terminal).

### The errors sheet is retired

The Pulse errors Google Sheet (`PULSE_ERRORS_SHEET_ID`, written as `PULSE_SHEET_OWNER_EMAIL`)
is no longer read or written. `src/services/pulse-errors-sheet.js` is deleted.

- The morning roundup files chat cards (above) instead of sheet rows.
- The weekly digest's **Errors this week** reads the queue: chat and grant-pattern cards with
  a flag in the week (by `source_created_at`, else filing time), most flags first, each with
  its status, owner and card link (`WEEK_CARDS_SQL`). Its button opens the Control Centre; the
  "Digest YYYY-MM-DD" tab is no longer written (the themes are stored in 046's tables).
- Oracle's `troubleshoot` lists the chat cards already on file for the client's conversations;
  `log_issue` files a card.
- Neither job needs the two sheet variables any more; they can be removed from Railway. The
  sheet itself is left in place.

### Card links

`src/control-centre/links.js`: `cardLink(id)` = `${PUBLIC_URL}/control-centre#review/<id>`
(falling back to the production Hub URL, as `hubSignInUrl` does). The `#review/<id>` screen is
Part B; until then the link opens the Control Centre page. `card-summary.js` gives each card a
plain title (`cardTitle`) for messages and Oracle.

### Hourly sweep

`runReviewSweep` reads 👎s newer than the latest `source_created_at` already filed, minus a
1-hour overlap that `source_ref` dedupes. On the first run it reads every 👎. It files each one
as a flag, then runs the grant-pattern sweep (above), then diagnosis on every `new` item (see
Diagnosis below) — pattern and chat cards included.

It runs hourly at :17 America/Vancouver with `noOverlap`, only when
**`CC_REVIEW_SWEEP_ENABLED=true`** and `APP_DB_READONLY_URL` is set. Logs carry counts and
error codes only.

```
node scripts/cc-review-sweep.mjs                # dry run: what it would file + each item's proposed diagnosis
node scripts/cc-review-sweep.mjs --counts-only  # dry run, counts only (no snapshot, no Sonnet call)
node scripts/cc-review-sweep.mjs --write        # file them and diagnose
```

The dry run **writes nothing**: no Hub row and no `api_cost_events` row. It reads the Hub DB
(cursor, filed refs, `new` items, `gg3_grants`), the app DB, match-explain and the ops DB
(AI-review cuts, chat turns). It also calls Sonnet once per item: every `new` item, plus each
pair or grant pattern it would file or reopen. It prints each pattern group's action (file,
add evidence, add late evidence, reopen) and, for each pattern card, its companies. It prints each item's owner, verdict, narrative and client notice, and the
total Sonnet cost (priced, not logged). The local `.env` `DATABASE_URL` is **production**,
so point it elsewhere before using `--write` to test.

### API — `/api/control-centre/review`

Behind `authenticateUser` + `requireAuth`. Every signed-in staff member has full access,
with no admin check.

| Route | Does |
|---|---|
| `GET /` | `?status=&owner=&kind=`, most recently updated first (a re-flag or any change moves an item up), with `flag_count`, `latest_comment`, and `company_name` + `company_internal` beside `company_id` (max 500). If names can't be read (app DB unset or down), the list still returns with `company_name: null` and `names_error`; `company_internal` needs no database and is always set. |
| `GET /:id` | item (with `company_name`), flags, events and `links` (linked cards), plus `names`: Clerk actors → company name (via `identity.js`), staff emails → Hub `users.name` |
| `POST /flag` | staff flag `{kind, company_id, grant_root_id | chat_turn_ref, comment}`; actor is the signed-in email |
| `PATCH /:id/status` | `{to}`; `closed` is refused (use close) |
| `PATCH /:id/owner` | `{owner}`; `null` clears it |
| `POST /:id/close` | `{expected_match, close_note}` |

Bad input returns 400, an unknown id 404, closing twice 409. A 503 (`not_configured`)
comes back only when the app DB is needed and unset. Client names aren't in the app DB
(`users` has no name or email), so clients are shown by company.

### Diagnosis (step 5, migration 045)

Each `new` item gets one diagnosis per sweep. Code: `diagnosis.js` (never writes);
`runDiagnosis` in `review-queue.js` records the outcome in one transaction, and only if the
item is still `new`.

**1. Snapshot — the frozen evidence.** It's taken once, the first time the item is
diagnosed, and stored in `snapshot` / `snapshot_at`. Retries reuse it. A reopen clears it,
so the next diagnosis takes a fresh one.

| Kind | Snapshot |
|---|---|
| match | `GET {GG3_AI_SERVICE_URL}/api/v1/ai/internal/match-explain?mode=bad_match&grant_id=&company_id=` with `GG3_REVIEW_FEED_TOKEN`, with no track because ratings carry none. The whole JSON is stored: per-check results and how each passed, recorded runs, the AI review's notes, the card's eligibility text and a deterministic `candidate_cause` (gg3-ai-service `match-explain.md`, "Bad-match mode"). |
| chat | The flagged ops `chat_turns` row and the 3 user turns before it, cut from `conversations.messages`, verbatim. A turn starts at a string-content user message, the same count as `turn_index`. Read through `opsQuery` (`oracle_readonly`). Oracle's cards (`conv:` refs) arrive with it already taken. |
| grant_pattern | The grant's tags and card text from `gg3_grants` and the AI-review cuts behind the card with company names (see Grant-pattern cards). |

**2. Owner routing — code decides, Sonnet only chooses where the rule allows.**

| Case | Owner | Verdict |
|---|---|---|
| `PROFILE_GAP` | client | `profile_incomplete`, plus a `client_notice` starting "Tell the client to:" (required) |
| `RANKED_ON_GENRE` | chris | `ranked_on_genre` |
| `LOOKS_CORRECT` | chris | `looks_correct`. The owner confirms and closes it as should-match. |
| `NO_CONSTRAINT_TAG`, region check most suspect | research | `region_list_wrong` (the card states a narrower location than the listed regions) or `card_missing_restriction`. The region list is backend grant data, not a tagger output, so it never goes to chris. "Most suspect" means match-explain's first `lenient_axes` entry is `province`, e.g. the AI review blamed the region. |
| `NO_CONSTRAINT_TAG`, otherwise | chris or research | Sonnet reads the card text. If the card states the restriction the tags missed, it's `tag_missed_restriction` → chris (tagger). If the card doesn't state it, it's `card_missing_restriction` → research. |
| grant missing (`BAD_RECORD`) | research | `bad_record` |
| chat item | chris; research only for `chat_wrong_grant_facts` | `chat_answer_problem` / `chat_wrong_grant_facts` / `unclear`, plus the five chat fields (required) |
| grant pattern, `wrong_region` | research | `region_list_wrong` / `card_missing_restriction` |
| grant pattern, other categories | chris or research | `tag_missed_restriction` → chris, `card_missing_restriction` → research, `unclear` → chris |
| anything else (no cause, `not_passing_now`, a language twin, an unknown cause) | chris | any |

When the rule ties owner to verdict, the verdict decides. An owner or verdict the rule
doesn't allow is replaced, and `diagnosis.owner_override` records what was proposed and
what was applied. A `client_notice` is kept only when the owner is client.

**3. Sonnet call.** One per item: `claude-sonnet-5-5` with the tool `record_diagnosis`
returning `{owner, verdict, narrative, client_notice}`. Sonnet 5.5 rejects a forced
`tool_choice` (`tool` / `any`) and `temperature`, so the call uses `tool_choice: auto` with
a system prompt that requires the tool call. A reply without the call fails validation
(`bad_model_output:no_tool_call`) and is retried.

- The prompt gets the rule, the allowed owners and verdicts, staff flag comments, and a
  trimmed snapshot wrapped as data in `<evidence>`. The full snapshot stays in the DB.
- Validation:
  - the narrative must be 2–3 sentences, at most 70 words and at least 40 characters. Dots
    in abbreviations like "B.C.", "U.S.", "e.g." and "Inc." don't end a sentence;
  - the verdict must be from the list;
  - a client notice is required for client.
- **One corrective retry, same attempt:** a narrative over 3 sentences or 70 words is handed
  back once as a rejected tool result ("must be 2 or 3 sentences and at most 70 words…").
  - If the second reply passes, it's used, and `diagnosis.narrative_corrected` is set.
  - If not, the attempt fails as `bad_model_output:narrative_too_long`.
  - Any other bad output fails the attempt at once.
  - Both calls' cost is counted.
- Stored on success:
  - `diagnosis` = `{verdict, rule, candidate_cause, candidate_rule, evidence, owner_override?, model, snapshot_at}`, plus `match_explain_verdict` for match items when match-explain returned one, `pattern: {category, companies, internal_companies}` for pattern cards, and `chat: {client_asked, assistant_replied, what_was_wrong, good_answer, suggested_fix}` for chat cards;
  - `narrative` and `client_notice` go in their columns.
- Status becomes `diagnosed`, with a `diagnosed` event carrying `{owner, verdict}`.
- Cost is logged to `api_cost_events` with source `cc-review-diagnosis`, in write mode only.

**4. Failures.**

- What counts as a failure: a match-explain error (including a 422), an unreadable chat
  turn, a model error, or unusable model output.
  - The item stays `new`; `diagnosis_attempts` goes up by 1 and `last_error` gets the code.
  - The snapshot is kept if it was taken, and a `diagnosis_failed` event is logged.
  - The next sweep retries. Failures don't change `updated_at`, so retries don't float the
    item up the list.
- **The third failure** moves the item to `diagnosed`:
  - owner chris, verdict `could_not_diagnose`;
  - the narrative names the error in plain words ("…the match explanation service
    couldn't find this company's profile. Please check it by hand.").
- **Missing configuration is not a failure.** This covers no `GG3_AI_SERVICE_URL` /
  `GG3_REVIEW_FEED_TOKEN`, no `ANTHROPIC_API_KEY`, or no ops DB for a chat item. The item is
  left alone with no attempt counted, so an unset variable can't push every card to
  `could_not_diagnose`.

## The Control Centre page (step 6)

`/control-centre` is behind the same page sign-in as other Hub pages
(`authenticateUser` + `requirePageAuth`). Every signed-in staff member has full access. The
sidebar link is in `public/js/shared-layout.js`.

### Words on the page

The page uses platform language, not database names:

| Say | Not | Means |
|---|---|---|
| grant match | match shown | a grant card shown to a client on their goal tracks; each client counts once per grant |
| grant cards opened | grants opened | grant-detail view sessions |
| active clients | active companies | companies with any activity |
| goal tracks | sections | the per-goal lists on the client dashboard |

- Every chart's subtitle says in one plain sentence what a bar means.
- Every trend value carries its unit ("+65 grant matches", "+1 sign-up").
- Movers rows show before → now ("0 → 6") beside the change.

### Frame and URL

There are 7 tabs: Overview (the default), Inbox, Companies, Grants, Review queue, Coverage &
changes and Chat themes. Only Overview has content; the others show a "Coming soon" card.
Inbox and Review queue carry a badge with the count of review items that aren't closed.

All state is in the URL, so any view can be linked and the back button works:

| Param | Values |
|---|---|
| `tab` | `overview` (omitted), `inbox`, `companies`, `grants`, `review`, `coverage`, `themes` |
| `range` | `day`, `week` (default), `month`, `year` |
| `company` | companies.id, only with `tab=companies` |
| `grant` | grant **root** id, only with `tab=grants` |

The last range is also kept in `localStorage['cc.range']`, in try/catch, so the page works
without it. Search finds companies by name or id and live grants by title or root id.
Choosing a result deep-links to the Companies or Grants tab with it selected. Every grant row
on Overview links the same way.

### Ranges

Windows are whole **America/Vancouver** days, the same as the roll-ups. The current window
is the N days ending today, with today counted so far. The previous window is the N days
before it. Every number and chart compares the two.

| Range | N |
|---|---|
| Day | 1 (today so far vs yesterday) |
| Week | 7 |
| Month | 30 |
| Year | 365 |

### Overview API

`GET /api/control-centre/overview?range=day|week|month|year`, behind `authenticateUser` +
`requireAuth`. It returns 400 for a bad range and 503 (`not_configured`) when a database env
var is unset. Each range is cached in memory for **5 minutes**, and the response carries
`generated_at` and `cached`. Code: `overview.js`.

**Where the numbers come from:**

- **Roll-ups:** the `cc_daily_*` tables, for every day the roll-up wrote **after that day had
  ended** (Vancouver).
- **Read live:** every later day — today, a day rolled while still in progress, or a day the
  nightly job missed. These are read with the roll-up's own `readDay()` and aggregators, so
  the exclusion rule is identical: ops rows are real Clerk users only, and staff and clients
  are blended, never split.
- **Live tail limit:** at most 14 days are read live. Beyond that, `sources.stale_rollup` is
  true and the page says older days may be missing.

| Metric | Definition | Source |
|---|---|---|
| `signups` | companies created (not deleted) with ≥1 real Clerk user | app `companies` + `company_users` + `users_clerk`, live |
| `active_companies` | distinct companies with a match computed, a grant opened, a rating or a chat | roll-ups + chats through `identitiesForClerkIds` |
| `matches_shown` | distinct (company, grant) pairs shown | `cc_daily_matches.times_shown > 0` |
| `grants_opened` | grant-detail view sessions | `cc_daily_views.sessions` |
| `ratings_up` / `ratings_down` | rating events (changed minds count again) | `cc_daily_ratings` |
| `watchlist_adds` | `watchlist_grants` rows created, later removals included | app, live |
| `chats` | conversations by real Clerk users with ≥1 message | ops `conversations`, live |

**Distinct vs summed:** `matches_shown` and `active_companies` are distinct over the whole
window, not a sum of the daily values.

**Per metric:** `{current, previous, delta, delta_pct, series, previous_series, internal}`.
- The series have one point per day, with empty days as 0.
- `delta_pct` is null when previous is 0.
- `internal: {current, previous}` is how much of the number came from internal accounts.
  They're counted in the number itself too; the tile shows it as a sub-line ("211 matches
  shown · 140 internal").

**Also returned:**
- `need_action`: review items that aren't closed.
- `rankings.clients` and `rankings.all`: the same four blocks, built without and with internal
  accounts. The page uses `clients` unless "Include internal accounts" is on. Each block holds:
  - `most_matched`: top 10 grants by companies shown, with the change and opens.
  - `popular`: top 10 by opens, with watchlist saves.
  - `movers`: the biggest risers and drops in companies shown vs the previous window, plus
    `up_count` / `down_count`.
  - `trends.industries` / `trends.provinces`: matches and sign-ups gaining or losing. These
    come from `company_metadata.primary_industries` / `provinces`, the engine's source.
  - `open_sources`: grant card opens by where they were opened from, now vs before, as
    `{key, label, current, previous, delta, delta_pct}` for each of the five sources. The
    source is `grant_view_sessions.presentation_context->>'source'`, kept by the roll-up.
    Every open had one in the 60 days to 2026-10-15.

    | Shown as | Source value |
    |---|---|
    | Goal tracks | `suggested` (always carries a goal-track list, e.g. `track-0-hire-or-train-people`) |
    | Browse | `browse` |
    | Chat | `advisor` |
    | Watchlist | `watchlist` |
    | Other (direct links) | `direct`, and anything unknown |
- `internal_accounts: [{id, name, internal: true}]`: the list, named.
- `sources`: `last_rolled_day`, `live_days`, `stale_rollup`.
- Grant titles come from `liveGrants()`; a grant that isn't live shows as "Grant #id".

`GET /api/control-centre/search?q=` returns up to 8 companies and 8 grants as
`{type, id, name}`. An exact id match ranks first. Companies also carry `internal`.

**Cross-checked 2026-10-15** for the week Oct 9–15, against direct SQL on the source tables:
matches shown 211 = 211, grants opened 51 = 51, active companies 15 = 15.

**Company names.** Anything that shows a company names it first, with the id second, plus an
**Internal** tag when it's an internal account (`withCompanyNames` / `companyNamesForIds` in
`identity.js`).
- **Pages:** search results, the selected company, and the internal-accounts list in the
  Overview footnote.
- **APIs:** the review queue list and item return `company_name` and `company_internal`, and
  client actors on an item carry `internal`.
- **Later tabs** should use the same helper.

### Internal accounts

`src/control-centre/internal-accounts.js` holds `INTERNAL_COMPANY_IDS`: Granted staff and test
companies that Chris has confirmed. **Their data is kept everywhere;** the list only labels it.

| Where | What happens |
|---|---|
| Usage tiles | Count everything. A sub-line shows how much came from internal accounts. |
| A company's name anywhere | Shown with an **Internal** tag. |
| Grant lists and trends (movers, most matched, most popular, shifting trends) | Left out by default, because a staff member re-editing a test profile makes grants "move" for no client reason. The **Include internal accounts** toggle above the grant lists puts them back. It's remembered per browser in `localStorage['cc.includeInternal']`, in try/catch, and switches with no refetch. |

The list holds **28 companies**, all confirmed by Chris on 2026-10-15: Maximizer (#81), plus
every company in the table below. Add an id only after Chris confirms it.

**Week of Oct 9–15, clients only.** All of the previous week's (Oct 2–8) dashboard matching came
from internal accounts. With the toggle off, every grant's "before" is 0, so the movers show 52
risers and **no drops**. That is real: no client company was matched that week. It isn't a bug.
Turn the toggle on to see the full picture.

**How they were found** (scan of 2026-10-15, all now confirmed). The evidence:
- **Staff:** grant views made under an internal session role (sysadm / staff). This is the app
  DB's session role, not `users.role_id`, which is unreliable; the app DB holds no emails.
- **High activity:** at least 5× the median over the last 30 days. The median was 3 dashboard
  match runs and 5 grant views.
- **Test-like name.**
- Profile churn couldn't be measured, because the app DB keeps one profile row per company.

| Company | ID | Evidence |
|---|---|---|
| Med tech in AB | 1 | staff: 14 views as sysadm, 7 as staff; 20 match runs in 30 days |
| Cedar Labs 2 | 5 | staff: 12 views as sysadm; 19 match runs in 30 days |
| Small Point Consulting | 48 | staff: 5 views as staff; 37 match runs in 30 days (4 users) |
| Fadi's company | 51 | staff: 13 views as staff |
| Nats Test Company | 24 | staff: 4 views as sysadm; test-like name |
| Erics Antique Treasures | 82 | 19 match runs in 30 days; created the same day as Maximizer (#81) |
| Granted | 7 | test-like name (our own company name) |
| Granted Consulting | 10, 15 | test-like name (our own company name) |
| Research Test Company | 8 | test-like name |
| Testing Strategy | 9 | test-like name |
| Example123 | 11 | test-like name |
| Test123 | 13 | test-like name |
| Nats Test Company | 18 | test-like name |
| Research Test1 / Test2 / Test3 / Test12 | 20, 23, 27, 50 | test-like name |
| This is Natalie's Beta 1 Test | 25 | test-like name |
| Test Company | 33, 34, 35 | test-like name (three created within 2 seconds) |
| Nats big test | 58 | test-like name |
| CL Test | 71, 85 | test-like name |
| Jades Testing Company | 73 | test-like name |
| LouLouFry Testing | 126 | test-like name |

### Chat section (Overview)

The Chat section comes after "How clients found grant cards".

**Numbers** follow the range picker and the "Include internal accounts" toggle
(`rankings.*.chat`). They're read live from the ops DB, read-only.

| Number | Definition |
|---|---|
| chats started | conversations by real Clerk users, with ≥1 message, started in the window |
| clients who chatted | distinct companies among those chats, linked through `identitiesForClerkIds` exactly like active clients; a chat whose Clerk id has no company is still a chat |
| questions asked | the client's own messages in those chats: user messages with string content (tool results are array content and don't count) |
| questions per chat | questions asked ÷ chats started, to one decimal |
| grant cards opened from chat | grant card opens with source `advisor`, the same as Chat in "How clients found grant cards" |

**What clients asked about** and **recent client questions** come from the weekly digest's
stored themes (below). They show the **latest stored week**, labelled "Week of …", whatever
range is picked.
- **Themes:** each shows its count, its takeaway and how many of its questions came from
  internal accounts.
- **Recent questions:** follow the toggle and tag internal accounts. Rows with no client show
  "who asked isn't recorded".
- **Missing table:** if the table is missing (046 not applied), the section says themes can't be
  read; the rest of the Overview is unaffected.

### Digest themes (migration 046)

The weekly Pulse digest (`src/services/pulse-digest.js`) stores its themes and rewritten
questions for the Control Centre. They come from the **same** Haiku call it already makes,
**not a second one**.

| Table | One row per |
|---|---|
| `cc_digest_themes` | theme per digest week: `week_start` (the Monday, Vancouver), `position`, `name`, `question_count`, `takeaway`, `source` |
| `cc_digest_questions` | rewritten question: `week_start`, `theme_position`, `question`, `question_order` (oldest first), `clerk_id`, `company_id`, `source` |

- **When it writes:** after the digest claims its week, through `saveDigestThemes`
  (`src/control-centre/digest-themes.js`). The week's rows are replaced whole, in one
  transaction.
- **If the write fails,** the warning code is logged and the DM still goes out.
- **What's stored:** only the model's rewritten (anonymised) question text, never the
  original. Questions the model didn't rewrite aren't stored.
- **`company_id`** comes from the Clerk id via the app DB. It's null when the app DB isn't
  available, and the Clerk id is kept either way.

**Backfill: `scripts/cc-backfill-digest-themes.mjs`** (a dry run by default; `--write` stores).
It parses each sent digest's `pulse_posts.summary`, with no model call:
- **What it can recover:** theme name, count and takeaway, plus the **one example question per
  theme** the summary carries.
- **What it can't:** no client ids exist there, so backfilled questions are unlinked
  (`source = 'backfill_summary'`).
- **What it skips:** the full question list for a past week is only in that week's Google
  Sheet tab (also without client ids), so it isn't backfilled. A week the live digest already
  stored is never overwritten.

On 2026-10-15 the only sent week was Oct 5–11. Backfilled on the local scratch DB, it gives 5
themes and 5 example questions. **Production needs 046 and then this backfill with
`--write`.**

**Follow-up, not changed here:** the digest still leaves staff out by
`GG3_INTERNAL_USER_IDS` (Clerk ids), while the Control Centre uses the internal-accounts list
(companies). The stored themes are therefore already filtered by the digest's rule, and
the toggle can only act on the questions linked to a company. Aligning the two rules is a
separate decision.

## Oracle: `control_centre` (read-only)

`src/tools/control-centre-tools.js`, Oracle-only and deferred (found by tool search). Modes:
`queue_summary`, `list_cards` (status, owner incl. `unassigned`, kind, company, grant,
`stuck_only` = open and unchanged 3+ days; ≤20), `card` (one card in full: diagnosis,
evidence — chat turns or review reasons — flags, history, linked cards), `overview`
(`getOverview(range)`, client-only lists) and `chat_themes` (`latestDigest()`). Every card in
every answer carries its link; companies are named first and internal accounts tagged.
SELECTs and the existing read helpers only — Oracle can't move, reassign or close a card.
Details: `docs/oracle.md`, "Tool loadout".

## Known limits

- **The nightly roll-up runs.** It wasn't running before 2026-10-15 (the last write then was
  a by-hand run at 2026-10-14 06:42 Vancouver, so Oct 14 was stored part-way through the day);
  the 03:00 run on 2026-10-15 rewrote the last 3 days, and Oct 14 is now complete. The page
  still reads any day rolled before it ended live, as described above.
- **Province labels are raw `company_metadata.provinces` values.** Some are sub-regions, such
  as "BC- Interior (Thompson/Okanagan + Kootenay)", and aren't normalised.
- **History starts Aug–Sep 2026.** The ops tables hold nothing earlier, and the roll-up
  backfill starts 2026-08-26, so trends can't reach back past that. Month and Year comparisons
  against earlier periods read as growth from zero.
- **match_results keeps 180 days.** Older matches are deleted, so a long-range match history
  isn't possible from this source.
- **`chat_turns.company_id` is mostly empty.** Resolve the company from `user_id` (Clerk) with
  `identitiesForClerkIds` instead.
- **Size and revenue are mostly ranges** (`"5-10 employees"`, `"$500k-$1M CAD"`), not numbers.
  The numeric columns are a fallback and are usually null.
- **One company per user today.** The identity helper still handles several memberships.
