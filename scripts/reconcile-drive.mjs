/**
 * reconcile-drive.mjs — independent reconciliation of the Shared Drive against
 * one or more mapping sheets.
 *
 * Deliberately does NOT read the copy ledger. The ledger is the copier's own
 * account of what it believes it did; reconciling against it would only prove
 * the copier is self-consistent. This lists Drive itself and compares actual
 * contents to the contract.
 *
 * Sizes are compared against LIVE Dropbox metadata, not grants-inventory.csv.
 * The inventory is a point-in-time snapshot and the team keeps editing source
 * files during the migration — on 2026-08-18 it produced a false size mismatch
 * for a file edited in Dropbox four days after the snapshot. A source that has
 * changed since its copy is reported as `source_changed_since_copy`, distinct
 * from a real mismatch; a source no longer present in Dropbox at all is
 * `source_gone_from_dropbox`.
 *
 * Listing methods, both read-only:
 *   Drive:   one flat paginated files.list scoped to the drive, paths
 *            reconstructed locally from parent ids (~92 calls, ~2 min — the
 *            folder-recursive walk it replaced needed ~10,000 calls, 51 min).
 *   Dropbox: files/list_folder recursive over the Grants tree (metadata only).
 *
 * Usage:
 *   node scripts/reconcile-drive.mjs --mapping dist/inventory/full-mapping.csv \
 *     [--mapping dist/inventory/canexport-mapping.csv] \
 *     [--program "ETG (Employer Training Grant)"]
 *
 * The union of all --mapping sheets defines what is allowed to be in Drive
 * (the "extra files" check). --program restricts the presence/size checks to
 * that program's rows of the first sheet.
 *
 *   --folders-only <path>   list Drive, write every folder path (one per line,
 *                           shallow-first) to <path>, and exit. No Dropbox
 *                           call, no comparison. Feeds the case-folding pass
 *                           in full-mapping.mjs: Drive's spellings are the
 *                           reference where case-variant folders were merged.
 */
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { parseCsv } from './grants-lib.mjs';
import 'dotenv/config';

const MAPPINGS = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--mapping') MAPPINGS.push(argv[++i]);
}
if (!MAPPINGS.length) MAPPINGS.push('dist/inventory/full-mapping.csv');
const ONLY_PROGRAM = (() => {
  const i = argv.indexOf('--program');
  return i >= 0 ? argv[i + 1] : null;
})();
const FOLDERS_ONLY = (() => {
  const i = argv.indexOf('--folders-only');
  return i >= 0 ? argv[i + 1] : null;
})();

const DRIVE_ID = process.env.PILOT_DEST_ROOT || '0AKxoOSs3WbQ0Uk9PVA';
const GRANTS_PATH = '/granted team folder/sales/grants';
const COPY_ROUTES = new Set(['sort', 'program', 'archive']);
const T_META = 60_000;
const log = (...a) => console.error(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(label, fn, attempts = 5) {
  let delay = 1000;
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) {
      if (i >= attempts) throw new Error(`${label}: ${err.message}`);
      await sleep(delay); delay = Math.min(delay * 2, 16000);
    }
  }
}

// ---------------------------------------------------------------- Drive auth
async function loadServiceKey() {
  const fromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (fromEnv && fromEnv.trim().startsWith('{')) { try { return JSON.parse(fromEnv); } catch { /* truncated */ } }
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
  iss: key.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly',
  aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 })}`;
const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
const tokRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  signal: AbortSignal.timeout(T_META),
});
if (!tokRes.ok) { log('drive token failed:', await tokRes.text()); process.exit(1); }
const DRIVE_TOKEN = (await tokRes.json()).access_token;

// -------------------------------------------------------- Drive flat listing
const drive = new Map();          // path -> {id, size, mimeType}
const shortcuts = [];
let folderCount = 0;
{
  const items = []; let pageToken = null; let page = 0;
  do {
    const url = 'https://www.googleapis.com/drive/v3/files'
      + `?q=${encodeURIComponent('trashed = false')}`
      + '&fields=nextPageToken,files(id,name,mimeType,size,parents,shortcutDetails)&pageSize=1000'
      + `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}`
      + (pageToken ? `&pageToken=${pageToken}` : '');
    const d = await withRetry(`drive list page ${page}`, async () => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${DRIVE_TOKEN}` }, signal: AbortSignal.timeout(T_META) });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      return res.json();
    });
    items.push(...(d.files ?? []));
    pageToken = d.nextPageToken;
    if (++page % 20 === 0) log(`  drive: page ${page}, ${items.length} items`);
  } while (pageToken);
  log(`drive: ${items.length} items listed`);

  const byId = new Map(items.map((f) => [f.id, f]));
  const FOLDER = 'application/vnd.google-apps.folder';
  const pathCache = new Map([[DRIVE_ID, '']]);
  function pathOf(id) {
    if (pathCache.has(id)) return pathCache.get(id);
    const f = byId.get(id);
    if (!f) { pathCache.set(id, null); return null; }   // parent outside the drive
    const par = (f.parents ?? [])[0];
    const base = par ? pathOf(par) : null;
    const p = base === null ? null : (base ? `${base}/${f.name}` : f.name);
    pathCache.set(id, p);
    return p;
  }
  let orphans = 0;
  const folderPaths = [];
  for (const f of items) {
    const p = pathOf(f.id);
    if (p === null) { orphans += 1; continue; }
    if (f.mimeType === FOLDER) { folderCount += 1; folderPaths.push(p); }
    else if (f.mimeType === 'application/vnd.google-apps.shortcut') shortcuts.push({ path: p, target: f.shortcutDetails?.targetId });
    else drive.set(p, { id: f.id, size: Number(f.size ?? 0), mimeType: f.mimeType });
  }
  if (orphans) log(`  ${orphans} items unreachable from the drive root`);
  log(`drive: ${drive.size} files, ${folderCount} folders, ${shortcuts.length} shortcuts`);

  if (FOLDERS_ONLY) {
    // Shallow-first so a consumer registering spellings sees parents before
    // children.
    folderPaths.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    await fsp.writeFile(FOLDERS_ONLY, folderPaths.join('\n') + '\n');
    log(`wrote ${folderPaths.length} folder paths to ${FOLDERS_ONLY}`);
    process.exit(0);
  }
}

// -------------------------------------------------- Dropbox live listing
// READ-ONLY: oauth2/token, files/list_folder, files/list_folder/continue.
const dbxTokRes = await fetch('https://api.dropbox.com/oauth2/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
    client_id: process.env.DROPBOX_APP_KEY,
    client_secret: process.env.DROPBOX_APP_SECRET,
  }),
  signal: AbortSignal.timeout(T_META),
});
if (!dbxTokRes.ok) { log('dropbox token failed:', await dbxTokRes.text()); process.exit(1); }
const DBX_TOKEN = (await dbxTokRes.json()).access_token;
const dbxHeaders = {
  Authorization: `Bearer ${DBX_TOKEN}`,
  'Content-Type': 'application/json',
  'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: process.env.DROPBOX_NAMESPACE_ID }),
};
const dbxLive = new Map();        // path_lower -> {size, client_modified}
{
  let cursor = null; let pages = 0;
  do {
    const url = cursor
      ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
      : 'https://api.dropboxapi.com/2/files/list_folder';
    const body = cursor ? { cursor } : { path: GRANTS_PATH, recursive: true, limit: 2000 };
    const d = await withRetry(`dropbox list page ${pages}`, async () => {
      const res = await fetch(url, { method: 'POST', headers: dbxHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(T_META) });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      return res.json();
    });
    for (const e of d.entries ?? []) {
      if (e['.tag'] === 'file') dbxLive.set(e.path_lower, { size: e.size, client_modified: e.client_modified });
    }
    cursor = d.has_more ? d.cursor : null;
    if (++pages % 20 === 0) log(`  dropbox: page ${pages}, ${dbxLive.size} files`);
  } while (cursor);
  log(`dropbox live: ${dbxLive.size} files under ${GRANTS_PATH}`);
}

// ------------------------------------------------------------- the contract
const idx = (h, name) => { const i = h.indexOf(name); if (i < 0) throw new Error(`mapping has no "${name}" column`); return i; };
const expected = new Map();       // destination -> {src, route, program}
const allDest = new Set();        // every copyable destination across all sheets
for (const [n, sheet] of MAPPINGS.entries()) {
  let h = null, iSrc, iProg, iDest, iRoute;
  for (const r of parseCsv(await fsp.readFile(sheet, 'utf8'))) {
    if (!h) {
      h = r;
      iSrc = idx(h, 'source_path'); iProg = idx(h, 'program');
      iDest = idx(h, 'destination_path'); iRoute = idx(h, 'route');
      continue;
    }
    if (!r[iSrc] || !COPY_ROUTES.has(r[iRoute])) continue;
    allDest.add(r[iDest]);
    // Presence/size checks cover EVERY sheet unless --program narrows them, so
    // a whole-corpus reconciliation can be done in one pass.
    if (!ONLY_PROGRAM || r[iProg] === ONLY_PROGRAM) {
      expected.set(r[iDest], { src: r[iSrc], route: r[iRoute], program: r[iProg] });
    }
  }
}
log(`mapping: checking ${expected.size} rows${ONLY_PROGRAM ? ` (program: ${ONLY_PROGRAM})` : ''}; ${allDest.size} copyable destinations across ${MAPPINGS.length} sheet(s)`);

// ------------------------------------------------------------------ compare
const ci = new Map();
for (const p of drive.keys()) ci.set(p.toLowerCase(), p);

const missing = [], caseOnly = [], mismatched = [], changedSinceCopy = [], sourceGone = [], googleTypes = [];
/** Per-program tallies — Step 5 of the full-copy brief asks for these by program. */
const perProgram = new Map();
const bump = (prog, key) => {
  if (!perProgram.has(prog)) {
    perProgram.set(prog, { expected: 0, present_exact: 0, case_only: 0, absent: 0, size_ok: 0, changed: 0, source_gone: 0 });
  }
  perProgram.get(prog)[key] += 1;
};
for (const [dest, info] of expected) {
  const d = drive.get(dest) ?? (ci.has(dest.toLowerCase()) ? drive.get(ci.get(dest.toLowerCase())) : null);
  const isCase = !drive.has(dest) && ci.has(dest.toLowerCase());
  const prog = info.program || '(unknown)';
  bump(prog, 'expected');
  if (!d) { missing.push({ dest, ...info }); bump(prog, 'absent'); continue; }
  if (isCase) { caseOnly.push({ dest, actual: ci.get(dest.toLowerCase()) }); bump(prog, 'case_only'); }
  else bump(prog, 'present_exact');
  if (/^application\/vnd\.google-apps\./.test(d.mimeType)) googleTypes.push({ dest, mimeType: d.mimeType });

  const live = dbxLive.get(info.src.toLowerCase());
  if (!live) { sourceGone.push({ dest, src: info.src, drive_size: d.size }); bump(prog, 'source_gone'); continue; }
  if (live.size === d.size) bump(prog, 'size_ok'); else bump(prog, 'changed');
  if (live.size !== d.size) {
    // Drive disagrees with Dropbox-as-of-now. Either the copy is bad, or the
    // source was edited after it was copied. Only the copier's own read-back
    // check (source bytes vs uploaded bytes at copy time) separates the two —
    // report it as changed-since-copy, to be re-copied in a refresh pass.
    changedSinceCopy.push({ dest, src: info.src, drive_size: d.size, dropbox_size_now: live.size, dropbox_modified: live.client_modified });
  }
}
const extra = [];
const allDestCi = new Set([...allDest].map((p) => p.toLowerCase()));
for (const [p, d] of drive) {
  if (!allDest.has(p) && !allDestCi.has(p.toLowerCase())) extra.push({ path: p, size: d.size, mimeType: d.mimeType });
}

const byTop = {};
for (const [p, d] of drive) { const t = p.split('/')[0]; (byTop[t] ??= { files: 0, bytes: 0 }); byTop[t].files++; byTop[t].bytes += d.size; }

console.log(JSON.stringify({
  drive_files: drive.size,
  drive_folders: folderCount,
  drive_bytes: [...drive.values()].reduce((a, x) => a + x.size, 0),
  shortcuts: shortcuts.length,
  dropbox_live_files: dbxLive.size,
  expected: expected.size,
  present_exact: expected.size - missing.length - caseOnly.length,
  present_case_only: caseOnly.length,
  missing: missing.length,
  size_matches_live_dropbox: expected.size - missing.length - changedSinceCopy.length - sourceGone.length,
  source_changed_since_copy: changedSinceCopy.length,
  source_gone_from_dropbox: sourceGone.length,
  google_type: googleTypes.length,
  extra_in_drive: extra.length,
  by_top_level: byTop,
  per_program: Object.fromEntries([...perProgram.entries()].sort((a, b) => b[1].expected - a[1].expected)),
  missing_rows: missing.slice(0, 50),
  changed_rows: changedSinceCopy.slice(0, 50),
  source_gone_rows: sourceGone.slice(0, 50),
  google_type_rows: googleTypes.slice(0, 20),
  extra_sample: extra.slice(0, 30),
  case_only_sample: caseOnly.slice(0, 10),
}, null, 2));
