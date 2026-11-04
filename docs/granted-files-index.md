# Granted Files index — current state

A semantic index of Granted Files (the shared drive), searched by Oracle's
`search_granted_files` tool. It holds text chunks with voyage-3.5 embeddings (512 dims, `halfvec`)
in Postgres.

## Tables
| Table | Migration | Holds |
|---|---|---|
| `drive_files` | 056, 060 | One row per Drive file: path, area, client, program, year, md5, `status`, `duplicate_of`, token and chunk counts, redaction counts (counts only) |
| `drive_chunks` | 056 | The chunk text (redacted), locator (`p. 3`, `Sheet: Budget`), embedding, area, year. Cascades on file delete |
| `rag_runs` | 060 | One row per nightly run: status, counts, tokens, USD, and the updater's own change-feed position |

**`status`:**
- `indexed`: has chunks, unless it's a duplicate.
- `scanned`: an image-only PDF. Name-only, and stays that way without OCR.
- `skipped`: an unsupported type, empty, or too large.
- `excluded`: matches an exclusion (see below).
- `failed`: mostly password-protected PDFs.
- `removed`: trashed or deleted in Drive. The chunks are gone but the row stays, because deleting
  it would null `duplicate_of` on its copies.

**Duplicates:** one copy per md5 is indexed (the canonical). Other copies get `duplicate_of`
pointing at it and no chunks. The canonical is the copy in the most specific area (Clients /
Programs / Departments, then Other, then Old Files), then the newest, then the lowest file ID.

There is no vector index; search is exact cosine. That's a decision, not an oversight.

## Pipeline
`src/services/rag/`:
- `exclude.js`, `extract.js`, `redact.js` and `chunk.js`: Phase 1. `prepare.js` runs them in
  that order.
- `indexer.js`: the bulk planner and runner.
- `store.js`: all SQL.
- `voyage.js`: embeddings.
- `drive-retry.js`: pacing at ≤ 4 Drive requests/s, with retry on throttling only. A 403
  retries only on the structured rate/quota reason, never on message text.
- `changes.js` and `nightly.js`: the nightly updater.

**Exclusions** (by name and folder only, never content):
- Departments/HR, FINANCE and Mindfulness.
- Departments/LEADERSHIP.
- The top-level Pre-Call Briefings folder.
- Any file whose name or folder matches the shared sensitive list
  (`src/tools/drive-sensitive.js`).

The LEADERSHIP and Pre-Call Briefings exclusions are RAG-only; the filing sweep's lists are
separate. Unlike the sweep, the index includes Old Files, Active Clients and Review.

## Full index (4 Nov 2026)
- **Run:** `scripts/rag-index.mjs --all --max-tokens 150000000`, detached in the
  grant-card-assistant container.
- **Size:** 77,568 files processed in 6.5 h, 94M tokens ($5.64 at list price), 245,496 chunks.
- **Listing:** Drive was listed at 2026-11-03T22:46Z. Changes after that are left for the
  catch-up and nightly runs.

## Nightly updater
- **When:** 02:00 America/Vancouver, from `startRagNightly` in `server.js`.
- **Off unless `RAG_NIGHTLY_ENABLED=true`.** `RAG_NIGHTLY_MAX_TOKENS` caps a run (default 5M).
- **Source:** the Granted Files Drive change feed, read from its own position in `rag_runs`.
  This is never the filing sweep's position; neither job consumes the other's.
- **Per change:**
  - **New or edited:** re-extracted and re-embedded, and its chunks are replaced in one
    transaction.
  - **Moved or renamed:** path and tags are updated, with no re-embed.
  - **Into an excluded area:** the chunks are deleted and the row becomes `excluded`.
  - **Out of an excluded area:** indexed.
  - **Trashed:** `removed`.
  - **A folder moved or renamed:** expanded to every file below it. A changed folder that
    already has stored rows under its current path is skipped. Drive also reports a folder
    when only its contents change, and those files arrive as changes of their own.
  - **A folder trashed:** every row under its old path is removed.
- **Duplicates:** if a canonical is trashed, excluded or edited, its chunks move to the best
  remaining allowed copy (`rehome`) before it is removed or reprocessed. Nothing is
  re-embedded for that.
- **First run with no stored position:** records one and processes nothing.
- **A run that stops at the ceiling or fails:** keeps the old position. The next run re-reads
  the same changes and skips what was already written.
- **Known limits:**
  - A folder that is moved and then trashed before the next run is removed under its new path
    only. Rows still carrying the old path stay until those files change.
  - A folder moved next to an existing folder with the same name and path is skipped as
    unchanged, so its files keep their old paths until they change.

## Search tool (`search_granted_files`)
Oracle-only, and always loaded (not deferred): it is Oracle's route to Granted's own past work.
Prompt rules are under "Granted Files (past work)" in `.claude/agents/internal-oracle.md`.

**When Oracle uses it:** Granted's own work, such as past applications, a client's history, examples
to reuse, budgets and internal process docs. Not for grant facts (eligibility, deadlines, amounts,
status), which still come from `grant_data` and official program pages.

**How a search runs** (`searchGrantedFiles` in `src/services/rag/search.js`):
1. The query is embedded with voyage-3.5 (`input_type: query`).
2. The 30 closest chunks are taken by exact cosine, from `indexed` canonical files only.
3. Up to 10 scanned (name-only) files whose name or folder shares words with the query are added.
4. Everything is reranked with `rerank-2.5-lite`.
5. A small boost applies: up to +0.02 for recent years, and −0.03 for Old Files.
6. Chunks are grouped by file. At most 6 files and 8 snippets are returned (300 characters each,
   already redacted).

**Floors:** a reranked chunk below 0.5 is dropped, and a scanned file needs 0.5 on its name and
folder. Without rerank, the cosine floor is 0.55. The floors were set from the eval: irrelevant
results scored at most 0.44 after rerank, relevant ones 0.67 or more. An answer with nothing
above the floor returns no files rather than weak ones.

**Filters:**
- `area`, `year_from` and `year_to` use the chunk's tags.
- `program` matches the program tag.
- `client` matches the client tag **or the folder path**, because files under `Active Clients/`
  are tagged area Other with no client.

**Labels:**
- `older material (YEAR)` for Old Files.
- `scanned file — name only` for scanned PDFs. Oracle mentions these only as "there's a scanned
  file that may help".

**Access:** each result file gets a read-only `files.get` as the asker. Files they can't open are
dropped and only counted (`hidden_no_access`). If Drive can't be reached as the asker, the search
fails closed with "Drive access unavailable".

**Logging:** the tool is in `QUIET_TOOLS` (`src/tools/executor.js`), so the executor and
`runAgent` log only input and result sizes. Each call logs one line with the query length, filter
names, counts, timings and tokens. Oracle's own per-message log line still prints the user's
message, as it does for every turn.

**Cost:** about 10k Voyage tokens per search (query plus rerank), roughly $0.0002.

**Latency** (eval of 4 Nov, 245k chunks, Postgres capped at 1 GB):

| | p50 | p95 |
|---|---|---|
| Whole search | 0.9 s | 1.3 s |
| SQL | 0.26 s | 0.30 s |

The first query on a cold cache takes about 4–5 s.

**Eval:**
- Questions are in `tests/evals/granted-files/questions.json`: 10 written, 10 TODO for consultants.
- Run it in the container with
  `PGOPTIONS='-c default_transaction_read_only=on' node scripts/rag-eval.mjs [--mode rerank|cosine|both]`.
- It writes a markdown table with a blank Pass/Fail column. Reports name client files, so keep
  them out of git.

## Commands
Run these in the container (`railway ssh --service grant-card-assistant -- "cd /app && …"`),
because the database has no public proxy.

| Command | Does |
|---|---|
| `node scripts/rag-index.mjs --status [--since ISO]` | Totals by status, chunks, failures, rows touched since a time, and the last 5 nightly runs. Read-only |
| `node scripts/rag-index.mjs --nightly --dry [--since ISO]` | What the updater would do. With `--since`, it reads from the filing sweep's last position at or before that time and keeps only changes from then on. Read-only |
| `node scripts/rag-index.mjs --nightly [--since ISO] [--max-tokens N]` | One updater run by hand, with the same claim, ceiling and position handling as the cron |
| `node scripts/rag-index.mjs --search "<q>"` | The top 3 chunks by cosine, for sanity checks. Read-only |
| `node scripts/rag-index.mjs --subtree "<path>" \| --all [--dry] [--max-tokens N] [--resume]` | The bulk indexer. Resumable |
