/**
 * Granted Files RAG — nightly updater (phase 3)
 *
 *   02:00 America/Vancouver   read the Granted Files change feed from the
 *                             updater's own position (rag_runs, migration 060)
 *                             and bring drive_files / drive_chunks up to date
 *
 * Per change:
 *   new, or content changed (md5 / modifiedTime)  → exclude → extract → redact → chunk → embed
 *   moved or renamed only                          → path, name and tags updated, no re-embed
 *   moved into an excluded area                    → chunks deleted, row 'excluded'
 *   moved out of an excluded area                  → indexed
 *   trashed or deleted                             → chunks deleted, row 'removed'
 *   kept copy trashed, excluded or edited          → its chunks move to the best allowed copy (rehome) first
 *
 * A folder move or rename is one change in the feed, so a changed folder with no
 * stored rows under its current path (moved or renamed) is expanded to every
 * file below it; a folder whose rows already carry its path only had its
 * contents change, and those files arrive as changes of their own. A trashed
 * folder removes every row under its old path.
 *
 * The first run with no stored position records one and processes nothing. A
 * run that stops at the token ceiling or fails keeps the old position, so the
 * next run re-reads the same changes and skips files already written.
 *
 * Off unless RAG_NIGHTLY_ENABLED=true. RAG_NIGHTLY_MAX_TOKENS caps a run
 * (default 5M). Logs carry IDs, statuses and counts only. Assumes one instance;
 * the per-day claim in rag_runs guards against a second.
 */

import { FOLDER_MIME } from '../../tools/google-drive.js';
import { planRun, chooseCanonical, indexable, duplicateRow, runIndex, TokenBudget, estimate, logLine } from './indexer.js';
import { exclusionReason } from './exclude.js';
import { startToken, readChanges, pathResolver, filesUnder, goneFolderPath } from './changes.js';

export const SCHEDULE = '0 2 * * *';
const TZ = 'America/Vancouver';
export const DEFAULT_MAX_TOKENS = 5_000_000;
const CANONICAL_STATUSES = ['indexed', 'scanned'];

export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const code = (err) => String(err?.statusCode || err?.response?.status || err?.code || err?.name || 'error').slice(0, 40);

/** A stored row as the file shape planRun and prepareFile expect. */
const rowToFile = (r) => ({
  id: r.file_id, name: r.name, mimeType: r.mime, md5Checksum: r.md5 || undefined,
  modifiedTime: r.modified_time ? new Date(r.modified_time).toISOString() : undefined,
  path: r.path ? r.path.split('/') : []
});

// ---------------------------------------------------------------- planning (pure)

/**
 * What to do with tonight's changes.
 * @param {{changed: Object[], goneIds: Set<string>, existing: Map<string, Object>, groups: Object[]}} input
 *   changed - live files with fresh metadata and path[]; goneIds - trashed or deleted;
 *   existing - stored rows by file_id; groups - every live row sharing an md5 with a changed or gone file
 * @returns {{rehomes: {file, previousId, status}[], remove: string[], plan: Object[], existing: Map, skipped: number}}
 */
export function planNightly({ changed, goneIds, existing, groups }) {
  const live = changed.filter(f => !goneIds.has(f.id));
  const changedIds = new Set(live.map(f => f.id));
  const remove = [...goneIds].filter(id => existing.has(id) && existing.get(id).status !== 'removed');

  // Every live copy of each affected md5, so canonicals are chosen over the whole group.
  const files = [...live, ...groups.filter(r => !changedIds.has(r.file_id) && !goneIds.has(r.file_id)).map(rowToFile)];
  const current = new Map(files.map(f => [f.id, f]));
  const exist = new Map(existing);

  // A kept copy that is leaving (gone, now excluded, or its content changed) hands its
  // chunks to the best allowed copy before it is removed or reprocessed.
  const storedCanonical = new Map();
  const rehomes = [];
  for (const r of groups) {
    if (r.duplicate_of || !CANONICAL_STATUSES.includes(r.status) || !r.md5 || storedCanonical.has(r.md5)) continue;
    const now = current.get(r.file_id);
    const leaving = !now || !indexable(now) || now.md5Checksum !== r.md5;
    if (!leaving) { storedCanonical.set(r.md5, r.file_id); continue; }
    const allowed = files.filter(f => f.md5Checksum === r.md5 && f.id !== r.file_id && indexable(f));
    if (!allowed.length) continue;
    const best = chooseCanonical(allowed);
    rehomes.push({ file: best, previousId: r.file_id, status: r.status });
    storedCanonical.set(r.md5, best.id);
    const prev = exist.get(best.id);
    exist.set(best.id, {
      file_id: best.id, md5: r.md5, status: r.status, duplicate_of: null,
      name: prev?.name ?? best.name, path: prev?.path ?? best.path.join('/'), modified_time: prev?.modified_time ?? best.modifiedTime
    });
  }

  let skipped = 0;
  const plan = [];
  for (const p of planRun(files, exist, storedCanonical)) {
    const row = exist.get(p.file.id);
    let action = p.action;
    // planRun treats same content as unchanged; a change of exclusion state or a
    // restored file still needs the pipeline (excluded rows lose their chunks there).
    if (row && (action === 'skip' || action === 'move')) {
      const nowExcluded = Boolean(exclusionReason({ path: p.file.path, name: p.file.name }));
      if (row.status === 'removed' || (row.status === 'excluded') !== nowExcluded) action = 'process';
    }
    if (action === 'skip') { skipped++; continue; }
    plan.push({ ...p, action });
  }
  return { rehomes, remove, plan, existing: exist, skipped };
}

/** Counts by action, for logs, the run record and --nightly --dry. */
export function countActions({ rehomes, remove, plan, skipped }) {
  const out = { rehome: rehomes.length, remove: remove.length, skip: skipped };
  for (const { action } of plan) out[action] = (out[action] || 0) + 1;
  return out;
}

// ---------------------------------------------------------------- gathering

/**
 * Read the feed from `token`, expand changed folders, resolve paths, find rows
 * under gone folders, and load the stored rows the planner needs. Read-only.
 */
export async function collectChanges({ drive, call, store }, token, { since = null } = {}) {
  const { live, gone, token: tokenAfter, changes } = await readChanges(drive, token, { since, call });
  const resolver = pathResolver(drive, call);

  // Drive also reports a folder when its contents change. Rows already stored under
  // its current path mean it wasn't moved or renamed, so its files need no listing.
  const changed = new Map();
  let folders = 0;
  let foldersSkipped = 0;
  for (const item of live.values()) {
    if (item.mimeType !== FOLDER_MIME) continue;
    const path = await resolver.folderPath(item.id);
    if (await store.hasRowsUnder(path.join('/'))) { foldersSkipped++; continue; }
    folders++;
    for (const f of await filesUnder(drive, item.id, path, call)) if (!changed.has(f.id)) changed.set(f.id, f);
  }
  for (const item of live.values()) {
    if (item.mimeType !== FOLDER_MIME) changed.set(item.id, { ...item, path: await resolver.parentPath(item) });
  }

  const goneIds = new Set();
  const goneWithRows = new Set((await store.existingRows([...gone.keys()])).map(r => r.file_id));
  for (const [id, meta] of gone) {
    if (goneWithRows.has(id)) { goneIds.add(id); continue; }
    if (meta?.mimeType && meta.mimeType !== FOLDER_MIME) continue;  // a file that was never indexed
    const path = await goneFolderPath(drive, id, meta, resolver, call);
    if (path) for (const fileId of await store.rowsUnderPath(path.join('/'))) if (!changed.has(fileId)) goneIds.add(fileId);
  }

  const changedList = [...changed.values()].filter(f => !goneIds.has(f.id));
  const rows = await store.existingRows([...changedList.map(f => f.id), ...goneIds]);
  const existing = new Map(rows.map(r => [r.file_id, r]));
  const md5s = new Set([...changedList.map(f => f.md5Checksum), ...rows.map(r => r.md5)].filter(Boolean));
  const groups = await store.groupRows([...md5s]);
  for (const r of groups) if (!existing.has(r.file_id)) existing.set(r.file_id, r);

  return { changed: changedList, goneIds, existing, groups, tokenAfter, changes, folders, foldersSkipped };
}

// ---------------------------------------------------------------- run

/**
 * One nightly run. With `dry`, plan and estimate only: no claim, no writes, no embeddings.
 * With `since`, read from the filing sweep's last position at or before that time
 * (borrowed, never advanced) and keep only changes at or after it.
 * @returns {Promise<Object>} {status, ...counts}
 */
export async function runNightly({ env = process.env, now = new Date(), deps = null, since = null, dry = false, maxTokens = null } = {}) {
  const d = deps || await defaultDeps(env);
  const { store, log } = d;
  const ceiling = maxTokens ?? (Number(env.RAG_NIGHTLY_MAX_TOKENS) || DEFAULT_MAX_TOKENS);

  let token;
  try {
    if (since) {
      const borrowed = await store.sweepTokenAtOrBefore(since);
      if (!borrowed) return { status: 'no_position_before_since' };
      token = borrowed.token;
    } else {
      token = await store.lastToken();
    }
  } catch (err) {
    if (err?.code === '42P01') { log('Granted Files nightly: rag_runs missing (migration 060 not applied)'); return { status: 'no_state_table' }; }
    throw err;
  }

  if (dry) {
    if (!token) return { status: 'baseline_next' };
    const c = await collectChanges(d, token, { since });
    const p = planNightly(c);
    return { status: 'dry', changes: c.changes, folders: c.folders, folders_skipped: c.foldersSkipped, actions: countActions(p), estimate: estimate(p.plan), ceiling };
  }

  const date = localDate(now);
  if (!token) {
    const id = await store.claimRun('baseline', date, null);
    if (!id) return { status: 'already_ran' };
    try {
      await store.finishRun(id, { status: 'done', tokenAfter: await startToken(d.drive, d.call) });
    } catch (err) {
      await store.finishRun(id, { status: 'failed', errorCode: code(err) }).catch(() => {});
      throw err;
    }
    log(logLine('baseline'));
    return { status: 'baseline' };
  }

  const id = await store.claimRun('nightly', date, token);
  if (!id) return { status: 'already_ran' };
  const started = Date.now();
  try {
    const c = await collectChanges(d, token, { since });
    const p = planNightly(c);
    for (const r of p.rehomes) {
      await store.rehome(r.previousId, { ...duplicateRow(r.file, null, r.status), status_reason: null, chunk_count: null });
    }
    for (const fileId of p.remove) await store.markRemoved(fileId);
    const stats = await runIndex(p.plan, { prepare: d.prepare, embed: d.embed, store, log },
      { budget: new TokenBudget(ceiling), concurrency: 2, existing: p.existing });

    const status = stats.stopped ? 'stopped' : 'done';
    const actions = countActions(p);
    await store.finishRun(id, {
      status, tokenAfter: c.tokenAfter, counts: { changes: c.changes, folders: c.folders, folders_skipped: c.foldersSkipped, actions, byStatus: stats.byStatus },
      tokens: stats.embedded_tokens, usd: stats.usd, errors: stats.errors
    });
    log(JSON.stringify({ t: new Date().toISOString(), event: 'nightly', status, changes: c.changes, folders: c.folders, actions,
      embedded_tokens: stats.embedded_tokens, usd: stats.usd, errors: stats.errors, ms: Date.now() - started }));
    return { status, changes: c.changes, folders: c.folders, actions, tokens: stats.embedded_tokens, usd: stats.usd, errors: stats.errors };
  } catch (err) {
    await store.finishRun(id, { status: 'failed', errorCode: code(err) }).catch(() => {});
    throw err;
  }
}

/**
 * Production wiring: read-only Drive as `as` (default writers@granted.ca), paced at
 * ≤ 4 requests/s with retry; Voyage for embeddings; the real store. `onCall` counts
 * Drive calls and `onRetry` sees retries (the CLI prints both).
 */
export async function defaultDeps(env = process.env, { as = env.RAG_NIGHTLY_AS || 'writers@granted.ca', onCall = () => {}, onRetry, log = console.log } = {}) {
  const { delegatedDriveClient } = await import('../../tools/google-drive.js');
  const { createLimiter, withDriveRetry } = await import('./drive-retry.js');
  const { fetchForIndex } = await import('./drive-source.js');
  const { prepareFile } = await import('./prepare.js');
  const { embedDocuments } = await import('./voyage.js');
  const store = await import('./store.js');

  const drive = delegatedDriveClient(as);  // read-only scopes
  const limiter = createLimiter(4);
  const call = (method, fn) => withDriveRetry(() => { onCall(method); return fn(); }, { limiter, onRetry });
  const prepare = async (file) => {
    await new Promise(resolve => setImmediate(resolve));  // let requests in between files
    return prepareFile(file, (f) => call(f.kind === 'gdoc' || f.kind === 'gsheet' ? 'files.export' : 'files.get(alt=media)',
      () => fetchForIndex(drive, f)));
  };
  return { drive, call, store, prepare, embed: embedDocuments, log };
}

// ---------------------------------------------------------------- schedule

export function startRagNightly(cron, env = process.env) {
  if (env.RAG_NIGHTLY_ENABLED !== 'true') {
    console.log('⏸️  Granted Files nightly index off (RAG_NIGHTLY_ENABLED is not "true")');
    return false;
  }
  const run = async () => {
    try {
      const result = await runNightly({ env });
      console.log(`📚 Granted Files nightly index: ${result.status}`);
    } catch (err) {
      console.error(`❌ Granted Files nightly index failed — code: ${code(err)}`);
    }
  };
  cron.schedule(SCHEDULE, run, { name: 'rag-nightly', timezone: TZ, noOverlap: true });
  console.log('✅ Granted Files nightly index scheduled (02:00 America/Vancouver)');
  return true;
}
