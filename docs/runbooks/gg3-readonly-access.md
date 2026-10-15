# Oracle read-only access to the gg3-ai-service database

This gives Oracle a database login that can **only read** seven gg3-ai-service tables:
`chat_turns`, `conversations`, `match_results`, `grant_events`, `grant_feedback`, `events`,
and `ai_review_log`. It cannot write anything, and it cannot see any other table, including
`ai_review_cache`, `llm_calls` and anything added later.

`ai_review_log` (the AI Final Review's cut / move / flag decisions) was added after the role
was first created. The Control Centre reads it: the nightly roll-up and the hourly review
sweep, which files a grant-pattern card when the review cuts one grant for the same reason
for 3+ companies in 7 days (`docs/control-centre.md`). Oracle's chat tools never name it. On
a role created from the original file, grant it by hand:
`GRANT SELECT ON public.ai_review_log TO oracle_readonly;`

> **Drift, checked 2026-10-15:** the live role can also read `llm_calls`, which the script
> never granted and no Hub code reads. Revoke it when convenient:
> `REVOKE SELECT ON public.llm_calls FROM oracle_readonly;`

Files:
- `scripts/sql/gg3-readonly-role.sql`: creates the login. You run it once, by hand.
- `src/services/gg3-ops-db.js`: Oracle's connection to it.
- `scripts/gg3-ops-db-check.mjs`: checks everything works and that writes are refused.

> **Client data.** `conversations` holds what clients typed. Anything built on this must
> print counts, labels and ids, never message text.

## 1. Create the login (one time)

The SQL lives in `scripts/sql/`, not `migrations/`, so no migration runner can pick it up.
It also refuses to run on any database that isn't gg3-ai-service's.

1. Make a password in your terminal: `openssl rand -hex 24`. Hex is used because it never
   needs escaping in a URL.
2. Open `scripts/sql/gg3-readonly-role.sql`. Replace `REPLACE_WITH_GENERATED_PASSWORD` with
   it. Don't save that edit back into the repo; paste it straight into Railway in the next step.
3. In Railway, open the **gg3-ai-service** project, then its **Postgres** service, then the
   **Data** tab, then **Query**. Paste the whole file and run it. It should run without errors.
   - If it says *"not the gg3-ai-service database"*, you're on the wrong database. Nothing was
     created.
   - If it says *"already exists"*, the login is already there. To change its password, use
     section 5 instead.
4. Check it worked. Run this in the same Query tab:

   ```sql
   SELECT t,
          has_table_privilege('oracle_readonly', t, 'SELECT') AS can_read,
          has_table_privilege('oracle_readonly', t, 'INSERT') AS can_write
     FROM unnest(ARRAY['chat_turns','conversations','match_results','grant_events',
                       'grant_feedback','events','ai_review_log','ai_review_cache',
                       'llm_calls']) AS t;

   SELECT has_schema_privilege('oracle_readonly', 'public', 'CREATE') AS can_create_tables;
   ```

   - **Expected result:** `can_read` is true for the first seven tables (through
     `ai_review_log`) and false for `ai_review_cache` and `llm_calls`. `can_write` is false
     everywhere.
   - If `can_create_tables` is **true**, the database is on an older Postgres (version 14 or
     earlier) that lets every login create tables. Oracle's connection still can't, because
     every session is read-only. To close it completely anyway, run
     `REVOKE CREATE ON SCHEMA public FROM PUBLIC;`. Check that gg3-ai-service owns its own
     tables before doing so (it normally does).

## 2. Build the connection URL

In the gg3-ai-service Postgres service, go to the **Variables** (or **Connect**) tab and note
the host, port and database name. Then build:

```
postgresql://oracle_readonly:<password>@<host>:<port>/<database>
```

- **Oracle in a different Railway project:** use the **public** host and port, the
  `*.proxy.rlwy.net` ones.
- **Oracle in the same Railway project:** you can use the private host
  (`postgres.railway.internal:5432`) instead.

## 3. Give it to Oracle

In Oracle's Railway service (grant-card-assistant), go to **Variables** and add:

| Variable | Value |
|---|---|
| `GG3_OPS_DB_READONLY_URL` | the URL from step 2 |

Railway redeploys on save.
- If `GG3_OPS_DB_READONLY_URL` is missing, Oracle logs one warning and carries on. It never
  crashes over this.
- Staff and test logins are not listed here (section 4).

Then check it from your machine:

```
GG3_OPS_DB_READONLY_URL='<url>' node scripts/gg3-ops-db-check.mjs
```

It prints:
- last week's chat outcomes (everyone's)
- last week's conversation count
- two **PASS** lines confirming writes are refused

It prints no message text.

## 4. Staff and test accounts

There is no staff list to keep here. `GG3_INTERNAL_USER_IDS` is retired; remove it from
Railway if it is still set, since nothing reads it.

GetGranted's own accounts are the Control Centre's internal-accounts list:
`INTERNAL_COMPANY_IDS` in `src/control-centre/internal-accounts.js`, which holds company ids.
Pulse turns those companies into Clerk user ids through the app DB (`company_users` →
`users_clerk`, `src/control-centre/identity.js` `internalClerkIds()`, cached an hour), so
anyone who joins an internal company is covered without a config change.

- **Morning roundup:** reviews every conversation. Cards from internal accounts carry the
  Internal tag.
- **Weekly digest:** counts everyone, with "N internal" beside each count. Its themes and
  stored questions use client conversations only.

To mark a new test or staff company as internal, add its id to `INTERNAL_COMPANY_IDS` (see
`docs/control-centre.md`).

## 5. Rotate the password

1. Make a new password: `openssl rand -hex 24`.
2. In the gg3-ai-service Postgres **Query** tab, run
   `ALTER ROLE oracle_readonly PASSWORD '<new password>';`.
3. Update `GG3_OPS_DB_READONLY_URL` in Oracle's Railway variables. Railway redeploys.
4. Run the check command from section 3.

Oracle's open connections keep working until they close (at most about 30 seconds idle). New
ones need the new password.

## 6. Revoke access

To shut it off completely, run this in the gg3-ai-service Postgres **Query** tab:

```sql
-- Kick out any open sessions
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'oracle_readonly';

-- Remove every grant, then the login itself
DO $$ BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM oracle_readonly', current_database());
END $$;
REVOKE ALL ON SCHEMA public FROM oracle_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM oracle_readonly;
DROP ROLE oracle_readonly;
```

Then delete `GG3_OPS_DB_READONLY_URL` from Oracle's variables. Oracle falls back to "not
configured" and keeps running.

For a quick pause without deleting anything: `ALTER ROLE oracle_readonly NOLOGIN;`. Undo it
with `LOGIN`.
