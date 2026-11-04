/**
 * search_granted_files — Oracle's search over the Granted Files index
 * (drive_files / drive_chunks; src/services/rag/search.js).
 *
 * For Granted's own work: past applications, client history, examples,
 * internal process. Results are limited to files the asker can open: each
 * candidate gets a read-only files.get as the asker (domain-wide delegation),
 * and files they can't open are dropped and only counted. If Drive can't be
 * reached as the asker, the search fails closed.
 *
 * Logs one line per call with lengths, filter names, counts and timings only —
 * never the query, file names or snippets.
 */

import { trimResults, DEFAULTS } from '../services/rag/search.js';

const AREAS = ['Clients', 'Programs', 'Departments', 'Old Files', 'Other'];
const MAX_QUERY = 500;

const codeOf = (err) => String(err?.code || err?.statusCode || err?.response?.status || err?.name || 'error').slice(0, 40);
const statusOf = (err) => Number(err?.statusCode || err?.code || err?.response?.status) || 0;

/** files.get as the asker: true if they can open it, false on 403/404; anything else throws. */
export function accessChecker(drive) {
  return async (fileId) => {
    try {
      await drive.files.get({ fileId, fields: 'id', supportsAllDrives: true });
      return true;
    } catch (err) {
      if ([403, 404].includes(statusOf(err))) return false;
      throw Object.assign(new Error('Drive access unavailable'), { code: 'DRIVE_AUTH_UNAVAILABLE' });
    }
  };
}

function parseInput(input = {}) {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) return { error: 'query is required' };
  if (query.length > MAX_QUERY) return { error: `query is too long (${MAX_QUERY} characters max)` };
  if (input.area !== undefined && !AREAS.includes(input.area)) return { error: `area must be one of: ${AREAS.join(', ')}` };
  const year = (v, name) => {
    if (v === undefined || v === null || v === '') return { value: undefined };
    const n = Number(v);
    return Number.isInteger(n) && n >= 1990 && n <= 2100 ? { value: n } : { error: `${name} must be a year` };
  };
  const from = year(input.year_from, 'year_from');
  const to = year(input.year_to, 'year_to');
  if (from.error || to.error) return { error: from.error || to.error };
  const limit = input.limit === undefined ? DEFAULTS.limit : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) return { error: 'limit must be 1–8' };
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : undefined);
  return {
    query,
    opts: { area: input.area, client: text(input.client), program: text(input.program), yearFrom: from.value, yearTo: to.value },
    limit
  };
}

/**
 * @param {Object} input - tool input
 * @param {{userEmail?: string}} context - from the executor (DELEGATED_DRIVE_TOOLS)
 * @param {{search?: Function, canOpen?: Function, log?: Function}} [deps]
 */
export async function runGrantedFilesSearch(input, { userEmail } = {}, deps = {}) {
  const parsed = parseInput(input);
  if (parsed.error) return { success: false, error: parsed.error };
  const log = deps.log || console.log;
  const started = performance.now();
  const filters = Object.keys(parsed.opts).filter(k => parsed.opts[k] !== undefined);

  try {
    if (!userEmail) throw Object.assign(new Error('Drive access unavailable'), { code: 'DRIVE_AUTH_UNAVAILABLE' });
    let canOpen = deps.canOpen;
    if (!canOpen) {
      const { delegatedDriveClient } = await import('./google-drive.js');
      canOpen = accessChecker(delegatedDriveClient(userEmail));  // read-only scopes, as the asker
    }
    const search = deps.search || (await import('../services/rag/search.js')).searchGrantedFiles;

    const { files, stats } = await search(parsed.query, parsed.opts);
    const access = await Promise.all(files.map(f => canOpen(f.file_id)));
    const open = files.filter((_, i) => access[i]);
    const results = trimResults(open, { limit: parsed.limit });
    const hidden = files.length - open.length;

    log(JSON.stringify({ t: new Date().toISOString(), event: 'search_granted_files', query_len: parsed.query.length, filters,
      candidates: stats.candidates, results: results.length, hidden, rerank: stats.rerank, ms_sql: stats.ms_sql,
      ms: Math.round(performance.now() - started), tokens: stats.tokens }));

    return {
      success: true,
      results,
      hidden_no_access: hidden,
      note: results.length ? null : (hidden ? 'Nothing relevant that you have access to.' : 'Nothing relevant found in Granted Files.')
    };
  } catch (err) {
    log(JSON.stringify({ t: new Date().toISOString(), event: 'search_granted_files', query_len: parsed.query.length, filters,
      error: codeOf(err), ms: Math.round(performance.now() - started) }));
    if (err?.code === 'DRIVE_AUTH_UNAVAILABLE') return { success: false, error: 'Drive access unavailable' };
    return { success: false, error: `Granted Files search failed (code: ${codeOf(err)})` };
  }
}
