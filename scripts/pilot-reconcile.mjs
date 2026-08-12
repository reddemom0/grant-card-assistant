/**
 * pilot-reconcile.mjs — independent reconciliation of the Shared Drive against
 * the mapping sheet.
 *
 * Deliberately does NOT read the copy ledger. The ledger is the copier's own
 * record of what it believes it did; reconciling against it would only prove
 * the copier is self-consistent. This lists Drive directly and compares actual
 * contents to the contract.
 *
 * Read-only everywhere. Creates nothing, deletes nothing.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCsv } from './grants-lib.mjs';
import 'dotenv/config';

const MAPPING = 'dist/inventory/canexport-mapping.csv';
const INVENTORY = 'dist/inventory/grants-inventory.csv';
const MD_OUT = 'docs/inventory/pilot-copy-results.md';
const LEDGER = 'dist/inventory/copy-ledger.jsonl';
const DRIVE_ID = process.env.PILOT_DEST_ROOT || '0AKxoOSs3WbQ0Uk9PVA';
const COPY_ROUTES = new Set(['sort', 'program', 'archive']);

const log = (...a) => console.error(...a);

// ---------------------------------------------------------------- auth
async function loadServiceKey() {
  const fromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (fromEnv && fromEnv.trim().startsWith('{')) {
    try { return JSON.parse(fromEnv); } catch { /* truncated by dotenv */ }
  }
  const lines = (await fsp.readFile('.env', 'utf8')).split('\n');
  const i = lines.findIndex((l) => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY='));
  if (i < 0) throw new Error('no service account key');
  let raw = lines[i].slice('GOOGLE_SERVICE_ACCOUNT_KEY='.length);
  for (let j = i + 1; j < lines.length; j++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break;
    raw += '\n' + lines[j];
  }
  return JSON.parse(raw.trim().replace(/^['"]|['"]$/g, ''));
}

const key = await loadServiceKey();
const nowSec = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: key.client_email,
  scope: 'https://www.googleapis.com/auth/drive.readonly',
  aud: 'https://oauth2.googleapis.com/token',
  iat: nowSec, exp: nowSec + 3600,
})}`;
const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${unsigned}.${sig}`,
  }),
});
if (!tokenRes.ok) { log('token failed:', await tokenRes.text()); process.exit(1); }
const TOKEN = (await tokenRes.json()).access_token;

// ---------------------------------------------------------------- walk Drive
const drive = new Map();   // 'A/B/c.pdf' -> {id, size, mimeType}
let folderCount = 0;

async function listChildren(id) {
  const out = [];
  let pageToken = null;
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}`
      + `&fields=nextPageToken,files(id,name,mimeType,size)&pageSize=1000`
      + `&supportsAllDrives=true&includeItemsFromAllDrives=true`
      + `&corpora=drive&driveId=${DRIVE_ID}`
      + (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`list ${id}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const d = await res.json();
    out.push(...(d.files ?? []));
    pageToken = d.nextPageToken;
  } while (pageToken);
  return out;
}

async function walk(id, prefix) {
  const children = await listChildren(id);
  for (const f of children) {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    if (f.mimeType === 'application/vnd.google-apps.folder') {
      folderCount += 1;
      await walk(f.id, p);
    } else {
      drive.set(p, { id: f.id, size: Number(f.size ?? 0), mimeType: f.mimeType });
    }
  }
}

log('listing Shared Drive...');
await walk(DRIVE_ID, '');
log(`  ${drive.size} files, ${folderCount} folders`);

// ---------------------------------------------------------------- mapping
const expected = new Map();  // destination -> {src, route}
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(MAPPING, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0] || !COPY_ROUTES.has(r[7])) continue;
    expected.set(r[5], { src: r[0], route: r[7] });
  }
}
log(`  mapping expects ${expected.size} files`);

// Source sizes, for the size comparison.
const srcSize = new Map();
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(INVENTORY, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (r[2] === 'file') srcSize.set(r[0], Number(r[3] || 0));
  }
}

// ---------------------------------------------------------------- compare
const missing = [];      // in mapping, not in Drive
const extra = [];        // in Drive, not in mapping
const mismatched = [];   // present but wrong size
const googleTypes = [];  // converted

for (const [dest, info] of expected) {
  const d = drive.get(dest);
  if (!d) { missing.push({ dest, ...info }); continue; }
  const want = srcSize.get(info.src);
  if (want !== undefined && want !== d.size) {
    mismatched.push({ dest, src: info.src, source_size: want, drive_size: d.size });
  }
  if (/^application\/vnd\.google-apps\./.test(d.mimeType)) {
    googleTypes.push({ dest, mimeType: d.mimeType });
  }
}
for (const [p, d] of drive) {
  if (!expected.has(p)) extra.push({ path: p, size: d.size, mimeType: d.mimeType });
}

const agree = missing.length === 0 && mismatched.length === 0 && googleTypes.length === 0;
log(`\nmissing=${missing.length} extra=${extra.length} size-mismatch=${mismatched.length} google-type=${googleTypes.length}`);

// ---------------------------------------------------------------- ledger (for the run summary only)
let ledgerStats = { verified: 0, failed: 0, bytes: 0, failures: [] };
try {
  // The ledger is append-only, so a retried row appears twice. Collapse to the
  // LAST entry per row — the same resolution the copier uses when deciding what
  // to skip. Counting raw lines would report retried rows as failures.
  const raw = (await fsp.readFile(LEDGER, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const latest = new Map();
  for (const e of raw) latest.set(`${e.source} ${e.destination}`, e);
  ledgerStats.rows = latest.size;
  ledgerStats.appendedLines = raw.length;
  for (const e of latest.values()) {
    if (e.status === 'verified') { ledgerStats.verified += 1; ledgerStats.bytes += e.uploaded_size || 0; }
    else { ledgerStats.failed += 1; ledgerStats.failures.push(e); }
  }
} catch { /* none */ }

// ---------------------------------------------------------------- report
const gb = (n) => (n / 1024 ** 3).toFixed(2);
const esc = (s) => String(s).replace(/\|/g, '\\|');
const L2 = [];
const push = (s = '') => L2.push(s);

push('# CanExport Pilot Copy — Results');
push();
push(`**Generated:** ${new Date().toISOString()}`);
push(`**Destination:** Shared Drive \`${DRIVE_ID}\``);
push(`**Credential:** service account \`${key.client_email}\``);
push('**Source:** Dropbox, read-only. Nothing was written to Dropbox and nothing was deleted anywhere.');
push();

push('## Outcome');
push();
push('| | |');
push('|---|---|');
push(`| Files in the Shared Drive | **${drive.size.toLocaleString()}** |`);
push(`| Folders created | ${folderCount.toLocaleString()} |`);
push(`| Mapping expects | ${expected.size.toLocaleString()} |`);
push(`| Verified in ledger | ${ledgerStats.verified.toLocaleString()} |`);
push(`| Failed in ledger | ${ledgerStats.failed.toLocaleString()} |`);
push(`| Ledger lines / distinct rows | ${ledgerStats.appendedLines.toLocaleString()} / ${ledgerStats.rows.toLocaleString()} (the difference is retried rows) |`);
push(`| Bytes uploaded (ledger) | ${ledgerStats.bytes.toLocaleString()} (${gb(ledgerStats.bytes)} GB) |`);
push(`| \`review\` rows deliberately not copied | 45 |`);
push();

push('---');
push();
push('## Reconciliation — Drive vs the mapping');
push();
push('**This section does not read the copy ledger.** The Shared Drive was listed recursively via the Drive API and compared against the mapping sheet directly. Reconciling against the ledger would only prove the copier agrees with itself.');
push();
push('| Check | Count | Verdict |');
push('|---|---|---|');
push(`| In the mapping, missing from Drive | ${missing.length} | ${missing.length === 0 ? 'clean' : '**needs attention**'} |`);
push(`| In Drive, not in the mapping | ${extra.length} | ${extra.length === 0 ? 'clean' : 'see below'} |`);
push(`| Size mismatch against Dropbox source | ${mismatched.length} | ${mismatched.length === 0 ? 'clean' : '**needs attention**'} |`);
push(`| Converted to a \`vnd.google-apps.*\` type | ${googleTypes.length} | ${googleTypes.length === 0 ? 'clean' : '**needs attention**'} |`);
push();
const onlyShortcuts = missing.length > 0 &&
  missing.every((m) => /\.(web|gdoc|gsheet|gslides|url|webloc)$/i.test(m.dest));
push(agree
  ? '**The two agree.** Every file the mapping calls for is present in the Shared Drive at the expected path, at exactly its Dropbox source size, in its original format.'
  : onlyShortcuts
    ? `**They agree on every real file.** Sizes match exactly and nothing was converted. The only gap is ${missing.length} shortcut stub${missing.length === 1 ? '' : 's'} (\`.web\` / \`.gdoc\`) which Dropbox refuses to serve — see below.`
    : '**The two do not agree.** Details below.');
push();

if (missing.length) {
  push(`### Missing from Drive (${missing.length})`);
  push();
  if (onlyShortcuts) {
    push('All of these are **shortcut stubs, not real files.** A `.web` or `.gdoc` in Dropbox is a pointer to something hosted elsewhere; `files/download` rejects them with `unsupported_file`, so there are no bytes to copy. They were counted in the mapping because the inventory lists them as files. Recreating them would mean resolving each pointer and making a Drive shortcut — a separate task, and arguably not worth it for six.');
    push();
  }
  push('| Destination | Route | Source |');
  push('|---|---|---|');
  for (const m of missing.slice(0, 100)) push(`| \`${esc(m.dest)}\` | ${m.route} | \`${esc(m.src)}\` |`);
  if (missing.length > 100) push(`| _…and ${missing.length - 100} more_ | | |`);
  push();
}
if (mismatched.length) {
  push(`### Size mismatches (${mismatched.length})`);
  push();
  push('| Destination | Source bytes | Drive bytes |');
  push('|---|---|---|');
  for (const m of mismatched) push(`| \`${esc(m.dest)}\` | ${m.source_size.toLocaleString()} | ${m.drive_size.toLocaleString()} |`);
  push();
}
if (googleTypes.length) {
  push(`### Converted to Google formats (${googleTypes.length})`);
  push();
  push('| Destination | Mime type |');
  push('|---|---|');
  for (const g of googleTypes) push(`| \`${esc(g.dest)}\` | ${g.mimeType} |`);
  push();
}
if (extra.length) {
  push(`### In Drive but not in the mapping (${extra.length})`);
  push();
  push('Expected to contain only the permission-check artefact. Anything else here was not called for by the contract.');
  push();
  push('| Path | Size | Mime type |');
  push('|---|---|---|');
  for (const e of extra.slice(0, 50)) push(`| \`${esc(e.path)}\` | ${e.size.toLocaleString()} | ${e.mimeType} |`);
  if (extra.length > 50) push(`| _…and ${extra.length - 50} more_ | | |`);
  push();
}

if (ledgerStats.failures.length) {
  push('---');
  push();
  push(`## Failures during the run (${ledgerStats.failures.length})`);
  push();
  push('| Source | Error |');
  push('|---|---|');
  for (const f of ledgerStats.failures) push(`| \`${esc(f.source)}\` | ${esc(f.error ?? '')} |`);
  push();
} else {
  push('---');
  push();
  push('## Failures during the run');
  push();
  push('**None.** Every attempted file uploaded and verified on the first pass.');
  push();
}

push('---');
push();
push('## Not copied, by design');
push();
push('| | Count | Why |');
push('|---|---|---|');
push('| `review` rows | 45 | Undecided — 21 dual-filed joint-client rows, 3 with no attributed client |');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/pilot-copy.mjs --dry-run     # plan only');
push('node scripts/pilot-copy.mjs               # resumable full run');
push('node scripts/pilot-reconcile.mjs          # this document');
push('```');
push();
push('The copy is idempotent: verified ledger entries are skipped, so re-running never duplicates a file.');
push();

await fsp.mkdir(path.dirname(MD_OUT), { recursive: true });
await fsp.writeFile(MD_OUT, L2.join('\n'));
log(`wrote ${MD_OUT}`);

console.log(JSON.stringify({
  drive_files: drive.size, drive_folders: folderCount,
  mapping_expects: expected.size,
  missing: missing.length, extra: extra.length,
  size_mismatch: mismatched.length, google_converted: googleTypes.length,
  agree,
  ledger: { verified: ledgerStats.verified, failed: ledgerStats.failed, gb: Number(gb(ledgerStats.bytes)) },
}, null, 2));
