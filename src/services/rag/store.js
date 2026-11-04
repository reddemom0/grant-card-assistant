/**
 * Granted Files RAG — database reads and writes
 *
 * Touches drive_files and drive_chunks only (migration 056). Each file is written
 * in one transaction: upsert its row, replace its chunks. That transaction is the
 * indexer's checkpoint. Search is exact cosine over halfvec(512); there is no
 * vector index by decision.
 */

import { query, transaction } from '../../database/connection.js';
import { toHalfvec } from './voyage.js';

const FILE_COLUMNS = ['file_id', 'md5', 'name', 'path', 'area', 'client', 'program', 'year', 'mime', 'modified_time',
  'status', 'status_reason', 'truncated', 'duplicate_of', 'token_count', 'chunk_count', 'redaction_counts'];

const UPSERT_FILE = `
  INSERT INTO drive_files (${FILE_COLUMNS.join(', ')}, last_indexed_at, updated_at)
  VALUES (${FILE_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}, NOW(), NOW())
  ON CONFLICT (file_id) DO UPDATE SET
    ${FILE_COLUMNS.slice(1).map(c => `${c} = EXCLUDED.${c}`).join(',\n    ')},
    last_indexed_at = NOW(), updated_at = NOW()`;

// Postgres TEXT rejects NUL bytes, which some PDFs' text layers contain.
const noNul = (v) => (typeof v === 'string' ? v.replace(/\u0000/g, '') : v);
const fileParams = (row) => FILE_COLUMNS.map(c => (c === 'redaction_counts' ? JSON.stringify(row[c] || {}) : noNul(row[c]) ?? null));

/** Rows already stored for these file IDs (read-only). */
export async function existingRows(fileIds) {
  if (!fileIds.length) return [];
  const { rows } = await query(
    `SELECT file_id, md5, name, path, modified_time, status, duplicate_of FROM drive_files WHERE file_id = ANY($1::text[])`,
    [fileIds]
  );
  return rows;
}

/** Canonical copies already stored for these md5s: md5 → file_id. */
export async function canonicalByMd5(md5s) {
  if (!md5s.length) return new Map();
  const { rows } = await query(
    `SELECT md5, file_id FROM drive_files WHERE md5 = ANY($1::text[]) AND duplicate_of IS NULL AND status IN ('indexed', 'scanned')`,
    [md5s]
  );
  return new Map(rows.map(r => [r.md5, r.file_id]));
}

/**
 * One file's checkpoint: its row and all its chunks, or nothing.
 * @param {Object} row - a drive_files row (prepare.js shape plus duplicate_of)
 * @param {{chunk_no, locator, text, token_count, area, year}[]} chunks
 * @param {number[][]} vectors - one per chunk, same order
 */
export async function writeFile(row, chunks = [], vectors = []) {
  await transaction(async (client) => {
    await client.query(UPSERT_FILE, fileParams(row));
    await client.query('DELETE FROM drive_chunks WHERE file_id = $1', [row.file_id]);
    if (chunks.length) {
      await client.query(
        `INSERT INTO drive_chunks (file_id, chunk_no, locator, text, token_count, embedding, area, year)
         SELECT $1, c.chunk_no, c.locator, c.text, c.token_count, c.embedding::halfvec, $2, $3
         FROM unnest($4::int[], $5::text[], $6::text[], $7::int[], $8::text[])
           AS c(chunk_no, locator, text, token_count, embedding)`,
        [row.file_id, row.area, row.year,
          chunks.map(c => c.chunk_no), chunks.map(c => c.locator), chunks.map(c => noNul(c.text)),
          chunks.map(c => c.token_count), vectors.map(toHalfvec)]
      );
    }
  }, 'rag write file');
}

/**
 * Make `canonicalId` the indexed copy for content an earlier run indexed under
 * `previousId`: move the chunks (same md5, so same text and vectors) and point
 * the old copy at the new one.
 */
export async function rehome(previousId, canonicalRow) {
  await transaction(async (client) => {
    await client.query(UPSERT_FILE, fileParams(canonicalRow));
    await client.query('UPDATE drive_chunks SET file_id = $1, area = $2, year = $3 WHERE file_id = $4',
      [canonicalRow.file_id, canonicalRow.area, canonicalRow.year, previousId]);
    await client.query('UPDATE drive_files SET duplicate_of = $1, chunk_count = 0, updated_at = NOW() WHERE file_id = $2',
      [canonicalRow.file_id, previousId]);
  }, 'rag rehome');
}

/** Same content, new place or name: update metadata on the row and its chunks. */
export async function updateMove(row) {
  await transaction(async (client) => {
    await client.query(
      `UPDATE drive_files SET name = $2, path = $3, area = $4, client = $5, program = $6, year = $7,
         modified_time = $8, updated_at = NOW() WHERE file_id = $1`,
      [row.file_id, row.name, row.path, row.area, row.client, row.program, row.year, row.modified_time]
    );
    await client.query('UPDATE drive_chunks SET area = $2, year = $3 WHERE file_id = $1', [row.file_id, row.area, row.year]);
  }, 'rag move');
}

/** Progress and totals (read-only). `since` limits "touched" counts to one run. */
export async function status(since = null) {
  const [byStatus, chunks, failures, touched, runs] = await Promise.all([
    query(`SELECT status, (duplicate_of IS NOT NULL) AS duplicate, count(*)::int n, coalesce(sum(token_count), 0)::bigint tokens
           FROM drive_files GROUP BY 1, 2 ORDER BY 1, 2`),
    query(`SELECT count(*)::int chunks, count(embedding)::int embedded, coalesce(sum(token_count), 0)::bigint tokens FROM drive_chunks`),
    query(`SELECT status_reason, count(*)::int n FROM drive_files WHERE status = 'failed' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    since ? query(`SELECT count(*)::int n, min(last_indexed_at) first, max(last_indexed_at) last FROM drive_files WHERE last_indexed_at >= $1`, [since])
      : Promise.resolve({ rows: [] }),
    recentRuns(5)
  ]);
  return { byStatus: byStatus.rows, chunks: chunks.rows[0], failures: failures.rows, touched: touched.rows[0] || null, nightly: runs };
}

// ---------------------------------------------------------------- search (Oracle's search_granted_files)

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

/** Optional filters as SQL conditions, numbered from `start`. Chunk-level area/year use the chunk columns. */
function searchFilters({ area, client, program, yearFrom, yearTo } = {}, start, alias = 'c') {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replaceAll('?', `$${start + params.length - 1}`)); };
  if (area) add(`${alias}.area = ?`, area);
  if (yearFrom) add(`${alias}.year >= ?`, yearFrom);
  if (yearTo) add(`${alias}.year <= ?`, yearTo);
  // The path too: files under Active Clients/<client> carry no client tag.
  if (client) add(`(f.client ILIKE ? OR f.path ILIKE ?)`, `%${likeEscape(client)}%`);
  if (program) add(`f.program ILIKE ?`, `%${likeEscape(program)}%`);
  return { where, params };
}

/**
 * The k closest chunks by exact cosine, from indexed canonical files only (read-only).
 * @returns {Promise<{file_id, name, path, area, client, program, year, mime, locator, text, score}[]>}
 */
export async function searchChunks(vector, { k = 30, ...filters } = {}) {
  const { where, params } = searchFilters(filters, 3);
  const { rows } = await query(
    `SELECT c.file_id, f.name, f.path, f.area, f.client, f.program, f.year, f.mime, c.locator, c.text,
            1 - (c.embedding <=> $1::halfvec) AS score
     FROM drive_chunks c JOIN drive_files f ON f.file_id = c.file_id
     WHERE c.embedding IS NOT NULL AND f.status = 'indexed' AND f.duplicate_of IS NULL
       ${where.map(w => `AND ${w}`).join(' ')}
     ORDER BY c.embedding <=> $1::halfvec
     LIMIT $2`,
    [toHalfvec(vector), k, ...params]
  );
  return rows.map(r => ({ ...r, score: Number(r.score) }));
}

/**
 * Scanned (name-only) files whose name or folder shares words with the query,
 * best full-text match first (read-only). `terms` are plain words, already cleaned.
 */
export async function scannedCandidates(terms, { limit = 10, ...filters } = {}) {
  const words = terms.map(t => String(t).replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (!words.length) return [];
  const { where, params } = searchFilters(filters, 3, 'f');
  const { rows } = await query(
    `SELECT f.file_id, f.name, f.path, f.area, f.client, f.program, f.year, f.mime, ts_rank(doc, q) AS rank
     FROM drive_files f, to_tsquery('simple', $1) q, to_tsvector('simple', f.name || ' ' || replace(f.path, '/', ' ')) doc
     WHERE f.status = 'scanned' AND f.duplicate_of IS NULL AND doc @@ q
       ${where.map(w => `AND ${w}`).join(' ')}
     ORDER BY rank DESC
     LIMIT $2`,
    [words.join(' | '), limit, ...params]
  );
  return rows;
}

// ---------------------------------------------------------------- nightly updater (migration 060)

/** Every live row sharing these md5s, to complete dedupe groups (read-only). */
export async function groupRows(md5s) {
  if (!md5s.length) return [];
  const { rows } = await query(
    `SELECT file_id, md5, name, path, mime, modified_time, status, duplicate_of FROM drive_files
     WHERE md5 = ANY($1::text[]) AND status <> 'removed'`,
    [md5s]
  );
  return rows;
}

/** IDs of live rows at or below a folder path (read-only). */
export async function rowsUnderPath(prefix) {
  const { rows } = await query(
    `SELECT file_id FROM drive_files WHERE status <> 'removed' AND (path = $1 OR left(path, length($1) + 1) = $1 || '/')`,
    [prefix]
  );
  return rows.map(r => r.file_id);
}

/** Whether any live row sits at or below a folder path (read-only). */
export async function hasRowsUnder(prefix) {
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM drive_files WHERE status <> 'removed' AND (path = $1 OR left(path, length($1) + 1) = $1 || '/')) AS found`,
    [prefix]
  );
  return rows[0].found;
}

/** A trashed or deleted file: its chunks go, its row stays as 'removed'. */
export async function markRemoved(fileId) {
  await transaction(async (client) => {
    await client.query('DELETE FROM drive_chunks WHERE file_id = $1', [fileId]);
    await client.query(
      `UPDATE drive_files SET status = 'removed', status_reason = NULL, duplicate_of = NULL, chunk_count = 0, updated_at = NOW()
       WHERE file_id = $1`,
      [fileId]
    );
  }, 'rag remove');
}

/**
 * Claim today's run. Null when a run already owns the day: one that is done,
 * one still building (under 2 hours), or one that failed under 30 minutes ago.
 */
export async function claimRun(kind, localDate, tokenBefore) {
  const { rows } = await query(
    `INSERT INTO rag_runs (kind, local_date, page_token_before) VALUES ($1, $2, $3)
     ON CONFLICT (local_date) DO UPDATE SET kind = EXCLUDED.kind, status = 'building', page_token_before = EXCLUDED.page_token_before,
       page_token_after = NULL, counts = '{}'::jsonb, tokens = 0, cost_usd = 0, errors = 0, error_code = NULL,
       started_at = NOW(), completed_at = NULL
     WHERE rag_runs.status = 'stopped'
        OR (rag_runs.status = 'failed' AND rag_runs.started_at < NOW() - INTERVAL '30 minutes')
        OR (rag_runs.status = 'building' AND rag_runs.started_at < NOW() - INTERVAL '2 hours')
     RETURNING id`,
    [kind, localDate, tokenBefore]
  );
  return rows[0]?.id ?? null;
}

/**
 * Where the next run reads from: a done run's page_token_after, or the
 * unconsumed page_token_before of a run that stopped or failed after it.
 */
export async function lastToken() {
  const { rows } = await query(
    `SELECT CASE WHEN status = 'done' THEN page_token_after ELSE page_token_before END AS token FROM rag_runs
     WHERE status IN ('done', 'stopped', 'failed')
       AND (CASE WHEN status = 'done' THEN page_token_after ELSE page_token_before END) IS NOT NULL
     ORDER BY started_at DESC LIMIT 1`
  );
  return rows[0]?.token ?? null;
}

/** status: done | stopped | failed. tokenAfter only for done. */
export async function finishRun(id, { status, tokenAfter = null, counts = {}, tokens = 0, usd = 0, errors = 0, errorCode = null }) {
  await query(
    `UPDATE rag_runs SET status = $2, page_token_after = $3, counts = $4::jsonb, tokens = $5, cost_usd = $6, errors = $7,
       error_code = $8, completed_at = NOW() WHERE id = $1`,
    [id, status, status === 'done' ? tokenAfter : null, JSON.stringify(counts), tokens, usd, errors, errorCode]
  );
}

/** Latest runs for --status; null before migration 060. */
export async function recentRuns(n = 5) {
  try {
    const { rows } = await query(
      `SELECT kind, local_date, status, started_at, completed_at, counts, tokens, cost_usd, errors, error_code
       FROM rag_runs ORDER BY started_at DESC LIMIT $1`,
      [n]
    );
    return rows;
  } catch (err) {
    if (err?.code === '42P01') return null;
    throw err;
  }
}

/** The filing sweep's position at or before `since`, borrowed read-only for --since. */
export async function sweepTokenAtOrBefore(since) {
  const { rows } = await query(
    `SELECT page_token_after, completed_at FROM filing_sweep_runs
     WHERE kind = 'sweep' AND status = 'done' AND page_token_after IS NOT NULL AND completed_at <= $1
     ORDER BY completed_at DESC LIMIT 1`,
    [since]
  );
  return rows[0] ? { token: rows[0].page_token_after, at: rows[0].completed_at } : null;
}

/** Exact cosine search (no index). Returns the closest chunks with file name and path. */
export async function search(vector, k = 3) {
  const { rows } = await query(
    `SELECT f.name, f.path, f.area, f.year, c.locator, 1 - (c.embedding <=> $1::halfvec) AS score
     FROM drive_chunks c JOIN drive_files f ON f.file_id = c.file_id
     WHERE c.embedding IS NOT NULL
     ORDER BY c.embedding <=> $1::halfvec
     LIMIT $2`,
    [toHalfvec(vector), k]
  );
  return rows;
}
