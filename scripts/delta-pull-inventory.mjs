/**
 * delta-pull-inventory.mjs — post-freeze delta: re-walk live Dropbox and diff it
 * against the copy ledger and the original inventories. PART A ONLY — maps and
 * copies nothing.
 *
 * READ-ONLY, both sides.
 *   Dropbox: oauth2/token, users/get_current_account, files/list_folder,
 *            files/list_folder/continue, files/list_revisions.
 *   Drive:   drive.readonly scope, files.list only.
 * No mutating endpoint is called. Nothing is deleted anywhere. The ledger, the
 * inventories and the mapping sheets are read, never written: outputs go to
 * dist/inventory/delta/ only, so the baselines this diffs against survive.
 *
 * Why a new walker rather than re-running dropbox-inventory.js: those scripts
 * overwrite grants-inventory.csv and non-grants-inventory.csv — the very
 * baselines this pass diffs against — and neither records content_hash or rev.
 *
 * ---- How MODIFIED is decided --------------------------------------------------
 * The ledger never recorded a content_hash (0 of 82,696 rows), so there is no
 * stored hash of what was copied. Two independent routes to one:
 *
 *   ≤ 4 MiB  Dropbox's content_hash is SHA-256 over the SHA-256 of each 4 MiB
 *            block. A file of one block therefore hashes to
 *            SHA-256(SHA-256(bytes)), and Drive's sha256Checksum IS
 *            SHA-256(bytes). So the hash of what Drive actually holds is
 *            derivable exactly, with no download. Verified by probe on
 *            2026-09-13 (35 KB and 3.0 MB files match; an 11 MB file does not,
 *            as the block structure predicts).
 *   > 4 MiB  Not derivable from Drive. A file with no Dropbox revision since its
 *            copy timestamp cannot have changed. One WITH a later revision is
 *            resolved from files/list_revisions: the revision current at copy
 *            time (latest at or before the ledger timestamp whose size equals
 *            the bytes the copier received) supplies the baseline hash.
 *
 * Size disagreement with the ledger's source_size is MODIFIED regardless.
 *
 * Usage: node scripts/delta-pull-inventory.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { once } from 'node:events';
import { parseCsv, normalizeName, isBatchName, GRANTS_PREFIX } from './grants-lib.mjs';
import { makeResolveNodes } from './mapping-lib.mjs';

process.chdir('/Users/Chris/grant-card-assistant');
const OUT_DIR = 'dist/inventory/delta';
const LEDGER = 'dist/inventory/copy-ledger.jsonl';
const GRANTS_INV = 'dist/inventory/grants-inventory.csv';
const NONGRANTS_INV = 'dist/inventory/non-grants-inventory.csv';
const SHEETS = ['dist/inventory/full-mapping.csv', 'dist/inventory/canexport-mapping.csv', 'dist/inventory/departments-mapping.csv'];
const CLIENTS = 'dist/inventory/clients-final.csv';
const RESOLVED = 'dist/inventory/resolved-final.csv';
const CORRECTIONS = 'scripts/client-corrections.json';
const DRIVE_ID = process.env.PILOT_DEST_ROOT || '0AKxoOSs3WbQ0Uk9PVA';

const TEAM_FOLDER = '/granted team folder';
const GRANTS_LOWER = GRANTS_PREFIX.toLowerCase().replace(/\/$/, '');
/** Being moved manually by their owners. Never listed, not even one level. */
const EXCLUDED = new Set(['FINANCE', 'HR', 'ADMIN', 'GETGRANTED', 'GRANTED STARTER']);
/** Top-level folders the original inventories walked. Anything else is new. */
const KNOWN_TOPS = new Set(['MINDFULNESS', 'LEADERSHIP', 'OPERATIONS', 'AI', 'RESEARCH', 'MARKETING', 'SALES', 'WRITERS']);
/** Dropbox froze Fri 2026-09-11 16:00 Pacific (PDT, UTC-7). */
const FREEZE_ISO = '2026-09-11T23:00:00Z';
const BLOCK = 4 * 1024 * 1024;
const COPY_WINDOW_MS = 3_600_000;
const T_TOKEN = 30_000;
const T_META = 60_000;
const EMPTY_HASH = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');

const log = (...a) => console.error(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();

// ---------------------------------------------------------------- retry
const TRANSIENT = new Set([
  'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE',
  'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
]);
/** Same retry classification as pilot-copy.mjs: transport errors live on err.cause.code. */
async function withRetry(label, fn, attempts = 6) {
  let delay = 1000;
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) {
      const status = err.status ?? 0;
      const netCode = err.cause?.code ?? err.code;
      const transport = TRANSIENT.has(netCode)
        || (err.name === 'TypeError' && /fetch failed/i.test(err.message ?? ''))
        || err.name === 'TimeoutError' || err.name === 'AbortError';
      const retryable = status === 429 || (status >= 500 && status < 600) || transport;
      if (!retryable || i >= attempts) throw err;
      const wait = Number(err.retryAfter || 0) * 1000 || delay;
      log(`  ⏳ ${label}: ${status || netCode || err.name}, retry ${i}/${attempts - 1} in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      delay = Math.min(delay * 2, 32000);
    }
  }
}
function httpError(res, body) {
  const e = new Error(`HTTP ${res.status}: ${String(body).slice(0, 300)}`);
  e.status = res.status;
  e.retryAfter = res.headers.get('retry-after');
  try { e.body = JSON.parse(body); } catch { e.body = null; }
  return e;
}

// ---------------------------------------------------------------- Step 1: Dropbox auth + assertions
log('===== STEP 1 — Dropbox auth + team-namespace assertion');
const { DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, DROPBOX_NAMESPACE_ID } = process.env;
for (const [n, v] of Object.entries({ DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, DROPBOX_NAMESPACE_ID })) {
  if (!v) { log(`ABORT: ${n} is not set.`); process.exit(1); }
}
const DBX = {
  token: null, exp: 0,
  async accessToken() {
    if (this.token && Date.now() < this.exp - 300_000) return this.token;
    const res = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: DROPBOX_REFRESH_TOKEN,
        client_id: DROPBOX_APP_KEY, client_secret: DROPBOX_APP_SECRET,
      }),
      signal: AbortSignal.timeout(T_TOKEN),
    });
    if (!res.ok) throw httpError(res, await res.text());
    const d = await res.json();
    this.token = d.access_token;
    this.exp = Date.now() + d.expires_in * 1000;
    return this.token;
  },
  /** READ-ONLY RPC. Path-Root pins every call to the team namespace. No Select-User: the app may not send it. */
  async rpc(endpoint, body, { pathRoot = true } = {}) {
    return withRetry(endpoint, async () => {
      const token = await this.accessToken();
      const headers = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (pathRoot) headers['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'namespace_id', namespace_id: DROPBOX_NAMESPACE_ID });
      const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
        method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(T_META),
      });
      if (!res.ok) throw httpError(res, await res.text());
      return res.json();
    });
  },
};

const acct = await DBX.rpc('users/get_current_account', undefined, { pathRoot: false });
const homeNs = acct.root_info?.home_namespace_id ?? null;
const rootNs = acct.root_info?.root_namespace_id ?? null;
log(`  account: ${acct.email} (team: ${acct.team?.name ?? 'none'})`);
log(`  home_namespace_id=${homeNs} root_namespace_id=${rootNs} DROPBOX_NAMESPACE_ID=${DROPBOX_NAMESPACE_ID}`);
// Without Path-Root the API silently serves the member's PERSONAL Dropbox, which
// holds a decoy conflict-copy of the team folder.
if (DROPBOX_NAMESPACE_ID === homeNs) {
  log("ABORT: DROPBOX_NAMESPACE_ID is the member's personal Dropbox, not the team namespace."); process.exit(1);
}
if (DROPBOX_NAMESPACE_ID !== rootNs) {
  log(`ABORT: DROPBOX_NAMESPACE_ID does not match the account root namespace (${rootNs}).`); process.exit(1);
}
const nsRoot = (await DBX.rpc('files/list_folder', { path: '', recursive: false, include_mounted_folders: true })).entries;
if (!nsRoot.some((e) => e.name.trim().toLowerCase() === 'granted team folder')) {
  log(`ABORT: namespace root does not contain "Granted Team Folder" — saw: ${nsRoot.map((e) => e.name).join(', ')}`); process.exit(1);
}
log('  ✓ team namespace confirmed');
const assertion = { account: acct.email, team: acct.team?.name ?? null, home_namespace_id: homeNs, root_namespace_id: rootNs, namespace_used: DROPBOX_NAMESPACE_ID, ns_root_entries: nsRoot.map((e) => e.name) };

await fsp.mkdir(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------- Step 1: walk
log('\n===== STEP 1 — walk (metadata only)');
const flagsOf = (e) => ({ no_access: e.sharing_info?.no_access === true, traverse_only: e.sharing_info?.traverse_only === true, read_only: e.sharing_info?.read_only === true });
const topEntries = (await DBX.rpc('files/list_folder', { path: TEAM_FOLDER, recursive: false, include_mounted_folders: true })).entries;

const live = new Map();          // path_lower -> file record
const liveFolders = new Map();   // path_lower -> {path, flags}
const targets = [];
const skippedTops = [];
const newTops = [];
for (const e of topEntries) {
  if (e['.tag'] === 'file') {
    live.set(e.path_lower, toFile(e));
    continue;
  }
  const up = e.name.trim().toUpperCase();
  if (EXCLUDED.has(up)) { skippedTops.push({ name: e.name, ...flagsOf(e) }); continue; }
  if (!KNOWN_TOPS.has(up)) newTops.push(e.name);
  targets.push({ name: e.name, path: e.path_lower, ...flagsOf(e) });
}
log(`  targets: ${targets.map((t) => t.name + (t.traverse_only ? ' <traverse_only>' : '')).join(', ')}`);
log(`  never listed (out of scope): ${skippedTops.map((t) => t.name).join(', ')}`);
if (newTops.length) log(`  NEW top-level folders since the inventory: ${newTops.join(', ')}`);

function toFile(e) {
  return {
    path: e.path_display, path_lower: e.path_lower, id: e.id, name: e.name,
    size: e.size, content_hash: e.content_hash ?? null, rev: e.rev,
    server_modified: e.server_modified, client_modified: e.client_modified,
    is_downloadable: e.is_downloadable !== false,
  };
}

const walkOut = fs.createWriteStream(path.join(OUT_DIR, 'live-dropbox.jsonl'));
const walkFailures = [];
for (const t of targets) {
  let files = 0, folders = 0;
  // A list_folder cursor can be invalidated mid-walk (409 reset). Restart the
  // target from scratch rather than resuming a dead cursor.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tFiles = [], tFolders = [];
    try {
      let d = await DBX.rpc('files/list_folder', { path: t.path, recursive: true, limit: 2000, include_deleted: false, include_mounted_folders: true });
      while (true) {
        for (const e of d.entries) {
          if (e['.tag'] === 'file') tFiles.push(toFile(e));
          else if (e['.tag'] === 'folder') tFolders.push({ path: e.path_display, path_lower: e.path_lower, ...flagsOf(e) });
        }
        if (!d.has_more) break;
        d = await DBX.rpc('files/list_folder/continue', { cursor: d.cursor });
      }
      for (const f of tFiles) { live.set(f.path_lower, f); if (!walkOut.write(JSON.stringify({ type: 'file', ...f }) + '\n')) await once(walkOut, 'drain'); }
      for (const f of tFolders) { liveFolders.set(f.path_lower, f); if (!walkOut.write(JSON.stringify({ type: 'folder', ...f }) + '\n')) await once(walkOut, 'drain'); }
      files = tFiles.length; folders = tFolders.length;
      break;
    } catch (err) {
      const reset = err.status === 409 && /reset/.test(err.message);
      if (reset && attempt < 3) { log(`  ${t.name}: cursor reset, restarting walk (${attempt + 1}/3)`); continue; }
      walkFailures.push({ target: t.name, error: err.message });
      log(`  ${t.name}: FAILED — ${err.message}`);
      break;
    }
  }
  t.files = files; t.folders = folders;
  log(`  ${t.name}: ${files} files, ${folders} folders`);
}
for (const f of live.values()) if (f.path_lower.split('/').length === 3) walkOut.write(JSON.stringify({ type: 'file', ...f }) + '\n');
walkOut.end(); await once(walkOut, 'finish');
if (walkFailures.length) { log(`ABORT: ${walkFailures.length} walk target(s) failed — a partial walk would misreport DELETED.`); process.exit(1); }
log(`  live: ${live.size} files, ${liveFolders.size} folders`);

const afterFreeze = [...live.values()].filter((f) => f.server_modified > FREEZE_ISO);

// ---------------------------------------------------------------- baselines
log('\n===== STEP 2 — load baselines');
const ledgerBySource = new Map();   // source_lower -> [verified entries]
const failedOnly = new Map();       // source_lower -> last failure
let ledgerRows = 0;
for (const line of (await fsp.readFile(LEDGER, 'utf8')).split('\n')) {
  if (!line.trim()) continue;
  ledgerRows += 1;
  const e = JSON.parse(line);
  if (e.action === 'shortcut') continue;
  const k = e.source.toLowerCase();
  if (e.status === 'verified' && e.drive_file_id) {
    if (!ledgerBySource.has(k)) ledgerBySource.set(k, []);
    ledgerBySource.get(k).push(e);
  } else if (e.status === 'failed') failedOnly.set(k, e);
}
for (const k of ledgerBySource.keys()) failedOnly.delete(k);
log(`  ledger: ${ledgerRows} rows, ${ledgerBySource.size} verified sources, ${failedOnly.size} failed-only sources`);

const invFiles = new Map();         // path_lower -> {source: 'grants'|'non-grants'}
const invFolders = new Set();
for (const [file, label] of [[GRANTS_INV, 'grants'], [NONGRANTS_INV, 'non-grants']]) {
  let h = null;
  for (const r of parseCsv(await fsp.readFile(file, 'utf8'))) {
    if (!h) { h = r; continue; }
    if (!r[0]) continue;
    if (r[2] === 'file') invFiles.set(r[0].toLowerCase(), { inventory: label, top: label === 'non-grants' ? r[7] : 'SALES' });
    else invFolders.add(r[0].toLowerCase());
  }
}
// The walk roots themselves were never rows: non-grants walked each top-level
// folder from inside, and exploded SALES into its children. Without these seeds
// every new department folder reports its top-level folder as "new".
invFolders.add(TEAM_FOLDER);
for (const t of targets) if (KNOWN_TOPS.has(t.name.trim().toUpperCase())) invFolders.add(t.path);
log(`  inventories: ${invFiles.size} files, ${invFolders.size} folders`);

const sheetRoute = new Map();       // source_lower -> {route, reason, sheet}
for (const sheet of SHEETS) {
  let h = null, iSrc, iRoute, iReason;
  for (const r of parseCsv(await fsp.readFile(sheet, 'utf8'))) {
    if (!h) { h = r; iSrc = h.indexOf('source_path'); iRoute = h.indexOf('route'); iReason = h.indexOf('reason'); continue; }
    if (!r[iSrc]) continue;
    sheetRoute.set(r[iSrc].toLowerCase(), { route: r[iRoute], reason: r[iReason], sheet: path.basename(sheet) });
  }
}

// ---------------------------------------------------------------- Drive listing (read-only)
log('\n===== STEP 2 — Drive listing (files.list, drive.readonly)');
async function loadServiceKey() {
  const fromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (fromEnv && fromEnv.trim().startsWith('{')) { try { return JSON.parse(fromEnv); } catch { /* truncated by dotenv */ } }
  const lines = (await fsp.readFile('.env', 'utf8')).split('\n');
  const i = lines.findIndex((l) => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY='));
  if (i < 0) throw new Error('no service account key');
  let raw = lines[i].slice('GOOGLE_SERVICE_ACCOUNT_KEY='.length);
  for (let j = i + 1; j < lines.length; j++) { if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break; raw += '\n' + lines[j]; }
  return JSON.parse(raw.trim().replace(/^['"]|['"]$/g, ''));
}
const DRIVE_TOKEN = await (async () => {
  const key = await loadServiceKey();
  const nowSec = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  return withRetry('drive token', async () => {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
      signal: AbortSignal.timeout(T_TOKEN),
    });
    if (!res.ok) throw httpError(res, await res.text());
    return (await res.json()).access_token;
  });
})();
const driveById = new Map();        // id -> {size, sha256, mimeType}
{
  let pageToken = null, page = 0;
  do {
    const url = 'https://www.googleapis.com/drive/v3/files'
      + `?q=${encodeURIComponent('trashed = false')}`
      + '&fields=nextPageToken,files(id,mimeType,size,sha256Checksum)&pageSize=1000'
      + `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}`
      + (pageToken ? `&pageToken=${pageToken}` : '');
    const d = await withRetry(`drive list page ${page}`, async () => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${DRIVE_TOKEN}` }, signal: AbortSignal.timeout(T_META) });
      if (!res.ok) throw httpError(res, await res.text());
      return res.json();
    });
    for (const f of d.files ?? []) driveById.set(f.id, { size: Number(f.size ?? 0), sha256: f.sha256Checksum ?? null, mimeType: f.mimeType });
    pageToken = d.nextPageToken;
    if (++page % 20 === 0) log(`  drive: page ${page}, ${driveById.size} items`);
  } while (pageToken);
  log(`  drive: ${driveById.size} items`);
}

/** Dropbox content_hash of what Drive holds, when derivable (single block). */
function hashFromDrive(d) {
  if (!d || d.sha256 === null) return null;
  if (d.size === 0) return EMPTY_HASH;
  if (d.size > BLOCK) return null;
  return crypto.createHash('sha256').update(Buffer.from(d.sha256, 'hex')).digest('hex');
}

// ---------------------------------------------------------------- Step 2: classify
log('\n===== STEP 2 — diff');
const results = new Map();          // path_lower -> row
const suspects = [];                // {f, entry} needing list_revisions
const stats = { method_drive_hash: 0, method_no_revision: 0, method_revisions: 0, size_differs: 0,
  xcheck_hash_differs_no_revision: 0, xcheck_same_bytes_new_revision: 0, drive_copy_missing: 0, case_only_path_change: 0 };

for (const f of live.values()) {
  const entries = ledgerBySource.get(f.path_lower);
  if (!entries) {
    const inv = invFiles.get(f.path_lower);
    const sr = sheetRoute.get(f.path_lower);
    const failed = failedOnly.get(f.path_lower);
    let sub, why;
    if (!inv) { sub = 'new_since_inventory'; why = f.path_lower.split('/').length === 3 ? 'loose file at team-folder root — never in any walk scope' : 'not in either inventory'; }
    else if (failed) { sub = 'inventoried_copy_failed'; why = `copy failed: ${String(failed.error).slice(0, 120)}`; }
    else if (sr?.route === 'review') { sub = 'inventoried_review_route'; why = `route review in ${sr.sheet}: ${sr.reason}`; }
    else if (sr) { sub = 'inventoried_mapped_not_copied'; why = `route ${sr.route} in ${sr.sheet}, no ledger row`; }
    else { sub = 'inventoried_not_mapped'; why = 'in inventory, in no mapping sheet'; }
    results.set(f.path_lower, { cat: 'NEW', sub, f, why, entries: [] });
    continue;
  }
  if (entries.some((e) => e.source !== f.path) && !entries.some((e) => e.source === f.path)) stats.case_only_path_change += 1;

  const verdicts = [];
  for (const e of entries) {
    const d = driveById.get(e.drive_file_id);
    if (!d) stats.drive_copy_missing += 1;
    if (f.size !== e.source_size) { verdicts.push({ e, modified: true, method: 'size', detail: `ledger ${e.source_size} → live ${f.size}` }); continue; }
    // The ledger is stamped AFTER download and upload, so a revision landing
    // inside the copy window would pass a strict comparison. Widen by an hour;
    // list_revisions then settles which revision was actually received.
    const revisedAfterCopy = Date.parse(f.server_modified) > Date.parse(e.timestamp) - COPY_WINDOW_MS;
    const driveHash = hashFromDrive(d);
    if (driveHash && d.size === e.uploaded_size) {
      const differs = driveHash !== f.content_hash;
      if (differs && !revisedAfterCopy) stats.xcheck_hash_differs_no_revision += 1;
      if (!differs && revisedAfterCopy) stats.xcheck_same_bytes_new_revision += 1;
      verdicts.push({ e, modified: differs, method: 'drive_hash', detail: differs ? 'content_hash differs from Drive-derived hash' : '' });
      continue;
    }
    if (!revisedAfterCopy) { verdicts.push({ e, modified: false, method: 'no_revision_since_copy', detail: '' }); continue; }
    verdicts.push({ e, modified: null, method: 'revisions', detail: 'pending' });
    suspects.push({ f, e, verdictIndex: verdicts.length - 1, verdicts });
  }
  results.set(f.path_lower, { cat: null, f, entries, verdicts });
}
log(`  suspects needing list_revisions: ${suspects.length}`);

// ---------------------------------------------------------------- resolve suspects
let revDone = 0;
const revCache = new Map();
async function revisionsOf(p) {
  if (!revCache.has(p)) revCache.set(p, DBX.rpc('files/list_revisions', { path: p, mode: 'path', limit: 100 }).then((d) => d.entries ?? []));
  return revCache.get(p);
}
let qi = 0;
async function revWorker() {
  while (qi < suspects.length) {
    const s = suspects[qi++];
    const v = s.verdicts[s.verdictIndex];
    try {
      const revs = await revisionsOf(s.f.path_lower);
      const copyAt = Date.parse(s.e.timestamp);
      // Revisions current at or before the copy that match the bytes received.
      const cands = revs.filter((r) => Date.parse(r.server_modified) <= copyAt && r.size === s.e.source_size)
        .sort((a, b) => Date.parse(b.server_modified) - Date.parse(a.server_modified));
      if (!cands.length) {
        v.modified = true; v.detail = 'no revision at copy time matches copied size — treated as modified (unresolved)'; v.unresolved = true;
      } else {
        const base = cands[0];
        v.modified = base.content_hash !== s.f.content_hash;
        v.detail = v.modified ? `content_hash differs from revision ${base.rev} (${base.server_modified}) current at copy` : `new revision, same bytes as revision ${base.rev}`;
        // Copy-window ambiguity: the baseline revision landed within the hour
        // before the ledger stamp and an older same-size revision differs.
        const nearWindow = copyAt - Date.parse(base.server_modified) < COPY_WINDOW_MS;
        if (nearWindow && cands.slice(1).some((r) => r.content_hash !== base.content_hash)) {
          v.modified = true; v.unresolved = true; v.detail += ' — ambiguous: revision landed inside the copy window';
        }
      }
    } catch (err) {
      v.modified = true; v.unresolved = true; v.detail = `list_revisions failed: ${err.message.slice(0, 120)} — treated as modified`;
    }
    if (++revDone % 250 === 0) log(`  revisions: ${revDone}/${suspects.length}`);
  }
}
await Promise.all(Array.from({ length: 4 }, revWorker));

for (const r of results.values()) {
  if (r.cat) continue;
  for (const v of r.verdicts) {
    if (v.method === 'size') stats.size_differs += 1;
    else if (v.method === 'drive_hash') stats.method_drive_hash += 1;
    else if (v.method === 'no_revision_since_copy') stats.method_no_revision += 1;
    else stats.method_revisions += 1;
  }
  const mod = r.verdicts.filter((v) => v.modified);
  r.cat = mod.length ? 'MODIFIED' : 'UNCHANGED';
  r.sub = mod.length ? (mod.some((v) => v.unresolved) ? 'unresolved_conservative' : mod[0].method) : r.verdicts[0].method;
  r.why = mod.map((v) => v.detail).join(' | ');
}

// DELETED: copied, now gone from live Dropbox.
const deleted = [];
for (const [k, entries] of ledgerBySource) {
  if (live.has(k)) continue;
  deleted.push({ path_lower: k, path: entries[0].source, entries, size: entries[0].source_size });
}

// Probable moves: a DELETED source whose bytes reappear as a NEW file.
const newByHash = new Map(), newByNameSize = new Map();
for (const r of results.values()) {
  if (r.cat !== 'NEW') continue;
  if (r.f.content_hash) { if (!newByHash.has(r.f.content_hash)) newByHash.set(r.f.content_hash, []); newByHash.get(r.f.content_hash).push(r.f.path); }
  const ns = `${r.f.name.toLowerCase()}\u0000${r.f.size}`;
  if (!newByNameSize.has(ns)) newByNameSize.set(ns, []); newByNameSize.get(ns).push(r.f.path);
}
for (const d of deleted) {
  const h = hashFromDrive(driveById.get(d.entries[0].drive_file_id));
  const byHash = h ? newByHash.get(h) : null;
  const byNS = newByNameSize.get(`${path.basename(d.path).toLowerCase()}\u0000${d.size}`);
  d.move = byHash ? { basis: 'content_hash', to: byHash } : byNS ? { basis: 'name+size', to: byNS } : null;
  d.drive_present = d.entries.filter((e) => driveById.has(e.drive_file_id)).length;
}
const movedTo = new Set(deleted.filter((d) => d.move).flatMap((d) => d.move.to.map((p) => p.toLowerCase())));

// ---------------------------------------------------------------- Step 3: NEW — existing client folder or new name?
log('\n===== STEP 3 — NEW files: client folders');
const rawToCanon = new Map();
{
  let h = null;
  for (const r of parseCsv(await fsp.readFile(CLIENTS, 'utf8'))) {
    if (!h) { h = r; continue; }
    if (!r[0]) continue;
    const rec = { canonical: r[0], retention: r[8] };
    for (const raw of (r[1] ? r[1].split(' | ') : [])) rawToCanon.set(normalizeName(raw), rec);
  }
}
const nameStatus = new Map();
{
  let h = null;
  for (const r of parseCsv(await fsp.readFile(RESOLVED, 'utf8'))) {
    if (!h) { h = r; continue; }
    if (!r[1]) continue;
    nameStatus.set(r[1], { label: r[2], status: r[6], confidence: r[4] });
  }
  const corr = JSON.parse(await fsp.readFile(CORRECTIONS, 'utf8'));
  for (const c of corr.corrections) {
    if (!c.asserts_client) continue;
    for (const raw of c.raw_names) {
      const k = normalizeName(raw);
      if (nameStatus.get(k)?.label === 'client') continue;
      nameStatus.set(k, { label: 'client', status: 'HAND', confidence: 'hand' });
    }
  }
}

/**
 * Build resolveNodes' client-node index from Grants folders, keyed on the
 * lower-cased path below Grants/. Keyed on path_lower rather than path_display
 * because Dropbox only guarantees the casing of a path's LAST segment — a
 * case-sensitive prefix match would silently drop folders whose parents come
 * back re-cased. Names (which classification reads) come from the display form.
 */
function nodeIndex(folders) {
  const childrenByParent = new Map();
  const programs = [];
  for (const { display, lower } of folders) {
    if (!lower.startsWith(GRANTS_LOWER + '/')) continue;
    const segs = lower.slice(GRANTS_LOWER.length + 1).split('/');
    const key = segs.join('/');
    const name = path.basename(display);
    if (segs.length === 1) { programs.push({ name, key }); continue; }
    const parent = segs.slice(0, -1).join('/');
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push({ name, key });
  }
  const resolve = makeResolveNodes(childrenByParent, 8);
  const m = new Map();
  for (const p of programs) for (const n of resolve(p.key)) m.set(n.key, { name: n.name, program: p.name });
  return { nodes: m, programs: new Set(programs.map((p) => p.key)) };
}
const oldGrantsFolders = [];
{
  let h = null;
  for (const r of parseCsv(await fsp.readFile(GRANTS_INV, 'utf8'))) { if (!h) { h = r; continue; } if (r[2] === 'folder') oldGrantsFolders.push({ display: r[0], lower: r[0].toLowerCase() }); }
}
const oldIdx = nodeIndex(oldGrantsFolders);
const liveIdx = nodeIndex([...liveFolders.values()].map((f) => ({ display: f.path, lower: f.path_lower })));

function nodeFor(idx, relLowerSegs) {
  for (let k = 1; k <= relLowerSegs.length; k++) {
    const hit = idx.nodes.get(relLowerSegs.slice(0, k).join('/'));
    if (hit) return { ...hit, depth: k };
  }
  return null;
}
function describeName(name) {
  const k = normalizeName(name);
  const st = nameStatus.get(k);
  const canon = rawToCanon.get(k);
  if (canon && st?.label === 'client') return { known: true, label: 'client', canonical: canon.canonical };
  if (st) return { known: true, label: st.label, canonical: canon?.canonical ?? '' };
  if (canon) return { known: true, label: 'client (canon only)', canonical: canon.canonical };
  return { known: false, label: '', canonical: '' };
}

const isGrants = (pl) => pl.startsWith(GRANTS_LOWER + '/');
for (const r of results.values()) {
  if (r.cat !== 'NEW') continue;
  const pl = r.f.path_lower;
  if (isGrants(pl)) {
    const rel = pl.slice(GRANTS_LOWER.length + 1).split('/');
    const folderSegs = rel.slice(0, -1);
    const relDisplay = r.f.path.slice(GRANTS_PREFIX.length).split('/');
    if (!folderSegs.length) { r.step3 = { cls: 'grants_root_loose', node: '' }; continue; }
    if (!oldIdx.programs.has(folderSegs[0])) { r.step3 = { cls: 'new_program_folder', node: relDisplay[0] }; continue; }
    const old = nodeFor(oldIdx, folderSegs);
    if (old) {
      const d = describeName(old.name);
      r.step3 = { cls: 'existing_client_folder', node: old.name, label: d.label, canonical: d.canonical, nodePath: relDisplay.slice(0, old.depth).join('/') };
      continue;
    }
    const nu = nodeFor(liveIdx, folderSegs);
    if (!nu) { r.step3 = { cls: 'no_client_level_folder', node: '' }; continue; }
    const d = describeName(nu.name);
    const batch = isBatchName(nu.name);
    r.step3 = {
      cls: d.known ? 'new_folder_known_name' : 'new_folder_never_seen',
      node: nu.name, label: d.label, canonical: d.canonical, batch,
      nodePath: relDisplay.slice(0, nu.depth).join('/'),
    };
  } else {
    // Departments mirror: no client concept. Existing folder path, or a new one.
    const parent = pl.slice(0, pl.lastIndexOf('/'));
    if (parent === TEAM_FOLDER) { r.step3 = { cls: 'team_folder_root', node: '' }; continue; }
    if (invFolders.has(parent)) { r.step3 = { cls: 'dept_existing_folder', node: '' }; continue; }
    // Top-most folder on the chain that did not exist before.
    const segs = parent.split('/');
    let first = parent;
    for (let k = 3; k <= segs.length; k++) { const p = segs.slice(0, k).join('/'); if (!invFolders.has(p)) { first = p; break; } }
    r.step3 = { cls: 'dept_new_folder', node: liveFolders.get(first)?.path ?? first };
  }
}

// ---------------------------------------------------------------- Step 4: groups
const groupOf = (pl, display) => {
  if (isGrants(pl)) {
    const seg = display.slice(GRANTS_PREFIX.length).split('/');
    return seg.length > 1 ? `Grants / ${seg[0]}` : 'Grants / (root)';
  }
  const segs = display.split('/');
  if (segs.length === 3) return '(team folder root)';
  const top = segs[2];
  return top.toUpperCase() === 'SALES' ? `SALES / ${segs.length > 4 ? segs[3] : '(root)'}` : top;
};

// ---------------------------------------------------------------- outputs
const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const HEAD = ['category', 'subcategory', 'group', 'source_path', 'size', 'content_hash', 'server_modified', 'client_modified', 'is_downloadable',
  'step3_class', 'step3_node', 'step3_node_path', 'step3_label', 'step3_canonical', 'probable_move_of', 'ledger_copies', 'drive_file_ids', 'destinations', 'detail'];
const csvOut = fs.createWriteStream(path.join(OUT_DIR, 'delta-diff.csv'));
csvOut.write(HEAD.join(',') + '\n');
const writeRow = async (cells) => { if (!csvOut.write(cells.map(esc).join(',') + '\n')) await once(csvOut, 'drain'); };

const moveSourceFor = new Map();
for (const d of deleted) if (d.move) for (const p of d.move.to) moveSourceFor.set(p.toLowerCase(), d.path);

for (const r of [...results.values()].sort((a, b) => a.f.path.localeCompare(b.f.path))) {
  const f = r.f;
  await writeRow([r.cat, r.sub, groupOf(f.path_lower, f.path), f.path, f.size, f.content_hash, f.server_modified, f.client_modified, f.is_downloadable,
    r.step3?.cls ?? '', r.step3?.node ?? '', r.step3?.nodePath ?? '', r.step3?.label ?? '', r.step3?.canonical ?? '', moveSourceFor.get(f.path_lower) ?? '',
    r.entries.length, r.entries.map((e) => e.drive_file_id).join(' | '), r.entries.map((e) => e.destination).join(' | '), r.why ?? '']);
}
for (const d of deleted.sort((a, b) => a.path.localeCompare(b.path))) {
  await writeRow(['DELETED', d.move ? `probable_move_${d.move.basis}` : 'gone', groupOf(d.path_lower, d.path), d.path, d.size, '', '', '', '',
    '', '', '', '', '', d.move ? d.move.to.join(' | ') : '', d.entries.length, d.entries.map((e) => e.drive_file_id).join(' | '),
    d.entries.map((e) => e.destination).join(' | '), `${d.drive_present}/${d.entries.length} Drive copies present`]);
}
csvOut.end(); await once(csvOut, 'finish');

// ---------------------------------------------------------------- summary
const tally = (arr, keyFn) => {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, { files: 0, bytes: 0 }); const e = m.get(k); e.files += 1; e.bytes += x.bytes; }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1].files - a[1].files));
};
const all = [...results.values()].map((r) => ({ ...r, bytes: r.f.size, group: groupOf(r.f.path_lower, r.f.path) }));
const by = (cat) => all.filter((r) => r.cat === cat);
const sum = (arr) => ({ files: arr.length, bytes: arr.reduce((s, x) => s + x.bytes, 0) });
const NEW = by('NEW'), MOD = by('MODIFIED'), UNCH = by('UNCHANGED');
// Step 3 is about material that appeared after the inventory. Inventoried files
// that were simply never copied (review rows, stubs) are tallied apart.
const newGrantsAll = NEW.filter((r) => isGrants(r.f.path_lower));
const newStep3 = newGrantsAll.filter((r) => r.sub === 'new_since_inventory');
const nodeTally = (cls) => {
  const m = new Map();
  for (const r of newStep3.filter((x) => x.step3.cls === cls)) {
    const k = r.step3.nodePath || r.step3.node;
    if (!m.has(k)) m.set(k, { node: r.step3.node, label: r.step3.label, canonical: r.step3.canonical, batch: r.step3.batch ?? false, files: 0, bytes: 0 });
    const e = m.get(k); e.files += 1; e.bytes += r.bytes;
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1].files - a[1].files));
};

const summary = {
  generated: new Date().toISOString(),
  runtime_seconds: Math.round((Date.now() - t0) / 1000),
  assertion,
  walk: {
    targets: targets.map((t) => ({ name: t.name, files: t.files, folders: t.folders, traverse_only: t.traverse_only, no_access: t.no_access })),
    never_listed_out_of_scope: skippedTops,
    new_top_level_folders: newTops,
    live_files: live.size, live_folders: liveFolders.size,
    live_bytes: [...live.values()].reduce((s, f) => s + f.size, 0),
    files_server_modified_after_freeze: afterFreeze.length,
    after_freeze_sample: afterFreeze.slice(0, 20).map((f) => ({ path: f.path, server_modified: f.server_modified })),
    traverse_only_folders: [...liveFolders.values()].filter((f) => f.traverse_only || f.no_access).map((f) => f.path),
  },
  baseline: { ledger_rows: ledgerRows, ledger_verified_sources: ledgerBySource.size, failed_only_sources: failedOnly.size,
    inventory_files: invFiles.size, drive_items: driveById.size },
  categories: {
    NEW: { ...sum(NEW), by_sub: tally(NEW, (r) => r.sub), non_downloadable: NEW.filter((r) => !r.f.is_downloadable).length,
      that_are_probable_moves_of_deleted: NEW.filter((r) => movedTo.has(r.f.path_lower)).length },
    MODIFIED: { ...sum(MOD), drive_copies_stale: MOD.reduce((s, r) => s + r.verdicts.filter((v) => v.modified).length, 0), by_sub: tally(MOD, (r) => r.sub) },
    DELETED: { files: deleted.length, bytes: deleted.reduce((s, d) => s + (d.size ?? 0), 0),
      drive_copies: deleted.reduce((s, d) => s + d.entries.length, 0),
      drive_copies_present: deleted.reduce((s, d) => s + d.drive_present, 0),
      probable_moves: { content_hash: deleted.filter((d) => d.move?.basis === 'content_hash').length, name_size: deleted.filter((d) => d.move?.basis === 'name+size').length },
      by_group: tally(deleted.map((d) => ({ bytes: d.size ?? 0, group: groupOf(d.path_lower, d.path) })), (x) => x.group) },
    UNCHANGED: { ...sum(UNCH), by_method: tally(UNCH, (r) => r.sub) },
  },
  method_stats: stats,
  suspects_resolved_via_list_revisions: suspects.length,
  step3: {
    by_class: tally(newStep3, (r) => r.step3.cls),
    by_class_inventoried_not_copied: tally(newGrantsAll.filter((r) => r.sub !== 'new_since_inventory'), (r) => `${r.sub} / ${r.step3.cls}`),
    existing_client_folders: nodeTally('existing_client_folder'),
    new_folder_known_name: nodeTally('new_folder_known_name'),
    new_folder_never_seen: nodeTally('new_folder_never_seen'),
    new_program_folders: tally(newStep3.filter((r) => r.step3.cls === 'new_program_folder'), (r) => r.step3.node),
    departments: tally(NEW.filter((r) => !isGrants(r.f.path_lower)), (r) => r.step3.cls),
    dept_new_folders: tally(NEW.filter((r) => r.step3?.cls === 'dept_new_folder'), (r) => r.step3.node),
  },
  step4: {
    NEW_by_group: tally(NEW, (r) => r.group),
    NEW_since_inventory_by_group: tally(NEW.filter((r) => r.sub === 'new_since_inventory'), (r) => r.group),
    NEW_since_inventory_moves_by_group: tally(NEW.filter((r) => r.sub === 'new_since_inventory' && movedTo.has(r.f.path_lower)), (r) => r.group),
    NEW_since_inventory_new_content_by_group: tally(NEW.filter((r) => r.sub === 'new_since_inventory' && !movedTo.has(r.f.path_lower)), (r) => r.group),
    MODIFIED_by_group: tally(MOD, (r) => r.group),
  },
  samples: {
    modified: MOD.slice(0, 40).map((r) => ({ path: r.f.path, sub: r.sub, why: r.why, server_modified: r.f.server_modified })),
    deleted: deleted.slice(0, 40).map((d) => ({ path: d.path, move: d.move })),
    new_known_not_copied: NEW.filter((r) => r.sub !== 'new_since_inventory').slice(0, 40).map((r) => ({ path: r.f.path, sub: r.sub, why: r.why })),
  },
};
await fsp.writeFile(path.join(OUT_DIR, 'delta-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
log(`\nwrote ${OUT_DIR}/live-dropbox.jsonl, delta-diff.csv, delta-summary.json`);
