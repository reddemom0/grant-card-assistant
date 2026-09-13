/**
 * delta-pull-verify.mjs — Part B gate: prove every file selected for the delta
 * copy has no content match ANYWHERE in the Shared Drive.
 *
 * Part A matched NEW files only against DELETED sources (moves). A file the
 * team duplicated rather than moved — same bytes at a second Dropbox path while
 * the original stays put — matches nothing deleted and would read as new. This
 * checks against every file in Drive instead.
 *
 * READ-ONLY, both sides.
 *   Dropbox: oauth2/token, files/download (only for files over 4 MiB).
 *   Drive:   drive.readonly scope, files.list only.
 *
 * Matching:
 *   ≤ 4 MiB  Dropbox content_hash == SHA-256(Drive sha256Checksum) — exact for a
 *            single-block file (see delta-pull-inventory.mjs). No download.
 *   > 4 MiB  Download from Dropbox, SHA-256 the bytes, compare with Drive's
 *            sha256Checksum directly. The downloaded bytes are also re-hashed
 *            Dropbox's way and must equal the listed content_hash, so the file
 *            checked is provably the file inventoried.
 *
 * Input:  dist/inventory/delta/delta-diff.csv, live-dropbox.jsonl
 * Output: dist/inventory/delta/verify.json (+ drive-files.jsonl, drive-folders.txt
 *         for the mapping and collision steps — one Drive listing serves all three)
 *
 * Usage: node scripts/delta-pull-verify.mjs
 */
import 'dotenv/config';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { parseCsv } from './grants-lib.mjs';

process.chdir('/Users/Chris/grant-card-assistant');
const DIR = 'dist/inventory/delta';
const DRIVE_ID = process.env.PILOT_DEST_ROOT || '0AKxoOSs3WbQ0Uk9PVA';
const BLOCK = 4 * 1024 * 1024;
const T_TOKEN = 30_000;
const T_META = 60_000;
const T_DOWNLOAD = 30 * 60_000;
const log = (...a) => console.error(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

const TRANSIENT = new Set([
  'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE',
  'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
]);
async function withRetry(label, fn, attempts = 6) {
  let delay = 1000;
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) {
      const status = err.status ?? 0;
      const netCode = err.cause?.code ?? err.code;
      const transport = TRANSIENT.has(netCode)
        || (err.name === 'TypeError' && /fetch failed/i.test(err.message ?? ''))
        || err.name === 'TimeoutError' || err.name === 'AbortError';
      if (!(status === 429 || (status >= 500 && status < 600) || transport) || i >= attempts) throw err;
      const wait = Number(err.retryAfter || 0) * 1000 || delay;
      log(`  ⏳ ${label}: ${status || netCode || err.name}, retry ${i}/${attempts - 1} in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      delay = Math.min(delay * 2, 32000);
    }
  }
}
function httpError(res, body) {
  const e = new Error(`HTTP ${res.status}: ${String(body).slice(0, 300)}`);
  e.status = res.status; e.retryAfter = res.headers.get('retry-after');
  return e;
}
/** Dropbox content_hash: SHA-256 over the concatenated SHA-256 of each 4 MiB block. */
function dropboxHash(buf) {
  const parts = [];
  for (let o = 0; o < buf.length; o += BLOCK) parts.push(sha256(buf.subarray(o, o + BLOCK)));
  return sha256(Buffer.concat(parts)).toString('hex');
}
const asciiArg = (obj) => JSON.stringify(obj).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

// ---------------------------------------------------------------- selection
const sel = [], stubs = [], moves = [];
{
  let h = null;
  for (const r of parseCsv(await fsp.readFile(path.join(DIR, 'delta-diff.csv'), 'utf8'))) {
    if (!h) { h = r; continue; }
    if (!r[0]) continue;
    const o = Object.fromEntries(h.map((k, i) => [k, r[i]]));
    if (o.category !== 'NEW') continue;
    if (o.is_downloadable === 'false') { stubs.push({ path: o.source_path, sub: o.subcategory, size: Number(o.size) }); continue; }
    if (o.subcategory === 'new_since_inventory' && o.probable_move_of) { moves.push(o.source_path); continue; }
    if ((o.subcategory === 'new_since_inventory') || o.subcategory === 'inventoried_review_route') {
      sel.push({ path: o.source_path, sub: o.subcategory, group: o.group, size: Number(o.size), content_hash: o.content_hash });
    }
  }
}
log(`selection: ${sel.length} downloadable (${sel.filter((s) => s.sub === 'new_since_inventory').length} new content, ${sel.filter((s) => s.sub !== 'new_since_inventory').length} carryover); ${stubs.length} stubs not attempted; ${moves.length} moves excluded`);

// ---------------------------------------------------------------- Drive listing
async function loadServiceKey() {
  const fromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (fromEnv && fromEnv.trim().startsWith('{')) { try { return JSON.parse(fromEnv); } catch { /* truncated by dotenv */ } }
  const lines = (await fsp.readFile('.env', 'utf8')).split('\n');
  const i = lines.findIndex((l) => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY='));
  let raw = lines[i].slice('GOOGLE_SERVICE_ACCOUNT_KEY='.length);
  for (let j = i + 1; j < lines.length; j++) { if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break; raw += '\n' + lines[j]; }
  return JSON.parse(raw.trim().replace(/^['"]|['"]$/g, ''));
}
const key = await loadServiceKey();
const DRIVE_TOKEN = await withRetry('drive token', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    signal: AbortSignal.timeout(T_TOKEN),
  });
  if (!res.ok) throw httpError(res, await res.text());
  return (await res.json()).access_token;
});
const items = [];
{
  let pageToken = null, page = 0;
  do {
    const url = 'https://www.googleapis.com/drive/v3/files'
      + `?q=${encodeURIComponent('trashed = false')}`
      + '&fields=nextPageToken,files(id,name,mimeType,size,parents,sha256Checksum,shortcutDetails)&pageSize=1000'
      + `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}`
      + (pageToken ? `&pageToken=${pageToken}` : '');
    const d = await withRetry(`drive list page ${page}`, async () => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${DRIVE_TOKEN}` }, signal: AbortSignal.timeout(T_META) });
      if (!res.ok) throw httpError(res, await res.text());
      return res.json();
    });
    items.push(...(d.files ?? []));
    pageToken = d.nextPageToken;
    if (++page % 20 === 0) log(`  drive: page ${page}, ${items.length} items`);
  } while (pageToken);
}
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const byId = new Map(items.map((f) => [f.id, f]));
const pathCache = new Map([[DRIVE_ID, '']]);
function pathOf(id) {
  if (pathCache.has(id)) return pathCache.get(id);
  const f = byId.get(id);
  if (!f) { pathCache.set(id, null); return null; }
  const par = (f.parents ?? [])[0];
  const base = par ? pathOf(par) : null;
  const p = base === null ? null : (base ? `${base}/${f.name}` : f.name);
  pathCache.set(id, p);
  return p;
}
const driveFiles = [], folderPaths = [];
let shortcuts = 0;
for (const f of items) {
  const p = pathOf(f.id);
  if (p === null) continue;
  if (f.mimeType === FOLDER) folderPaths.push(p);
  else if (f.mimeType === SHORTCUT) shortcuts += 1;
  else driveFiles.push({ id: f.id, path: p, size: Number(f.size ?? 0), sha256: f.sha256Checksum ?? null, mimeType: f.mimeType });
}
log(`drive: ${driveFiles.length} files, ${folderPaths.length} folders, ${shortcuts} shortcuts`);
folderPaths.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
await fsp.writeFile(path.join(DIR, 'drive-folders.txt'), folderPaths.join('\n') + '\n');
await fsp.writeFile(path.join(DIR, 'drive-files.jsonl'), driveFiles.map((f) => JSON.stringify(f)).join('\n') + '\n');

const bySha = new Map(), byDbxHash = new Map(), byNameSize = new Map();
const EMPTY_DBX = sha256(Buffer.alloc(0)).toString('hex');
const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
for (const f of driveFiles) {
  push(byNameSize, `${path.basename(f.path).toLowerCase()}\u0000${f.size}`, f.path);
  if (!f.sha256) continue;
  push(bySha, f.sha256, f.path);
  if (f.size === 0) push(byDbxHash, EMPTY_DBX, f.path);
  else if (f.size <= BLOCK) push(byDbxHash, sha256(Buffer.from(f.sha256, 'hex')).toString('hex'), f.path);
}
const noSha = driveFiles.filter((f) => !f.sha256 && !/^application\/vnd\.google-apps\./.test(f.mimeType)).length;

// ---------------------------------------------------------------- Dropbox download (read-only)
const DBX = {
  token: null, exp: 0,
  async accessToken() {
    if (this.token && Date.now() < this.exp - 300_000) return this.token;
    const res = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.DROPBOX_REFRESH_TOKEN, client_id: process.env.DROPBOX_APP_KEY, client_secret: process.env.DROPBOX_APP_SECRET }),
      signal: AbortSignal.timeout(T_TOKEN),
    });
    if (!res.ok) throw httpError(res, await res.text());
    const d = await res.json();
    this.token = d.access_token; this.exp = Date.now() + d.expires_in * 1000;
    return this.token;
  },
  async download(p) {
    return withRetry(`download ${path.basename(p)}`, async () => {
      const res = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'namespace_id', namespace_id: process.env.DROPBOX_NAMESPACE_ID }),
          'Dropbox-API-Arg': asciiArg({ path: p }),
        },
        signal: AbortSignal.timeout(T_DOWNLOAD),
      });
      if (!res.ok) throw httpError(res, await res.text());
      return Buffer.from(await res.arrayBuffer());
    });
  },
};

// ---------------------------------------------------------------- verify
const results = [];
for (const s of sel) {
  const r = { path: s.path, sub: s.sub, group: s.group, size: s.size, method: null, hash_matches: [], name_size_matches: [] };
  if (s.size <= BLOCK) {
    r.method = 'content_hash_vs_drive_sha256';
    r.hash_matches = byDbxHash.get(s.content_hash) ?? [];
  } else {
    const buf = await DBX.download(s.path);
    r.method = 'download_sha256_vs_drive_sha256';
    r.downloaded_size = buf.length;
    r.downloaded_content_hash_agrees = dropboxHash(buf) === s.content_hash;
    r.hash_matches = bySha.get(sha256(buf).toString('hex')) ?? [];
    log(`  downloaded ${path.basename(s.path)} (${buf.length} B) — hash agrees with listing: ${r.downloaded_content_hash_agrees}`);
  }
  r.name_size_matches = byNameSize.get(`${path.basename(s.path).toLowerCase()}\u0000${s.size}`) ?? [];
  results.push(r);
}

const matched = results.filter((r) => r.hash_matches.length);
const summary = {
  generated: new Date().toISOString(),
  drive: { files: driveFiles.length, folders: folderPaths.length, shortcuts, files_without_sha256_non_google: noSha },
  selection: sel.length,
  selection_new_content: sel.filter((s) => s.sub === 'new_since_inventory').length,
  selection_carryover: sel.filter((s) => s.sub !== 'new_since_inventory').length,
  stubs_not_attempted: stubs,
  moves_excluded: moves.length,
  downloads: results.filter((r) => r.method.startsWith('download')).map((r) => ({ path: r.path, size: r.downloaded_size, content_hash_agrees: r.downloaded_content_hash_agrees })),
  content_already_in_drive: matched.map((r) => ({ path: r.path, sub: r.sub, group: r.group, drive_paths: r.hash_matches })),
  name_size_only_matches: results.filter((r) => !r.hash_matches.length && r.name_size_matches.length).map((r) => ({ path: r.path, drive_paths: r.name_size_matches })),
  verified_new: results.filter((r) => !r.hash_matches.length).length,
};
await fsp.writeFile(path.join(DIR, 'verify.json'), JSON.stringify({ ...summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.downloads.some((d) => !d.content_hash_agrees)) { log('ABORT: a downloaded file does not match its listed content_hash'); process.exit(2); }
