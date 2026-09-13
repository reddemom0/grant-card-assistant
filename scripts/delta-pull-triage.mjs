/**
 * delta-pull-triage.mjs — the 14 files that exist only inside the SALES triage
 * folders: re-verify they are absent from Drive by content, prove where each
 * lived before the triage, and map it there.
 *
 * Why they looked new. dropbox-inventory-non-grants.js walked SALES child by
 * child to skip the Grants tree, and collected files sitting loose at the SALES
 * root (and the team-folder root) into `looseTopFiles` — which it never wrote
 * out. Those files were never inventoried, mapped or copied. The 2026-08-28
 * triage moved them into `*Keep` and `*Obsolete : Duplicate - Delete`, where the
 * delta walk found them.
 *
 * Proof of the pre-triage home. A moved file leaves a deleted entry at its old
 * path. files/list_folder with include_deleted lists those at the SALES root,
 * and files/list_revisions on a deleted path returns its revision history with
 * content_hash — so identity is proven by bytes, not by name. A file whose
 * pre-triage home cannot be proven that way is reported ambiguous and NOT
 * mapped.
 *
 * Destination. The pre-triage equivalent, through the departments mirror rule
 * unchanged: /Granted Team Folder/SALES/<name> → Departments/SALES/<name>. This
 * is the row the departments mapping would have produced had the inventory
 * recorded the file, and it creates no triage folder in Drive.
 *
 * READ-ONLY. Dropbox: oauth2/token, users/get_current_account,
 * files/get_metadata, files/list_folder(/continue), files/list_revisions.
 * Drive: drive.readonly, files.list. Writes only under dist/inventory/delta/.
 *
 * Usage: node scripts/delta-pull-triage.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { foldDestinationCase, DEPARTMENTS_ROOT } from './mapping-lib.mjs';

process.chdir('/Users/Chris/grant-card-assistant');
const DIR = 'dist/inventory/delta';
const DRIVE_ID = process.env.PILOT_DEST_ROOT || '0AKxoOSs3WbQ0Uk9PVA';
const SALES = '/granted team folder/sales';
const TRIAGE_GROUPS = new Set(['SALES / *Keep', 'SALES / *Obsolete : Duplicate - Delete', 'SALES / *Needs Review']);
const COPY_ROUTES = new Set(['sort', 'program', 'archive', 'mirror']);
const SHEETS = ['dist/inventory/full-mapping.csv', 'dist/inventory/canexport-mapping.csv', 'dist/inventory/departments-mapping.csv',
  `${DIR}/delta-grants-mapping.csv`, `${DIR}/delta-departments-mapping.csv`];
const BLOCK = 4 * 1024 * 1024;
const T_TOKEN = 30_000;
const T_META = 60_000;
const log = (...a) => console.error(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

const TRANSIENT = new Set(['ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET']);
async function withRetry(label, fn, attempts = 6) {
  let delay = 1000;
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) {
      const status = err.status ?? 0;
      const netCode = err.cause?.code ?? err.code;
      const transport = TRANSIENT.has(netCode) || (err.name === 'TypeError' && /fetch failed/i.test(err.message ?? '')) || err.name === 'TimeoutError' || err.name === 'AbortError';
      if (!(status === 429 || (status >= 500 && status < 600) || transport) || i >= attempts) throw err;
      const wait = Number(err.retryAfter || 0) * 1000 || delay;
      log(`  ⏳ ${label}: ${status || netCode || err.name}, retry ${i}/${attempts - 1} in ${Math.round(wait / 1000)}s`);
      await sleep(wait); delay = Math.min(delay * 2, 32000);
    }
  }
}
function httpError(res, body) { const e = new Error(`HTTP ${res.status}: ${String(body).slice(0, 300)}`); e.status = res.status; e.retryAfter = res.headers.get('retry-after'); e.body = body; return e; }
function splitLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const readLines = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);

// ---------------------------------------------------------------- the 14
const verify = JSON.parse(await fsp.readFile(path.join(DIR, 'verify.json'), 'utf8'));
const files = verify.results.filter((r) => TRIAGE_GROUPS.has(r.group));
if (files.length !== 14) { log(`ABORT: expected 14 triage-only files in verify.json, found ${files.length}`); process.exit(1); }
const moves = new Set();
for (const l of readLines(path.join(DIR, 'delta-diff.csv')).slice(1)) {
  const c = splitLine(l);
  if (c[0] === 'NEW' && c[1] === 'new_since_inventory' && c[14]) moves.add(c[3].toLowerCase());
}
const overlap = files.filter((f) => moves.has(f.path.toLowerCase()));
if (overlap.length) { log(`ABORT: ${overlap.length} of the 14 are on the moves list`); process.exit(1); }

// ---------------------------------------------------------------- Dropbox (read-only)
const dbxTok = await withRetry('dropbox token', async () => {
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.DROPBOX_REFRESH_TOKEN, client_id: process.env.DROPBOX_APP_KEY, client_secret: process.env.DROPBOX_APP_SECRET }),
    signal: AbortSignal.timeout(T_TOKEN),
  });
  if (!res.ok) throw httpError(res, await res.text());
  return (await res.json()).access_token;
});
const rpc = (endpoint, body, pathRoot = true) => withRetry(endpoint, async () => {
  const headers = { Authorization: `Bearer ${dbxTok}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (pathRoot) headers['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'namespace_id', namespace_id: process.env.DROPBOX_NAMESPACE_ID });
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(T_META) });
  if (!res.ok) throw httpError(res, await res.text());
  return res.json();
});
const acct = await rpc('users/get_current_account', undefined, false);
if (process.env.DROPBOX_NAMESPACE_ID === acct.root_info?.home_namespace_id || process.env.DROPBOX_NAMESPACE_ID !== acct.root_info?.root_namespace_id) {
  log('ABORT: DROPBOX_NAMESPACE_ID is not the team root namespace.'); process.exit(1);
}

// Fresh metadata for each of the 14 — still present, and its hash now.
for (const f of files) {
  const md = await rpc('files/get_metadata', { path: f.path });
  f.live = { size: md.size, content_hash: md.content_hash, client_modified: md.client_modified, server_modified: md.server_modified, path: md.path_display, is_downloadable: md.is_downloadable !== false };
}

// Deleted entries at the SALES root, and what each held.
let d = await rpc('files/list_folder', { path: SALES, recursive: false, include_deleted: true, limit: 2000 });
const rootEntries = [...d.entries];
while (d.has_more) { d = await rpc('files/list_folder/continue', { cursor: d.cursor }); rootEntries.push(...d.entries); }
const deletedAtRoot = rootEntries.filter((e) => e['.tag'] === 'deleted');
const liveAtRoot = rootEntries.filter((e) => e['.tag'] === 'file');
const deletedFiles = [];              // deleted root entries that were files, with their last revision
for (const e of deletedAtRoot) {
  try {
    const rv = await rpc('files/list_revisions', { path: e.path_lower, mode: 'path', limit: 100 });
    const revs = (rv.entries ?? []).sort((a, b) => Date.parse(b.server_modified) - Date.parse(a.server_modified));
    deletedFiles.push({ path: e.path_display, path_lower: e.path_lower, revisions: revs.length, hashes: [...new Set(revs.map((r) => r.content_hash))], last: revs[0] ?? null });
  } catch (err) {
    // list_revisions refuses folders — a deleted pre-triage FOLDER, not a file.
    if (!/not_file|path\/not_file|not_found/.test(String(err.body ?? err.message))) throw err;
  }
}
log(`SALES root: ${deletedAtRoot.length} deleted entries (${deletedFiles.length} were files), ${liveAtRoot.length} live files`);

// ---------------------------------------------------------------- Drive (read-only)
async function loadServiceKey() {
  const lines = (await fsp.readFile('.env', 'utf8')).split('\n');
  const i = lines.findIndex((l) => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY='));
  let raw = lines[i].slice('GOOGLE_SERVICE_ACCOUNT_KEY='.length);
  for (let j = i + 1; j < lines.length; j++) { if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break; raw += '\n' + lines[j]; }
  return JSON.parse(raw.trim().replace(/^['"]|['"]$/g, ''));
}
const key = await loadServiceKey();
const driveTok = await withRetry('drive token', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }), signal: AbortSignal.timeout(T_TOKEN) });
  if (!res.ok) throw httpError(res, await res.text());
  return (await res.json()).access_token;
});
const items = [];
{
  let pageToken = null, page = 0;
  do {
    const url = 'https://www.googleapis.com/drive/v3/files' + `?q=${encodeURIComponent('trashed = false')}`
      + '&fields=nextPageToken,files(id,name,mimeType,size,parents,sha256Checksum)&pageSize=1000'
      + `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}` + (pageToken ? `&pageToken=${pageToken}` : '');
    const r = await withRetry(`drive list page ${page}`, async () => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${driveTok}` }, signal: AbortSignal.timeout(T_META) });
      if (!res.ok) throw httpError(res, await res.text());
      return res.json();
    });
    items.push(...(r.files ?? [])); pageToken = r.nextPageToken;
    if (++page % 40 === 0) log(`  drive: page ${page}, ${items.length} items`);
  } while (pageToken);
}
const byId = new Map(items.map((f) => [f.id, f]));
const pathCache = new Map([[DRIVE_ID, '']]);
function pathOf(id) {
  if (pathCache.has(id)) return pathCache.get(id);
  const f = byId.get(id);
  if (!f) { pathCache.set(id, null); return null; }
  const par = (f.parents ?? [])[0];
  const base = par ? pathOf(par) : null;
  const p = base === null ? null : (base ? `${base}/${f.name}` : f.name);
  pathCache.set(id, p); return p;
}
const driveFiles = [], driveFolders = [];
for (const f of items) {
  const p = pathOf(f.id);
  if (p === null) continue;
  if (f.mimeType === 'application/vnd.google-apps.folder') driveFolders.push(p);
  else if (f.mimeType !== 'application/vnd.google-apps.shortcut') driveFiles.push({ path: p, size: Number(f.size ?? 0), sha256: f.sha256Checksum ?? null });
}
driveFolders.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
const byDbxHash = new Map(), bySha = new Map(), byNameSize = new Map();
const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
for (const f of driveFiles) {
  push(byNameSize, `${path.basename(f.path).toLowerCase()}\u0000${f.size}`, f.path);
  if (!f.sha256) continue;
  push(bySha, f.sha256, f.path);
  if (f.size === 0) push(byDbxHash, sha256(Buffer.alloc(0)).toString('hex'), f.path);
  else if (f.size <= BLOCK) push(byDbxHash, sha256(Buffer.from(f.sha256, 'hex')).toString('hex'), f.path);
}
log(`drive: ${driveFiles.length} files, ${driveFolders.length} folders`);

// ---------------------------------------------------------------- Step 1: content re-verification
const liveHashes = new Map();         // content_hash -> live Dropbox paths (from the Part A walk)
const walkHash = new Map();           // path_lower -> content_hash at the Part A walk
for (const l of readLines(path.join(DIR, 'live-dropbox.jsonl'))) {
  const o = JSON.parse(l);
  if (o.type !== 'file') continue;
  walkHash.set(o.path_lower, o.content_hash);
  if (o.content_hash) push(liveHashes, o.content_hash, o.path);
}
for (const f of files) {
  if (f.live.size > BLOCK) { log(`ABORT: ${f.path} is over 4 MiB — this script checks by derived hash only`); process.exit(1); }
  f.drive_hash_matches = byDbxHash.get(f.live.content_hash) ?? [];
  f.drive_name_size_matches = byNameSize.get(`${path.basename(f.path).toLowerCase()}\u0000${f.live.size}`) ?? [];
  f.hash_unchanged_since_walk = f.live.content_hash === walkHash.get(f.path.toLowerCase());
}
const dropped = files.filter((f) => f.drive_hash_matches.length);
const confirmed = files.filter((f) => !f.drive_hash_matches.length);

// ---------------------------------------------------------------- Step 2: pre-triage home
const deletedByLower = new Map(deletedFiles.map((x) => [x.path_lower, x]));
for (const f of confirmed) {
  const name = path.basename(f.live.path);
  const rootPath = `${SALES}/${name.toLowerCase()}`;
  const del = deletedByLower.get(rootPath);
  f.pre_triage = del
    ? { path: del.path, revisions: del.revisions, bytes_match: del.hashes.includes(f.live.content_hash), last_revision: del.last?.server_modified ?? null }
    : null;
  // Any OTHER place the same bytes live in Dropbox would make the home ambiguous.
  f.other_live_copies = (liveHashes.get(f.live.content_hash) ?? []).filter((p) => p.toLowerCase() !== f.path.toLowerCase());
  f.ambiguous = !f.pre_triage || !f.pre_triage.bytes_match || f.other_live_copies.length > 0;
  if (!f.ambiguous) {
    // departments-mapping rule: Departments/<TOP>/<sanitized sub-folders>/<filename verbatim>. At the SALES root there are no sub-folders.
    f.dest = `${DEPARTMENTS_ROOT}/SALES/${name}`;
  }
}
const mapped = confirmed.filter((f) => !f.ambiguous);
const rows = mapped.map((f) => ({ src: f.live.path, dest: f.dest, route: 'mirror' }));
const fold = foldDestinationCase(rows, driveFolders);
for (const [i, f] of mapped.entries()) f.dest = rows[i].dest;

// ---------------------------------------------------------------- Step 3: collisions
const occupied = new Map();
const occupiedLower = new Map();
const occupy = (p, why) => { if (!occupied.has(p)) occupied.set(p, why); if (!occupiedLower.has(p.toLowerCase())) occupiedLower.set(p.toLowerCase(), p); };
for (const f of driveFiles) occupy(f.path, 'present in Drive');
for (const sheet of SHEETS) {
  const lines = readLines(sheet);
  const h = splitLine(lines[0]);
  const iDest = h.indexOf('destination_path'), iRoute = h.indexOf('route');
  for (const l of lines.slice(1)) { const c = splitLine(l); if (COPY_ROUTES.has(c[iRoute])) occupy(c[iDest], `mapped in ${path.basename(sheet)}`); }
}
const collisions = {
  exact: mapped.filter((f) => occupied.has(f.dest)).map((f) => ({ dest: f.dest, by: occupied.get(f.dest) })),
  case_only: mapped.filter((f) => !occupied.has(f.dest) && occupiedLower.has(f.dest.toLowerCase())).map((f) => ({ dest: f.dest, existing: occupiedLower.get(f.dest.toLowerCase()) })),
  within: (() => { const m = new Map(); for (const f of mapped) push(m, f.dest, f.path); return [...m.entries()].filter(([, v]) => v.length > 1); })(),
};
const collisionTotal = collisions.exact.length + collisions.case_only.length + collisions.within.length;

// ---------------------------------------------------------------- other loose SALES-root files
// Every file the triage moved out of the SALES root: is its content still somewhere — live in
// Dropbox, or in Drive? One that is neither exists only in Dropbox's deleted-file history.
const rootAudit = deletedFiles.map((x) => {
  const h = x.last?.content_hash;
  const inDrive = h ? (x.last.size <= BLOCK ? (byDbxHash.get(h) ?? []) : []) : [];
  const liveNow = h ? (liveHashes.get(h) ?? []) : [];
  return { path: x.path, size: x.last?.size ?? null, last_revision: x.last?.server_modified ?? null,
    live_in_dropbox: liveNow, in_drive_by_hash: inDrive,
    in_drive_by_name_size: x.last ? (byNameSize.get(`${path.basename(x.path).toLowerCase()}\u0000${x.last.size}`) ?? []) : [] };
});

// ---------------------------------------------------------------- outputs
const HEAD = ['source_path', 'department', 'subpath', 'destination_path', 'filename', 'size', 'modified', 'extension', 'route', 'reason'];
const sheetOut = path.join(DIR, 'delta-triage-mapping.csv');
await fsp.writeFile(sheetOut, [HEAD.join(','), ...mapped.map((f) => [
  f.live.path, 'SALES', '', f.dest, path.basename(f.live.path), f.live.size,
  f.live.client_modified || f.live.server_modified || '', path.extname(f.live.path).slice(1).toLowerCase(), 'mirror',
  `mirrored at its pre-triage path ${f.pre_triage.path} — moved into ${f.path.split('/')[3]} by the SALES triage; root file never inventoried`,
].map(esc).join(','))].join('\n') + '\n');

const report = {
  generated: new Date().toISOString(),
  step1: {
    checked: files.length, drive_files_listed: driveFiles.length,
    dropped_as_moves: dropped.map((f) => ({ path: f.path, drive_matches: f.drive_hash_matches })),
    confirmed_new: confirmed.length,
    hash_unchanged_since_part_a_walk: files.every((f) => f.hash_unchanged_since_walk),
    name_size_only_matches: confirmed.filter((f) => f.drive_name_size_matches.length).map((f) => ({ path: f.path, drive: f.drive_name_size_matches })),
  },
  step2: {
    sales_root_deleted_entries: deletedAtRoot.length, sales_root_deleted_files: deletedFiles.length, sales_root_live_files: liveAtRoot.length,
    files: confirmed.map((f) => ({ current: f.live.path, pre_triage: f.pre_triage, other_live_copies: f.other_live_copies, ambiguous: f.ambiguous, dest: f.dest ?? null, size: f.live.size, client_modified: f.live.client_modified })),
    ambiguous: confirmed.filter((f) => f.ambiguous).map((f) => f.path),
    case_folded: fold.changed,
  },
  step3: { collisions, total: collisionTotal },
  mapped: mapped.length,
  sheet: sheetOut,
  other_sales_root_files: rootAudit.filter((x) => !files.some((f) => f.pre_triage?.path?.toLowerCase() === x.path.toLowerCase())),
};
await fsp.writeFile(path.join(DIR, 'triage-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (collisionTotal) process.exit(3);
