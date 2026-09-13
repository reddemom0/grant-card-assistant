/**
 * delta-pull-reconcile.mjs — reconcile the Shared Drive against live Dropbox
 * after the delta copy, across every mapping sheet ever executed.
 *
 * Same contract as reconcile-drive.mjs, and deliberately does NOT read the copy
 * ledger: Drive is enumerated with one flat paginated files.list and paths are
 * rebuilt locally from parent ids; sizes are compared against LIVE Dropbox.
 *
 * Differs from reconcile-drive.mjs in two ways, both forced by this pass:
 *   1. Dropbox is walked per in-scope top-level folder, not from the sheets'
 *      common ancestor. The delta sheet maps three loose files at the team
 *      folder root, which makes that ancestor the team folder itself — and a
 *      recursive walk from there lists HR, which is out of scope. FINANCE, HR,
 *      ADMIN, GETGRANTED and GRANTED STARTER are never listed.
 *   2. Beyond size, content is checked: for files ≤ 4 MiB the Drive-derived
 *      Dropbox hash must equal the live content_hash (see
 *      delta-pull-inventory.mjs for why that derivation is exact).
 *
 * READ-ONLY. Dropbox: oauth2/token, users/get_current_account,
 * files/list_folder(/continue). Drive: drive.readonly, files.list.
 *
 * Usage: node scripts/delta-pull-reconcile.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

process.chdir('/Users/Chris/grant-card-assistant');
const DIR = 'dist/inventory/delta';
const SHEETS = [
  'dist/inventory/full-mapping.csv', 'dist/inventory/canexport-mapping.csv', 'dist/inventory/departments-mapping.csv',
  `${DIR}/delta-grants-mapping.csv`, `${DIR}/delta-departments-mapping.csv`,
];
const DRIVE_ID = process.env.PILOT_DEST_ROOT || '0AKxoOSs3WbQ0Uk9PVA';
const TEAM_FOLDER = '/granted team folder';
const EXCLUDED = new Set(['FINANCE', 'HR', 'ADMIN', 'GETGRANTED', 'GRANTED STARTER']);
/** Keep in step with pilot-copy.mjs and reconcile-drive.mjs. */
const COPY_ROUTES = new Set(['sort', 'program', 'archive', 'mirror']);
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
function httpError(res, body) { const e = new Error(`HTTP ${res.status}: ${String(body).slice(0, 300)}`); e.status = res.status; e.retryAfter = res.headers.get('retry-after'); return e; }
function splitLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

// ---------------------------------------------------------------- Dropbox, live
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
const dbxLive = new Map();          // path_lower -> {size, content_hash}
const walked = [];
for (const e of (await rpc('files/list_folder', { path: TEAM_FOLDER, recursive: false, include_mounted_folders: true })).entries) {
  if (e['.tag'] === 'file') { dbxLive.set(e.path_lower, { size: e.size, content_hash: e.content_hash }); continue; }
  if (EXCLUDED.has(e.name.trim().toUpperCase())) continue;
  let d = await rpc('files/list_folder', { path: e.path_lower, recursive: true, limit: 2000, include_mounted_folders: true });
  let n = 0;
  while (true) {
    for (const x of d.entries) if (x['.tag'] === 'file') { dbxLive.set(x.path_lower, { size: x.size, content_hash: x.content_hash }); n += 1; }
    if (!d.has_more) break;
    d = await rpc('files/list_folder/continue', { cursor: d.cursor });
  }
  walked.push({ name: e.name, files: n });
  log(`  dropbox ${e.name}: ${n} files`);
}
log(`dropbox live: ${dbxLive.size} files across ${walked.length} in-scope folders + team-folder root`);

// ---------------------------------------------------------------- Drive, flat listing
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
    const d = await withRetry(`drive list page ${page}`, async () => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${driveTok}` }, signal: AbortSignal.timeout(T_META) });
      if (!res.ok) throw httpError(res, await res.text());
      return res.json();
    });
    items.push(...(d.files ?? [])); pageToken = d.nextPageToken;
    if (++page % 20 === 0) log(`  drive: page ${page}, ${items.length} items`);
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
const drive = new Map();
let folders = 0, shortcuts = 0, orphans = 0;
for (const f of items) {
  const p = pathOf(f.id);
  if (p === null) { orphans += 1; continue; }
  if (f.mimeType === 'application/vnd.google-apps.folder') folders += 1;
  else if (f.mimeType === 'application/vnd.google-apps.shortcut') shortcuts += 1;
  else drive.set(p, { id: f.id, size: Number(f.size ?? 0), sha256: f.sha256Checksum ?? null, mimeType: f.mimeType });
}
log(`drive: ${drive.size} files, ${folders} folders, ${shortcuts} shortcuts`);

// ---------------------------------------------------------------- the contract
const expected = new Map();         // dest -> {src, route, sheet}
const allDest = new Set();
const perSheet = new Map();
for (const sheet of SHEETS) {
  const lines = fs.readFileSync(sheet, 'utf8').split('\n').filter(Boolean);
  const h = splitLine(lines[0]);
  const iSrc = h.indexOf('source_path'), iDest = h.indexOf('destination_path'), iRoute = h.indexOf('route');
  if (iSrc < 0 || iDest < 0 || iRoute < 0) { log(`ABORT: ${sheet} lacks a required column`); process.exit(1); }
  let n = 0;
  for (const l of lines.slice(1)) {
    const c = splitLine(l);
    if (!c[iSrc] || !COPY_ROUTES.has(c[iRoute])) continue;
    expected.set(c[iDest], { src: c[iSrc], route: c[iRoute], sheet: path.basename(sheet) });
    allDest.add(c[iDest]); n += 1;
  }
  perSheet.set(path.basename(sheet), { expected: 0, present_exact: 0, case_only: 0, absent: 0, size_ok: 0, hash_checked: 0, hash_ok: 0, changed: 0, source_gone: 0, rows: n });
}

// ---------------------------------------------------------------- compare
const ci = new Map();
for (const p of drive.keys()) ci.set(p.toLowerCase(), p);
const missing = [], caseOnly = [], changed = [], hashMismatch = [], sourceGone = [], googleTypes = [];
for (const [dest, info] of expected) {
  const t = perSheet.get(info.sheet);
  t.expected += 1;
  const exact = drive.get(dest);
  const d = exact ?? (ci.has(dest.toLowerCase()) ? drive.get(ci.get(dest.toLowerCase())) : null);
  if (!d) { missing.push({ dest, ...info }); t.absent += 1; continue; }
  if (exact) t.present_exact += 1; else { t.case_only += 1; caseOnly.push({ dest, actual: ci.get(dest.toLowerCase()) }); }
  if (/^application\/vnd\.google-apps\./.test(d.mimeType)) googleTypes.push({ dest, mimeType: d.mimeType });
  const lv = dbxLive.get(info.src.toLowerCase());
  if (!lv) { sourceGone.push({ dest, src: info.src }); t.source_gone += 1; continue; }
  if (lv.size === d.size) t.size_ok += 1;
  else { t.changed += 1; changed.push({ dest, src: info.src, drive_size: d.size, dropbox_size_now: lv.size }); continue; }
  if (d.sha256 && d.size <= BLOCK) {
    t.hash_checked += 1;
    const derived = d.size === 0 ? sha256(Buffer.alloc(0)).toString('hex') : sha256(Buffer.from(d.sha256, 'hex')).toString('hex');
    if (derived === lv.content_hash) t.hash_ok += 1; else hashMismatch.push({ dest, src: info.src });
  }
}
const extra = [];
const allDestCi = new Set([...allDest].map((p) => p.toLowerCase()));
for (const [p, d] of drive) if (!allDest.has(p) && !allDestCi.has(p.toLowerCase())) extra.push({ path: p, size: d.size, mimeType: d.mimeType });

const sum = (k) => [...perSheet.values()].reduce((s, t) => s + t[k], 0);
const byTop = {};
for (const [p, d] of drive) { const top = p.split('/')[0]; (byTop[top] ??= { files: 0, bytes: 0 }); byTop[top].files += 1; byTop[top].bytes += d.size; }
const extraByTop = {};
for (const x of extra) { const k = x.path.split('/').slice(0, 2).join('/'); extraByTop[k] = (extraByTop[k] ?? 0) + 1; }

const report = {
  generated: new Date().toISOString(),
  ledger_consulted: false,
  dropbox: { walked_in_scope: walked, live_files: dbxLive.size, never_listed: [...EXCLUDED] },
  drive: { files: drive.size, folders, shortcuts, bytes: [...drive.values()].reduce((s, d) => s + d.size, 0), unreachable_items: orphans },
  expected: expected.size,
  present_exact: sum('present_exact'), present_case_only: sum('case_only'), absent: sum('absent'),
  size_agrees_with_live_dropbox: sum('size_ok'),
  content_hash_checked: sum('hash_checked'), content_hash_agrees: sum('hash_ok'),
  changed_since_copy: sum('changed'), content_hash_mismatch: hashMismatch.length,
  source_gone_from_dropbox: sum('source_gone'),
  google_type_conversions: googleTypes.length,
  extras_in_drive: extra.length,
  per_sheet: Object.fromEntries(perSheet),
  by_top_level: byTop,
  extras_by_folder: extraByTop,
  missing_rows: missing,
  changed_rows: changed.slice(0, 50),
  hash_mismatch_rows: hashMismatch.slice(0, 50),
  case_only_rows: caseOnly.slice(0, 20),
  source_gone_by_folder: (() => { const m = {}; for (const s of sourceGone) { const k = s.src.split('/').slice(2, 4).join('/'); m[k] = (m[k] ?? 0) + 1; } return m; })(),
  extras_sample: extra.slice(0, 40),
};
await fsp.writeFile(path.join(DIR, 'reconcile.json'), JSON.stringify({ ...report, extras_all: extra, source_gone_all: sourceGone }, null, 2));
console.log(JSON.stringify(report, null, 2));
