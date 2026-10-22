/**
 * Granted Files RAG — bulk indexer
 *
 * Lists Granted Files live, decides per file what to do (skip / move / process /
 * duplicate / rehome), runs new and changed files through prepare.js, embeds
 * their chunks in batches and writes each file in one transaction (store.js).
 * Re-running skips files already written with an unchanged md5 (uploads) or
 * modifiedTime (native Google files), so a stopped run resumes where it ended.
 *
 * Decision logic is pure and exported for tests; Drive, Voyage and the database
 * are injected. Logs carry file IDs, statuses, counts and short reason codes only.
 */

import { folderKey, GRANTED_FILES_DRIVE_ID, FOLDER_MIME } from '../../tools/google-drive.js';
import { exclusionReason } from './exclude.js';
import { pathMeta } from './path-meta.js';
import { ragKind } from './extract.js';
import { USD_PER_MILLION } from './voyage.js';

// ---------------------------------------------------------------- listing

const LIST_FIELDS = 'nextPageToken, files(id, name, mimeType, md5Checksum, modifiedTime, size, parents)';

/**
 * Every non-trashed item in Granted Files, with its folder path resolved live
 * from the parents chain. Metadata only.
 * @param {(params: Object) => Promise<Object>} list - drive.files.list, wrapped for retry
 * @returns {Promise<{id, name, mimeType, md5Checksum, modifiedTime, size, path: string[]}[]>}
 */
export async function listGrantedFiles(list) {
  const items = [];
  let pageToken;
  do {
    const { data } = await list({
      corpora: 'drive', driveId: GRANTED_FILES_DRIVE_ID, includeItemsFromAllDrives: true, supportsAllDrives: true,
      q: 'trashed = false', fields: LIST_FIELDS, pageSize: 1000, pageToken
    });
    items.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return resolvePaths(items);
}

/** Folder path (names below the drive root) for every non-folder item. */
export function resolvePaths(items) {
  const folders = new Map(items.filter(i => i.mimeType === FOLDER_MIME).map(f => [f.id, f]));
  const cache = new Map();
  const pathOf = (parentId) => {
    if (!parentId || !folders.has(parentId)) return [];
    if (cache.has(parentId)) return cache.get(parentId);
    cache.set(parentId, []);  // cycle guard
    const folder = folders.get(parentId);
    const path = [...pathOf(folder.parents?.[0]), folder.name];
    cache.set(parentId, path);
    return path;
  };
  return items
    .filter(i => i.mimeType !== FOLDER_MIME)
    .map(({ parents, ...file }) => ({ ...file, path: pathOf(parents?.[0]) }));
}

/** Keep files under any of the given subtrees ("Programs", "Clients/Acme Ltd"); all when none. */
export function inSubtrees(files, subtrees = []) {
  if (!subtrees.length) return files;
  const prefixes = subtrees.map(s => String(s).split('/').map(p => p.trim()).filter(Boolean).map(folderKey));
  return files.filter(f => {
    const keys = f.path.map(folderKey);
    return prefixes.some(p => p.length <= keys.length && p.every((k, i) => keys[i] === k));
  });
}

// ---------------------------------------------------------------- decisions

const AREA_RANK = { Clients: 0, Programs: 0, Departments: 0, Other: 1, 'Old Files': 2 };

/**
 * The copy to index among files sharing an md5 (decision 2): most specific area
 * (Clients / Programs / Departments before Other before Old Files), then the most
 * recently modified, then the lowest file ID. Callers pass non-excluded copies only.
 */
export function chooseCanonical(group) {
  return [...group].sort((a, b) =>
    (AREA_RANK[pathMeta(a.path).area] ?? 1) - (AREA_RANK[pathMeta(b.path).area] ?? 1)
    || Date.parse(b.modifiedTime || 0) - Date.parse(a.modifiedTime || 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

const sameTime = (a, b) => Boolean(a && b) && new Date(a).getTime() === new Date(b).getTime();
const indexable = (f) => Boolean(ragKind(f.mimeType, f.name)) && !exclusionReason({ path: f.path, name: f.name });

/**
 * What to do with each listed file.
 * @param {Object[]} files - from listGrantedFiles (already filtered to scope)
 * @param {Map<string, Object>} existing - stored rows by file_id
 * @param {Map<string, string>} storedCanonical - md5 → file_id of the copy indexed earlier
 * @param {{resume?: boolean}} [opts]
 * @returns {{file: Object, action: 'skip'|'move'|'process'|'duplicate'|'rehome', canonicalId?: string, previousId?: string}[]}
 */
export function planRun(files, existing = new Map(), storedCanonical = new Map(), { resume = false } = {}) {
  const groups = new Map();
  for (const f of files) {
    if (f.md5Checksum && indexable(f)) {
      if (!groups.has(f.md5Checksum)) groups.set(f.md5Checksum, []);
      groups.get(f.md5Checksum).push(f);
    }
  }
  const canonicalOf = new Map();  // md5 → { id, previousId? }
  for (const [md5, group] of groups) {
    const best = chooseCanonical(group).id;
    const stored = storedCanonical.get(md5);
    if (stored && stored !== best && !group.some(f => f.id === stored)) canonicalOf.set(md5, { id: stored });  // stored copy is outside this listing: keep it
    else if (stored && stored !== best) canonicalOf.set(md5, { id: best, previousId: stored });
    else canonicalOf.set(md5, { id: best });
  }

  return files.map(file => {
    const row = existing.get(file.id);
    // Excluded and out-of-scope copies are never duplicates: prepare() records them as such.
    const canon = file.md5Checksum && indexable(file) ? canonicalOf.get(file.md5Checksum) : null;
    const unchanged = row && (file.md5Checksum ? row.md5 === file.md5Checksum : sameTime(row.modified_time, file.modifiedTime))
      && !(row.status === 'failed' && resume);
    const moved = row && (row.name !== file.name || row.path !== file.path.join('/'));

    if (canon && canon.id !== file.id) {
      if (unchanged && row.duplicate_of === canon.id) return { file, action: moved ? 'move' : 'skip' };
      return { file, action: 'duplicate', canonicalId: canon.id };
    }
    if (canon?.previousId) return { file, action: 'rehome', previousId: canon.previousId };
    if (unchanged && !row.duplicate_of) return { file, action: moved ? 'move' : 'skip' };
    return { file, action: 'process' };
  });
}

/** A duplicate's row: its own name, path and tags, the canonical's status, no chunks. */
export function duplicateRow(file, canonicalId, canonicalStatus) {
  return {
    file_id: file.id, md5: file.md5Checksum || null, name: file.name, path: file.path.join('/'),
    ...pathMeta(file.path), mime: file.mimeType, modified_time: file.modifiedTime || null,
    status: canonicalStatus || 'indexed', status_reason: 'duplicate', truncated: false,
    duplicate_of: canonicalId, token_count: null, chunk_count: 0, redaction_counts: {}
  };
}

/** Hard ceiling on embedded tokens per run (decision 8). */
export class TokenBudget {
  constructor(max = Infinity) { this.max = max; this.used = 0; }
  canSpend(n) { return this.used + n <= this.max; }
  spend(n) { this.used += n; }
}

// Mean tokens per file measured on 22 Oct (dist/inventory/granted-files-rag-estimate.md).
export const MEAN_TOKENS = { pdf: 1130 * 0.89, docx: 1085, doc: 1085, xlsx: 4189, gdoc: 2298, gsheet: 20000 };

/** Counts by action and kind, estimated tokens and list-price cost for the files to process. */
export function estimate(plan) {
  const byAction = {};
  const byKind = {};
  let tokens = 0;
  for (const { file, action } of plan) {
    byAction[action] = (byAction[action] || 0) + 1;
    if (action !== 'process' || !indexable(file)) continue;
    const kind = ragKind(file.mimeType, file.name);
    byKind[kind] = (byKind[kind] || 0) + 1;
    tokens += MEAN_TOKENS[kind] || 0;
  }
  tokens = Math.round(tokens);
  return { byAction, byKind, tokens, usd: +(tokens / 1e6 * USD_PER_MILLION).toFixed(2) };
}

/**
 * Trial clients (Step 3): clients with a 2019–2026 year folder, picked across
 * size bands (7 large, 7 middle, 6 small for n=20) so every year appears.
 * Deterministic: ties broken by name.
 */
export function pickTrialClients(files, n = 20) {
  const stats = new Map();
  for (const f of files) {
    if (folderKey(f.path[0]) !== 'clients' || !f.path[1] || !indexable(f)) continue;
    const s = stats.get(f.path[1]) || { name: f.path[1], files: 0, years: new Set() };
    s.files++;
    const { year } = pathMeta(f.path);
    if (year >= 2019 && year <= 2026) s.years.add(year);
    stats.set(f.path[1], s);
  }
  const ranked = [...stats.values()].filter(s => s.years.size).sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  const q = Math.floor(ranked.length / 4);
  const bands = [[ranked.slice(0, q), Math.round(n * 0.35)], [ranked.slice(q, ranked.length - q), Math.round(n * 0.35)], [ranked.slice(ranked.length - q), 0]];
  bands[2][1] = n - bands[0][1] - bands[1][1];
  const covered = new Set();
  const picked = [];
  for (const [band, want] of bands) {
    const pool = [...band];
    for (let k = 0; k < want && pool.length; k++) {
      pool.sort((a, b) => newYears(b) - newYears(a) || spreadRank(a, pool) - spreadRank(b, pool));
      const choice = pool.shift();
      choice.years.forEach(y => covered.add(y));
      picked.push(choice);
    }
  }
  return picked.map(s => ({ name: s.name, files: s.files, years: [...s.years].sort() }));

  function newYears(s) { return [...s.years].filter(y => !covered.has(y)).length; }
  // Within a band, prefer clients spread across the band rather than all from its top.
  function spreadRank(s, pool) { return (pool.indexOf(s) * 7919) % (pool.length || 1); }
}

// ---------------------------------------------------------------- logging

/** One JSON line with whitelisted fields only: never names, paths, text or values. */
export function logLine(event, fields = {}) {
  const allowed = ['file_id', 'action', 'status', 'reason', 'chunks', 'tokens', 'ms', 'done', 'total',
    'embedded_tokens', 'errors', 'attempt', 'ms_wait', 'code', 'stopped', 'usd', 'files_per_min'];
  const out = { t: new Date().toISOString(), event };
  for (const k of allowed) if (fields[k] !== undefined) out[k] = fields[k];
  return JSON.stringify(out);
}

// ---------------------------------------------------------------- run

const BATCH_CHUNKS = 128;
const BATCH_TOKENS = 100000;

// A short, value-free error code for logs and status_reason.
const code = (err) => String(err?.statusCode || err?.response?.status || err?.code || err?.name || 'error').slice(0, 40);

/**
 * Process the plan. Deps are injected so tests run without network or database.
 * @param {Object[]} plan - from planRun
 * @param {{prepare, embed, store, log}} deps
 *   prepare(file) → {row, chunks}; embed(texts) → {vectors, tokens};
 *   store: {writeFile, rehome, updateMove}; log(line)
 * @param {{budget?: TokenBudget, limit?: number, concurrency?: number, existing?: Map}} [opts]
 */
export async function runIndex(plan, deps, { budget = new TokenBudget(), limit = Infinity, concurrency = 4, existing = new Map() } = {}) {
  const { prepare, embed, store, log } = deps;
  const started = Date.now();
  const stats = { done: 0, errors: 0, embedded_tokens: 0, chunks: 0, byStatus: {}, byReason: {}, duplicates: 0, moved: 0, rehomed: 0, stopped: null };
  const statusById = new Map([...existing].map(([id, r]) => [id, r.status]));
  const toProcess = plan.filter(p => p.action === 'process').slice(0, limit);
  const total = toProcess.length;

  const record = (row, chunks, ms) => {
    stats.done++;
    stats.chunks += chunks;
    stats.byStatus[row.status] = (stats.byStatus[row.status] || 0) + 1;
    if (row.status === 'failed') { stats.errors++; stats.byReason[row.status_reason] = (stats.byReason[row.status_reason] || 0) + 1; }
    statusById.set(row.file_id, row.status);
    log(logLine('file', { file_id: row.file_id, status: row.status, reason: row.status_reason ?? undefined, chunks, tokens: row.token_count ?? undefined, ms }));
    if (stats.done % 50 === 0) log(logLine('progress', { done: stats.done, total, embedded_tokens: stats.embedded_tokens, errors: stats.errors }));
  };

  // Files waiting for embedding, flushed in batches; one flush at a time.
  let pending = [];
  let flushing = Promise.resolve();
  const pendingSize = () => pending.reduce((n, p) => n + p.chunks.length, 0);
  const pendingTokens = () => pending.reduce((n, p) => n + p.chunks.reduce((m, c) => m + c.token_count, 0), 0);

  const flush = () => {
    flushing = flushing.then(async () => {
      if (!pending.length || stats.stopped) return;
      const batch = pending;
      pending = [];
      const estimated = batch.reduce((n, p) => n + p.chunks.reduce((m, c) => m + c.token_count, 0), 0);
      if (!budget.canSpend(estimated)) { stats.stopped = 'token ceiling'; return; }
      const texts = batch.flatMap(p => p.chunks.map(c => c.text));
      const vectors = [];
      try {
        for (let i = 0; i < texts.length; i += BATCH_CHUNKS) {
          const { vectors: v, tokens } = await embed(texts.slice(i, i + BATCH_CHUNKS));
          vectors.push(...v);
          budget.spend(tokens);
          stats.embedded_tokens += tokens;
        }
      } catch (err) {
        if (err?.code === 'voyage_key') throw err;  // a rejected key stops the run
        for (const p of batch) await writeFailed(p.row, `embed:${code(err)}`, p.ms);
        return;
      }
      let at = 0;
      for (const p of batch) {
        const mine = vectors.slice(at, at + p.chunks.length);
        at += p.chunks.length;
        try {
          await store.writeFile(p.row, p.chunks, mine);
          record(p.row, p.chunks.length, p.ms);
        } catch (err) {
          await writeFailed(p.row, `db:${code(err)}`, p.ms);
        }
      }
    });
    return flushing;
  };

  // A file that couldn't be embedded or stored: a failed row with no chunks, retried by --resume.
  const writeFailed = async (row, reason, ms) => {
    const failed = { ...row, status: 'failed', status_reason: reason, token_count: null, chunk_count: 0 };
    try { await store.writeFile(failed, [], []); } catch { /* the row stays absent; the next run retries it */ }
    record(failed, 0, ms);
  };

  let next = 0;
  const worker = async () => {
    while (next < toProcess.length && !stats.stopped) {
      const { file } = toProcess[next++];
      const t0 = Date.now();
      const { row, chunks } = await prepare(file);
      const ms = Date.now() - t0;
      if (!chunks.length) {
        try {
          await store.writeFile({ ...row, duplicate_of: null }, [], []);
          record(row, 0, ms);
        } catch (err) {
          await writeFailed({ ...row, duplicate_of: null }, `db:${code(err)}`, ms);
        }
        continue;
      }
      pending.push({ row: { ...row, duplicate_of: null }, chunks, ms });
      if (pendingSize() >= BATCH_CHUNKS || pendingTokens() >= BATCH_TOKENS) await flush();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  await flush();
  await flushing;

  if (!stats.stopped) {
    for (const { file, action, previousId } of plan) {
      if (action === 'rehome') {
        const row = { ...duplicateRow(file, null, statusById.get(previousId)), status_reason: null, chunk_count: null };
        await store.rehome(previousId, row);
        statusById.set(file.id, row.status);
        stats.rehomed++;
      } else if (action === 'move') {
        await store.updateMove({ file_id: file.id, name: file.name, path: file.path.join('/'), ...pathMeta(file.path), modified_time: file.modifiedTime || null });
        stats.moved++;
      }
    }
    for (const { file, action, canonicalId } of plan) {
      if (action !== 'duplicate') continue;
      const canonicalStatus = statusById.get(canonicalId);
      if (!canonicalStatus) continue;  // canonical not written (limit or ceiling): leave for the next run
      await store.writeFile(duplicateRow(file, canonicalId, canonicalStatus), [], []);
      stats.duplicates++;
    }
  }

  const minutes = (Date.now() - started) / 60000;
  stats.files_per_min = minutes > 0 ? +(stats.done / minutes).toFixed(1) : stats.done;
  stats.usd = +(stats.embedded_tokens / 1e6 * USD_PER_MILLION).toFixed(4);
  stats.ms = Date.now() - started;
  log(logLine('done', { done: stats.done, total, embedded_tokens: stats.embedded_tokens, errors: stats.errors, stopped: stats.stopped ?? undefined, usd: stats.usd, files_per_min: stats.files_per_min, ms: stats.ms }));
  return stats;
}
