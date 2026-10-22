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
  const [byStatus, chunks, failures, touched] = await Promise.all([
    query(`SELECT status, (duplicate_of IS NOT NULL) AS duplicate, count(*)::int n, coalesce(sum(token_count), 0)::bigint tokens
           FROM drive_files GROUP BY 1, 2 ORDER BY 1, 2`),
    query(`SELECT count(*)::int chunks, count(embedding)::int embedded, coalesce(sum(token_count), 0)::bigint tokens FROM drive_chunks`),
    query(`SELECT status_reason, count(*)::int n FROM drive_files WHERE status = 'failed' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
    since ? query(`SELECT count(*)::int n, min(last_indexed_at) first, max(last_indexed_at) last FROM drive_files WHERE last_indexed_at >= $1`, [since])
      : Promise.resolve({ rows: [] })
  ]);
  return { byStatus: byStatus.rows, chunks: chunks.rows[0], failures: failures.rows, touched: touched.rows[0] || null };
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
