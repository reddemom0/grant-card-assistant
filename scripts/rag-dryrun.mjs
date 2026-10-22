#!/usr/bin/env node
/**
 * Granted Files RAG — read-only dry run of the phase 1 pipeline on ~30 real files.
 *
 * Picks a fixed, stratified sample from the audit inventory
 * (dist/inventory/granted-files-audit-inventory.jsonl), fetches each in-scope file
 * read-only (files.export / files.get), then extracts, redacts and chunks it with
 * src/services/rag/prepare.js. No embedding calls, no database, no Drive writes.
 *
 * Prints per file: ID prefix, kind, area, year, status, tokens, chunks, truncated
 * and redaction COUNTS. Never names, paths, file text or redacted values, and never
 * key material: a key that can't be parsed fails with "(value not shown)".
 *
 * Usage: node --network-family-autoselection-attempt-timeout=5000 scripts/rag-dryrun.mjs [--as you@granted.ca]
 */

import fs from 'fs';
import dotenv from 'dotenv';

const INVENTORY = new URL('../dist/inventory/granted-files-audit-inventory.jsonl', import.meta.url);
const asIndex = process.argv.indexOf('--as');
const SUBJECT = asIndex > 0 ? process.argv[asIndex + 1] : 'writers@granted.ca';

// Errors print a code and a reason only: some library messages quote their input.
const safe = (err) => String(err?.response?.status || err?.code || err?.name || 'error').slice(0, 40);
process.on('unhandledRejection', (err) => { console.error(`Failed: ${safe(err)}`); process.exit(1); });

function loadKey() {
  dotenv.config({ path: new URL('../.env', import.meta.url).pathname, quiet: true });
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set');
  let key;
  try { key = JSON.parse(raw); } catch { key = null; }
  if (!key?.private_key || !key?.client_email) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY could not be parsed (value not shown)');
}

// Deterministic sample: a seeded shuffle, then the first matches per bucket.
function seeded(seed) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function pickSample(rows, { ragKind, exclusionReason }) {
  const rnd = seeded(20261022);
  const files = rows
    .filter(r => r.drive === 'Granted Files')
    .map(r => {
      const parts = r.path.split('/');
      return { ...r, folders: parts.slice(0, -1), ext: r.name.split('.').pop().toLowerCase() };
    })
    .map(r => ({ r, k: rnd() }))
    .sort((a, b) => a.k - b.k)
    .map(x => x.r);

  const inScope = (f) => ragKind(f.mimeType, f.name) && !exclusionReason({ path: f.folders, name: f.name });
  const area = (f) => f.folders[0];
  const chosen = new Map();
  const take = (label, n, test) => {
    for (const f of files) {
      if ([...chosen.values()].filter(c => c.label === label).length >= n) return;
      if (!chosen.has(f.id) && test(f)) chosen.set(f.id, { ...f, label });
    }
  };
  const kindIs = (k) => (f) => inScope(f) && ragKind(f.mimeType, f.name) === k;
  const inArea = (a) => (f) => area(f) === a;
  const both = (...tests) => (f) => tests.every(t => t(f));

  for (const [a, n] of [['Clients', 3], ['Old Files', 2], ['Programs', 1], ['Departments', 1]]) take(`pdf:${a}`, n, both(kindIs('pdf'), inArea(a)));
  take('pdf:large', 1, both(kindIs('pdf'), f => Number(f.size) > 3e6 && Number(f.size) < 3e7));
  take('word:docx', 3, both(kindIs('docx'), f => f.ext === 'docx', f => ['Clients', 'Programs', 'Old Files'].includes(area(f))));
  take('word:doc', 1, both(kindIs('doc')));
  take('word:docm', 1, both(kindIs('docx'), f => f.ext === 'docm'));
  take('excel:xlsx', 3, both(kindIs('xlsx'), f => f.ext === 'xlsx', f => ['Clients', 'Departments', 'Old Files'].includes(area(f))));
  take('excel:xls', 1, both(kindIs('xlsx'), f => f.ext === 'xls'));
  take('excel:xlsm', 1, both(kindIs('xlsx'), f => f.ext === 'xlsm'));
  for (const [a, n] of [['Clients', 2], ['Programs', 1], ['Departments', 1]]) take(`gdoc:${a}`, n, both(kindIs('gdoc'), inArea(a)));
  for (const a of ['Clients', 'Programs', 'Departments']) take(`gsheet:${a}`, 1, both(kindIs('gsheet'), inArea(a)));
  const biggestSheet = files.filter(kindIs('gsheet')).sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0];
  if (biggestSheet) chosen.set(biggestSheet.id, { ...biggestSheet, label: 'gsheet:largest' });
  take('excluded:path', 1, f => ragKind(f.mimeType, f.name) && exclusionReason({ path: f.folders, name: f.name }) === 'sensitive_path');
  take('excluded:name', 1, f => ragKind(f.mimeType, f.name) && exclusionReason({ path: f.folders, name: f.name }) === 'sensitive_name');
  take('skipped:image', 1, f => String(f.mimeType).startsWith('image/'));
  take('skipped:shortcut', 1, f => f.mimeType === 'application/vnd.google-apps.shortcut');
  return [...chosen.values()];
}

async function main() {
  loadKey();
  // Imported only after the key check: google-drive.js reads the key at import time.
  const { delegatedDriveClient } = await import('../src/tools/google-drive.js');
  const { ragKind } = await import('../src/services/rag/extract.js');
  const { exclusionReason } = await import('../src/services/rag/exclude.js');
  const { fetchForIndex } = await import('../src/services/rag/drive-source.js');
  const { prepareFile } = await import('../src/services/rag/prepare.js');

  const rows = fs.readFileSync(INVENTORY, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const sample = pickSample(rows, { ragKind, exclusionReason });
  const drive = delegatedDriveClient(SUBJECT);  // read-only scopes
  const calls = {};
  const onCall = (method) => { calls[method] = (calls[method] || 0) + 1; };

  console.log(`Inventory rows: ${rows.length}. Sample: ${sample.length} files. Acting as ${SUBJECT} (read-only).\n`);
  const header = ['id', 'sample', 'kind', 'area', 'year', 'status', 'reason', 'tokens', 'chunks', 'trunc', 'sin', 'card', 'bank', 'secs'];
  console.log(header.join('\t'));

  const totals = { files: 0, tokens: 0, chunks: 0, sin: 0, card: 0, bank: 0, byStatus: {} };
  for (const f of sample) {
    const started = Date.now();
    let row;
    try {
      ({ row } = await prepareFile(
        { id: f.id, name: f.name, mimeType: f.mimeType, path: f.folders, md5Checksum: f.md5Checksum, modifiedTime: f.modifiedTime, size: f.size },
        (file) => fetchForIndex(drive, file, { onCall })
      ));
    } catch (err) {
      row = { status: 'failed', status_reason: `prepare:${safe(err)}`, area: f.folders[0], year: null, redaction_counts: { sin: 0, card: 0, bank: 0 } };
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const kind = ragKind(f.mimeType, f.name) || '-';
    const rc = row.redaction_counts;
    console.log([f.id.slice(0, 8), f.label, kind, row.area, row.year ?? '-', row.status, row.status_reason ?? '-',
      row.token_count ?? '-', row.chunk_count ?? '-', row.truncated ? 'yes' : '-', rc.sin, rc.card, rc.bank, secs].join('\t'));
    totals.files++;
    totals.tokens += row.token_count || 0;
    totals.chunks += row.chunk_count || 0;
    totals.sin += rc.sin; totals.card += rc.card; totals.bank += rc.bank;
    totals.byStatus[row.status] = (totals.byStatus[row.status] || 0) + 1;
  }

  console.log(`\nTotals: ${totals.files} files, ${totals.tokens} tokens, ${totals.chunks} chunks; redactions sin=${totals.sin} card=${totals.card} bank=${totals.bank}`);
  console.log(`By status: ${JSON.stringify(totals.byStatus)}`);
  console.log(`Drive API calls (read-only): ${JSON.stringify(calls)}`);
  console.log('No embedding calls, no database access.');
}

main().catch((err) => {
  console.error(`Failed: ${err?.message?.includes('(value not shown)') || err?.message?.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY') ? err.message : safe(err)}`);
  process.exit(1);
});
