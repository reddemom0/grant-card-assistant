# Federal Grants Ingestion — Verification Steps

Run these in order, top to bottom. Each step's expected output is documented inline so you know what "success" looks like without having to interpret.

**Prereq:** `DATABASE_URL` must point at the Railway Postgres. Run via `railway run` (or with `.env` loaded) for the steps that hit the live DB.

---

## 1. Install the two new deps

```bash
npm install
```

Expected: `package-lock.json` regenerated; `node_modules/pg-copy-streams/` and `node_modules/csv-parse/` exist. No peer-dependency warnings about `pg` (pg-copy-streams 6.x requires pg>=8 — already satisfied at `^8.16.3`).

---

## 2. Dry run (no DB writes)

```bash
node scripts/ingest-federal-grants.js --initial --dry-run
```

Expected:
- Connects to DB.
- Preflight passes (`pg_trgm available`, table exists).
- HEAD-checks source. Logs `Source Last-Modified` and `Source Content-Length` (~2.25 GB).
- Parses first ~100 source rows.
- Prints `✅ Column shape OK (10 required columns present)` after the first row.
- Final summary lists counters: `source_rows`, `accepted_rows`, `rejected_*`, `duplicate_pk`.
- Exit code 0.

**If column-shape check fails:** the Open Canada publication shape has drifted. Verify the dataset URL still resolves and inspect the header row manually with `curl -s "$URL" | head -1`. Do not proceed.

---

## 3. Apply migration 021

```bash
node migrations/run-migration.js 021_proactive_disclosure_grants.sql
```

Expected output (cite line-of-interest in brackets):
- `✅ Connected successfully`
- `✅ Migration executed successfully`
- `⚠️  Warning: Table not found after migration` — **IGNORE THIS.** The runner's verification block at `migrations/run-migration.js:77-87` is hardcoded to check for `conversation_memory` (the table from migration 001) and will always warn for other migrations. Not a real failure.
- `Indexes created: …` — also hardcoded to `conversation_memory`; may be empty. Not a real failure.

**Real verification** — open a `psql` and run:
```sql
\dt+ proactive_disclosure_grants
\dt+ naics_labels
\dt+ proactive_disclosure_meta
\di+ idx_pdg_*
\dm+ pdg_program_yearly
SELECT * FROM proactive_disclosure_meta;  -- expect: 1 row, id=1, all other fields NULL
```

Expect:
- 3 tables, ~9 user-defined indexes on `proactive_disclosure_grants` (8 idx_pdg_* + the PK), 1 matview, 1 view.
- `pg_trgm` listed in `\dx`.

---

## 4. Load NAICS labels

```bash
railway run node scripts/ingest-federal-grants.js --naics-only
```

Expected:
- Fetches StatsCan CSV.
- Logs `Parsed N candidate NAICS rows (2- and 3-digit only)` — N should be ~120 (20 two-digit codes + ~100 three-digit subsectors).
- Logs `NAICS load complete: N inserted, 0 updated` on first run.

**If the StatsCan URL 404s:** the constant `NAICS_URL` in `scripts/ingest-federal-grants.js` is a placeholder. Override with the actual URL via env var:
```bash
NAICS_LABELS_CSV_URL="https://..." railway run node scripts/ingest-federal-grants.js --naics-only
```
The real URL must be resolved from the StatsCan NAICS 2022 v1.0 dataset page (https://www.statcan.gc.ca/en/concepts/industry/2022/naics-scian-2022-v1-eng.htm) or its open.canada.ca mirror. Once confirmed, update the constant in a follow-up commit.

Verify:
```sql
SELECT length, COUNT(*) FROM naics_labels GROUP BY length;
-- expect: length=2 → ~20 rows, length=3 → ~100 rows
SELECT * FROM naics_labels WHERE code = '11';  -- "Agriculture, Forestry, Fishing and Hunting"
```

---

## 5. Initial full grants load

```bash
railway run node scripts/ingest-federal-grants.js --initial
```

Expected runtime: **5–15 minutes** depending on Railway tier and source-CDN throughput. Expected output:
- Preflight passes.
- HEAD: ~2.25 GB Content-Length.
- Creates `pdg_stage`.
- Streams: progress log every 50,000 accepted rows (`📊 Parsed 50,000 rows...` etc.). Expect 60-ish such lines.
- COPY completes: `✅ COPY finished. ~3,000,000 rows in <duration>s.`
- Merge: `✅ Merge complete (rowCount=N, <duration>s).` rowCount equals accepted_rows on initial.
- Matview refresh: 30–90s.
- Meta written.
- Final counters: `accepted_rows` ≈ 3M, `rejected_missing_pk` < 100 (likely), `rejected_date_parse` and `rejected_value_parse` in the hundreds-to-thousands, `duplicate_pk` ideally 0 (if non-zero, source data quality issue worth investigating).

---

## 6. Spot-check queries

```sql
-- Row count sanity
SELECT COUNT(*) FROM proactive_disclosure_grants;
-- expect: ~3,000,000 (depends on current Open Canada publication)

-- Latest amendment view
SELECT COUNT(*) FROM pdg_latest_amendments;
-- expect: smaller than total — distinct ref_numbers only

-- Smoke test the matview
SELECT prog_name_en, year, total_value
FROM pdg_program_yearly
WHERE year >= '2024-01-01'
ORDER BY total_value DESC
LIMIT 10;

-- Meta tracker
SELECT * FROM proactive_disclosure_meta;
-- expect: last_modified populated, last_ingested_at recent, last_ingested_row_count ~3M, last_ingest_mode='initial'

-- Trigram smoke test
SELECT recipient_legal_name
FROM proactive_disclosure_grants
WHERE recipient_legal_name % 'Univers Brit Columbia'
LIMIT 5;
-- expect: fuzzy match to "University of British Columbia"-style names
```

---

## 7. Refresh smoke test

Immediately after the initial load:
```bash
railway run node scripts/ingest-federal-grants.js --refresh
```

Two possible outcomes — both expected, depending on source state:

**(a) Source unchanged (most likely immediately after initial):**
```
✅ Source unchanged since last ingest (last_modified matches). Exiting cleanly.
```
Exit code 0. No DB writes. `pg_database_size` unchanged.

**(b) Source has new data:**
```
📥 Source has new data, proceeding with refresh.
```
Full pipeline runs. Meta updated.

**Operational note:** Do NOT run `--refresh` while Oracle conversations are active. `REFRESH MATERIALIZED VIEW CONCURRENTLY pdg_program_yearly` briefly blocks reads at swap; concurrent Oracle queries against the matview will wait. Schedule refreshes during low-usage windows (overnight, weekends) or quiesce traffic first.

---

## 8. Rollback

If anything in steps 3–5 needs to be undone:

```sql
-- Reverse-order drop. Run as the role that ran the migration.
DROP MATERIALIZED VIEW IF EXISTS pdg_program_yearly;
DROP VIEW IF EXISTS pdg_latest_amendments;
DROP TABLE IF EXISTS proactive_disclosure_meta;
DROP TABLE IF EXISTS naics_labels;       -- has self-FK; will fail if rows reference each other,
                                         -- in which case: DELETE FROM naics_labels; then DROP.
DROP TABLE IF EXISTS proactive_disclosure_grants;
-- pg_trgm is harmless to leave installed; only drop if certain nothing else uses it:
-- DROP EXTENSION IF EXISTS pg_trgm;
```

Revert package.json + lockfile:
```bash
git checkout -- package.json package-lock.json
rm -rf node_modules/pg-copy-streams node_modules/csv-parse
npm install
```

---

## 9. Git staging (NOT executed by Claude)

Explicit file list, no `-A`:

```bash
git add migrations/021_proactive_disclosure_grants.sql \
        scripts/ingest-federal-grants.js \
        package.json \
        package-lock.json
git status      # confirm only those 4 files are staged
git diff --cached --stat
```

---

## 10. Cache behavior & troubleshooting

The ingest script downloads the source CSV to local disk first, then streams from disk into COPY. This is a deliberate split — see the file-header comment in `scripts/ingest-federal-grants.js` for the full reasoning. Operationally:

**Default cache path:** `/tmp/federal-grants-source.csv` (override via env var `FEDERAL_GRANTS_LOCAL_PATH`).

**Cache hit rules:**
- The script HEAD-checks the source, then compares the local file size to the returned `Content-Length`.
- Size match → log `♻️  Reusing cached download` and skip the download.
- Size mismatch OR file missing → fresh download.
- After a successful run the final summary prints `Cached source: <path> (<size>) — delete to force re-download next run, or pass --redownload.`

**`--redownload` flag** — forces a fresh download even on cache hit. Valid with `--initial` and `--refresh`; rejected with `--naics-only` (the NAICS subroutine does not cache). Use after a corrupt partial download, or to verify against current source after a manual cache delete.

**If the ingest fails partway through** (network blip, OOM, etc.):
1. **Download phase failure** → the script unlinks the partial file before throwing, so the next run will fetch fresh. No manual cleanup needed.
2. **COPY / merge / refresh phase failure** → the cached CSV is preserved. Re-run with the same command; the download phase will be a cache hit and skip straight to staging.
3. **Suspected corrupt cache** (parse errors that don't reproduce against the source URL) → `rm /tmp/federal-grants-source.csv` then re-run, or pass `--redownload`.
4. **TEMP staging table left around** → the script's `finally` block runs `DROP TABLE IF EXISTS pdg_stage` on every exit path; if a hard kill (SIGKILL, OOM) skipped that, the table is session-scoped and dies with the connection anyway. Nothing to clean manually.

**Disk usage:** The cached CSV is ~2.25 GB. Railway containers have limited `/tmp`; check `df -h /tmp` if running on Railway and consider pointing `FEDERAL_GRANTS_LOCAL_PATH` at a roomier mount.

Commit message suggestion:
```
feat: ingest federal Proactive Disclosure grants into Postgres

- Migration 021: proactive_disclosure_grants table + naics_labels +
  proactive_disclosure_meta, 8 indexes, pdg_latest_amendments view,
  pdg_program_yearly materialized view (built from latest-amendment view
  to avoid double-counting).
- scripts/ingest-federal-grants.js: streaming CSV ingest with --initial,
  --refresh, --dry-run, --naics-only modes. Dedicated pg.Client with
  statement_timeout: 0; 64MB PassThrough buffer to absorb CDN backpressure.
- Add pg-copy-streams and csv-parse to dependencies.

Oracle tool wiring is a separate follow-up. NAICS URL is a placeholder
pending first-run verification.
```
