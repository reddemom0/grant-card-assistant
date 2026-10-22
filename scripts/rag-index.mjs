#!/usr/bin/env node
/**
 * Granted Files RAG — bulk indexer CLI (phase 2)
 *
 * Lists Granted Files live, then exclude → extract → redact → chunk → embed
 * (voyage-3.5, 512 dims) → write drive_files / drive_chunks, one transaction per
 * file. Resumable: files already written with unchanged content are skipped.
 * Drive is read-only and paced at ≤ 4 requests/s.
 *
 * The database has no public proxy, so real runs happen inside the
 * grant-card-assistant container (railway ssh), detached:
 *   setsid nohup node scripts/rag-index.mjs --subtree Programs > /tmp/rag-index.log 2>&1 &
 *
 * Flags:
 *   --subtree "<path>"   repeatable; e.g. Programs, "Clients/Acme Ltd". Default: all of Granted Files
 *   --trial-clients N    add N clients picked across sizes and years 2019–2026 (printed)
 *   --limit N            process at most N new/changed files
 *   --max-tokens N       hard ceiling on embedded tokens; stops cleanly when reached
 *   --dry                list, plan and estimate only: no embeddings, no DB writes
 *   --no-db              with --dry: don't read the DB (it isn't reachable locally)
 *   --resume             also retry files whose last attempt failed
 *   --status [--since ISO]   progress and totals from the DB (read-only)
 *   --search "<q>"       repeatable; top 3 chunks by exact cosine (read-only)
 *   --as you@granted.ca  Drive identity (default writers@granted.ca)
 *
 * Logs are JSON lines with file IDs, statuses and counts only. Key problems are
 * reported as "(value not shown)".
 */

import dotenv from 'dotenv';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const values = (name) => args.flatMap((a, i) => (a === name && args[i + 1] !== undefined ? [args[i + 1]] : []));
const number = (name, fallback) => (values(name).length ? Number(values(name)[0]) : fallback);

const safe = (err) => String(err?.statusCode || err?.response?.status || err?.code || err?.name || 'error').slice(0, 40);
const fail = (err) => {
  const msg = err?.message || '';
  console.error(`Failed: ${msg.includes('(value not shown)') || /^(GOOGLE_SERVICE_ACCOUNT_KEY|VOYAGE_API_KEY) /.test(msg) ? msg : safe(err)}`);
  process.exit(1);
};
process.on('unhandledRejection', fail);

function loadEnv({ google = true, voyage = true }) {
  dotenv.config({ path: new URL('../.env', import.meta.url).pathname, quiet: true });
  if (google) {
    let key = null;
    try { key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || ''); } catch { key = null; }
    if (!key?.private_key || !key?.client_email) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY could not be parsed (value not shown)');
  }
  if (voyage && !process.env.VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY is not set (value not shown)');
}

async function main() {
  const dry = flag('--dry');
  const noDb = flag('--no-db');
  if (noDb && !dry) throw new Error('--no-db only works with --dry');

  if (flag('--status')) {
    loadEnv({ google: false, voyage: false });
    const store = await import('../src/services/rag/store.js');
    const since = values('--since')[0] || null;
    console.log(JSON.stringify(await store.status(since), null, 1));
    process.exit(0);
  }

  if (values('--search').length) {
    loadEnv({ google: false, voyage: true });
    const { embedQuery } = await import('../src/services/rag/voyage.js');
    const store = await import('../src/services/rag/store.js');
    for (const q of values('--search')) {
      const { vector } = await embedQuery(q);
      const t0 = performance.now();
      const hits = await store.search(vector, 3);
      const ms = Math.round(performance.now() - t0);
      console.log(`\nQ: ${q}   (SQL ${ms} ms)`);
      for (const h of hits) console.log(`  ${Number(h.score).toFixed(3)}  ${h.name}  [${h.locator || '-'}]  ${h.area}${h.year ? ` ${h.year}` : ''}`);
    }
    process.exit(0);
  }

  loadEnv({ google: true, voyage: !dry });
  const { delegatedDriveClient } = await import('../src/tools/google-drive.js');
  const { createLimiter, withDriveRetry } = await import('../src/services/rag/drive-retry.js');
  const { fetchForIndex } = await import('../src/services/rag/drive-source.js');
  const { prepareFile } = await import('../src/services/rag/prepare.js');
  const indexer = await import('../src/services/rag/indexer.js');

  const subject = values('--as')[0] || 'writers@granted.ca';
  const drive = delegatedDriveClient(subject);  // read-only scopes
  const limiter = createLimiter(4);
  const calls = {};
  const log = (line) => console.log(line);
  const onRetry = ({ attempt, status, ms }) => log(indexer.logLine('retry', { attempt, code: String(status), ms_wait: ms }));
  const drv = (method, fn) => withDriveRetry(() => { calls[method] = (calls[method] || 0) + 1; return fn(); }, { limiter, onRetry });

  const t0 = Date.now();
  const all = await indexer.listGrantedFiles((params) => drv('files.list', () => drive.files.list(params)));
  log(indexer.logLine('listed', { total: all.length, ms: Date.now() - t0 }));

  const subtrees = values('--subtree');
  const trialN = number('--trial-clients', 0);
  if (trialN) {
    const clients = indexer.pickTrialClients(all, trialN);
    console.log(`\nTrial clients (${clients.length}):`);
    for (const c of clients) console.log(`  ${c.name}  — ${c.files} in-scope files, years ${c.years.join(', ')}`);
    subtrees.push(...clients.map(c => `Clients/${c.name}`));
  }
  if (!subtrees.length && !flag('--all')) throw new Error('give --subtree (or --all for the whole of Granted Files)');
  const files = indexer.inSubtrees(all, subtrees);

  let existing = new Map();
  let storedCanonical = new Map();
  let store = null;
  if (!noDb) {
    store = await import('../src/services/rag/store.js');
    existing = new Map((await store.existingRows(files.map(f => f.id))).map(r => [r.file_id, r]));
    storedCanonical = await store.canonicalByMd5([...new Set(files.map(f => f.md5Checksum).filter(Boolean))]);
  }

  const plan = indexer.planRun(files, existing, storedCanonical, { resume: flag('--resume') });
  const est = indexer.estimate(plan);
  const limit = number('--limit', Infinity);
  const maxTokens = number('--max-tokens', Infinity);
  console.log(`\nScope: ${subtrees.length} subtree(s), ${files.length} files listed.`);
  console.log(`Plan: ${JSON.stringify(est.byAction)}`);
  console.log(`To process by kind: ${JSON.stringify(est.byKind)}`);
  console.log(`Estimate: ~${est.tokens.toLocaleString()} tokens, ~$${est.usd} at $0.06/M list price${Number.isFinite(limit) ? ` (before --limit ${limit})` : ''}.`);
  console.log(`Ceiling: ${Number.isFinite(maxTokens) ? maxTokens.toLocaleString() : 'none'} tokens.`);

  if (dry) {
    console.log(`\nDry run: no embeddings, no DB writes. Drive calls: ${JSON.stringify(calls)}`);
    process.exit(0);
  }

  const { embedDocuments } = await import('../src/services/rag/voyage.js');
  const stats = await indexer.runIndex(plan, {
    prepare: (file) => prepareFile(file, (f) => drv(f.kind === 'gdoc' || f.kind === 'gsheet' ? 'files.export' : 'files.get(alt=media)',
      () => fetchForIndex(drive, f))),
    embed: embedDocuments,
    store,
    log
  }, { budget: new indexer.TokenBudget(maxTokens), limit, existing });

  console.log(`\nSummary: ${JSON.stringify({ ...stats, drive_calls: calls })}`);
  process.exit(0);
}

main().catch(fail);
