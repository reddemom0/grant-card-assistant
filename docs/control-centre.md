# Control Centre — data layer

The Control Centre reads two databases. It never writes to either one. This doc covers the
connections, the rules that decide what counts as "live", and the known limits of the data.
There's no UI yet.

Code: `src/control-centre/` — `db.js`, `health.js`, `identity.js`, `live-sources.js`.
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
