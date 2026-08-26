/**
 * gdrive-org-inventory.mjs — READ-ONLY metadata inventory of the organization's
 * Google Drive: every Shared Drive and every user's My Drive.
 *
 * Establishes what exists in Drive before the Dropbox migration is folded in.
 * This pass OBSERVES ONLY. It proposes no destinations and classifies nothing.
 *
 * Guarantees:
 *   - Every Drive/Admin call is a GET. The only POST is the OAuth token grant,
 *     which is the sole way to authenticate.
 *   - No file CONTENT is ever fetched: no alt=media, no files.export, no
 *     download of any kind. Metadata fields only.
 *   - Nothing is moved, copied, renamed, deleted, or re-shared. No permission
 *     is modified — permissions are read to detect external sharing.
 *   - Checkpointed: an interrupted run resumes per-account rather than
 *     re-walking completed accounts.
 *
 * Access requirements (see docs/inventory/gdrive-org-summary.md):
 *   domain-wide delegation for the service account, impersonating a super
 *   admin via GOOGLE_IMPERSONATE, with scopes
 *     https://www.googleapis.com/auth/drive.readonly
 *     https://www.googleapis.com/auth/admin.directory.user.readonly
 *
 * Usage:
 *   node scripts/gdrive-org-inventory.mjs
 *   node scripts/gdrive-org-inventory.mjs --resume
 */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import 'dotenv/config';

process.chdir('/Users/Chris/grant-card-assistant');
const CSV_OUT = 'dist/inventory/gdrive-org-inventory.csv';
const CKPT_DIR = '/private/tmp/claude-502/-Users-Chris-grant-card-assistant/56737d29-82b4-4b8e-89e9-221a014eb896/scratchpad/gdrive-ckpt';
const DOMAIN = process.env.GDRIVE_ORG_DOMAIN || 'granted.ca';
const SUB = process.env.GOOGLE_IMPERSONATE;
const T = 60_000;
const log = (...a) => console.error(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!SUB) { log('ABORT: GOOGLE_IMPERSONATE is not set.'); process.exit(1); }

const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.readonly';
const SCOPE_DIR = 'https://www.googleapis.com/auth/admin.directory.user.readonly';

// ---------------------------------------------------------------- auth
async function loadKey() {
  const lines = (await fsp.readFile('.env', 'utf8')).split('\n');
  const i = lines.findIndex((l) => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY='));
  if (i < 0) throw new Error('no service account key in .env');
  let raw = lines[i].slice('GOOGLE_SERVICE_ACCOUNT_KEY='.length);
  for (let j = i + 1; j < lines.length; j++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break;
    raw += '\n' + lines[j];
  }
  return JSON.parse(raw.trim().replace(/^['"]|['"]$/g, ''));
}
const KEY = await loadKey();
const tokenCache = new Map();   // `${scope}|${sub}` -> {token, exp}
async function token(scope, sub) {
  const k = `${scope}|${sub ?? ''}`;
  const hit = tokenCache.get(k);
  if (hit && Date.now() < hit.exp - 300_000) return hit.token;
  const n = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const claim = { iss: KEY.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: n, exp: n + 3600, ...(sub ? { sub } : {}) };
  const u = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claim)}`;
  const s = crypto.createSign('RSA-SHA256').update(u).sign(KEY.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${u}.${s}` }),
    signal: AbortSignal.timeout(T),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`token(${sub}): ${d.error_description || d.error}`);
  tokenCache.set(k, { token: d.access_token, exp: Date.now() + d.expires_in * 1000 });
  return d.access_token;
}

/**
 * GET with pacing and 429/5xx backoff. Drive's per-user quota is generous but
 * a 15-account sequential walk still trips it; Retry-After is honoured when
 * present, otherwise exponential with jitter.
 */
/**
 * Google signals read throttling with 403 `userRateLimitExceeded` /
 * `rateLimitExceeded`, NOT 429 — the same trap that turned a transient throttle
 * into 151 permanent failures during the ETG copy. A 403 is retried only when
 * its reason says throttling; permission refusals still fail immediately.
 */
const RETRYABLE_403 = new Set(['userRateLimitExceeded', 'rateLimitExceeded', 'quotaExceeded', 'backendError']);
let calls = 0, throttles = 0;
async function get(url, scope, sub, attempts = 8) {
  let delay = 2000;
  for (let i = 1; ; i++) {
    try {
      const tok = await token(scope, sub);
      const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(T) });
      calls += 1;
      let throttled403 = false;
      if (r.status === 403) {
        const body = await r.clone().json().catch(() => ({}));
        const reason = body?.error?.errors?.[0]?.reason ?? '';
        throttled403 = RETRYABLE_403.has(reason);
        if (throttled403) throttles += 1;
        else throw new Error(`403 ${body?.error?.message ?? ''} (reason: ${reason || 'none'})`);
      }
      if (throttled403 || r.status === 429 || (r.status >= 500 && r.status < 600)) {
        if (i >= attempts) throw new Error(`${r.status} after ${attempts} attempts`);
        const ra = Number(r.headers.get('retry-after') || 0) * 1000;
        const wait = ra || delay + Math.floor(Math.random() * 500);
        log(`    ⏳ ${r.status}, retry ${i}/${attempts - 1} in ${Math.round(wait / 1000)}s`);
        await sleep(wait); delay = Math.min(delay * 2, 64000);
        continue;
      }
      const d = await r.json();
      if (!r.ok) throw new Error(`${r.status} ${d.error?.message ?? ''}`);
      return d;
    } catch (err) {
      const transient = err.name === 'TimeoutError' || /fetch failed/i.test(err.message ?? '');
      if (!transient || i >= attempts) throw err;
      log(`    ⏳ ${err.name || err.message}, retry ${i}/${attempts - 1}`);
      await sleep(delay); delay = Math.min(delay * 2, 64000);
    }
  }
}

// ---------------------------------------------------------------- checkpoint
await fsp.mkdir(CKPT_DIR, { recursive: true });
const ckptPath = (id) => path.join(CKPT_DIR, `${id.replace(/[^a-zA-Z0-9._@-]/g, '_')}.jsonl`);
const doneMarker = (id) => path.join(CKPT_DIR, `${id.replace(/[^a-zA-Z0-9._@-]/g, '_')}.done`);
const isDone = async (id) => fsp.access(doneMarker(id)).then(() => true).catch(() => false);

// ---------------------------------------------------------------- fields
// Metadata only. No content field is ever requested.
const FILE_FIELDS = [
  'id', 'name', 'mimeType', 'size', 'createdTime', 'modifiedTime', 'parents',
  'owners(emailAddress,displayName)', 'lastModifyingUser(emailAddress,displayName)',
  'shared', 'trashed', 'driveId', 'webViewLink', 'quotaBytesUsed', 'permissionIds',
].join(',');
const PERM_FIELDS = 'permissions(id,type,emailAddress,domain,role,allowFileDiscovery)';

const GOOGLE_NATIVE = /^application\/vnd\.google-apps\./;
const NATIVE_LABEL = {
  'application/vnd.google-apps.document': 'Google Doc',
  'application/vnd.google-apps.spreadsheet': 'Google Sheet',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/vnd.google-apps.form': 'Google Form',
  'application/vnd.google-apps.drawing': 'Google Drawing',
  'application/vnd.google-apps.script': 'Apps Script',
  'application/vnd.google-apps.map': 'Google My Map',
  'application/vnd.google-apps.site': 'Google Site',
  'application/vnd.google-apps.shortcut': 'Shortcut',
  'application/vnd.google-apps.folder': 'Folder',
};

/** Walk one corpus (a user's My Drive, or one Shared Drive) and stream to a checkpoint. */
async function walkCorpus({ id, label, sub, driveId }) {
  if (await isDone(id)) {
    const text = await fsp.readFile(ckptPath(id), 'utf8').catch(() => '');
    const n = text.trim() ? text.trim().split('\n').length : 0;
    log(`  ${label}: already complete (${n} files) — skipping`);
    return;
  }
  await fsp.rm(ckptPath(id), { force: true });
  const stream = fs.createWriteStream(ckptPath(id), { flags: 'a' });

  const items = [];
  let pageToken = null, pages = 0;
  do {
    const params = new URLSearchParams({
      pageSize: '1000',
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (driveId) { params.set('corpora', 'drive'); params.set('driveId', driveId); params.set('q', 'trashed = false'); }
    else { params.set('corpora', 'user'); params.set('q', "'me' in owners and trashed = false"); }
    if (pageToken) params.set('pageToken', pageToken);
    const d = await get(`https://www.googleapis.com/drive/v3/files?${params}`, SCOPE_DRIVE, sub);
    items.push(...(d.files ?? []));
    pageToken = d.nextPageToken;
    if (++pages % 5 === 0) log(`    ${label}: ${items.length} items…`);
    await sleep(300);   // pace — 403 userRateLimitExceeded appears above ~8 pages/sec
  } while (pageToken);

  // Path reconstruction from parent IDs, locally — no extra API calls.
  const byId = new Map(items.map((f) => [f.id, f]));
  const pathCache = new Map();
  function pathOf(fid, depth = 0) {
    if (pathCache.has(fid)) return pathCache.get(fid);
    if (depth > 64) return '(cycle)';
    const f = byId.get(fid);
    if (!f) { pathCache.set(fid, null); return null; }   // parent outside this corpus
    const par = (f.parents ?? [])[0];
    const base = par ? pathOf(par, depth + 1) : '';
    const p = base === null ? null : (base ? `${base}/${f.name}` : f.name);
    pathCache.set(fid, p);
    return p;
  }

  /**
   * External sharing: only files flagged `shared` need a permissions read.
   *
   * Shared Drives are excluded from the per-file probe. Access there is
   * governed at the drive level — every file reports shared:true by virtue of
   * drive membership, so probing 76k files would cost hours and mostly restate
   * the drive's own member list, which is reported separately. Per-file sharing
   * is the meaningful question in a My Drive, where each file carries its own
   * ACL. Shared Drive rows therefore record shared_externally as unknown rather
   * than false, so the summary never implies a check that did not happen.
   */
  const shared = driveId ? [] : items.filter((f) => f.shared && f.mimeType !== 'application/vnd.google-apps.folder');
  log(`    ${label}: ${items.length} items, checking permissions on ${shared.length} shared`);
  const permsById = new Map();
  for (let i = 0; i < shared.length; i++) {
    const f = shared[i];
    try {
      const d = await get(
        `https://www.googleapis.com/drive/v3/files/${f.id}/permissions?fields=${encodeURIComponent(PERM_FIELDS)}&supportsAllDrives=true&pageSize=100`,
        SCOPE_DRIVE, sub);
      permsById.set(f.id, d.permissions ?? []);
    } catch (e) {
      permsById.set(f.id, [{ error: e.message.slice(0, 80) }]);
    }
    if (i % 200 === 199) { log(`      perms ${i + 1}/${shared.length}`); }
    await sleep(60);
  }

  for (const f of items) {
    const perms = permsById.get(f.id) ?? [];
    const ext = perms.filter((p) =>
      (p.type === 'anyone') ||
      (p.type === 'domain' && p.domain && p.domain !== DOMAIN) ||
      (p.emailAddress && !p.emailAddress.toLowerCase().endsWith(`@${DOMAIN}`)));
    const native = GOOGLE_NATIVE.test(f.mimeType ?? '');
    stream.write(JSON.stringify({
      corpus: label,
      corpus_kind: driveId ? 'shared_drive' : 'my_drive',
      owner: f.owners?.[0]?.emailAddress ?? (driveId ? `(shared drive: ${label})` : sub),
      path: pathOf(f.id) ?? `(unparented)/${f.name}`,
      name: f.name,
      mime_type: f.mimeType,
      type_label: NATIVE_LABEL[f.mimeType] ?? (native ? 'Google native (other)' : 'binary'),
      is_google_native: native,
      is_folder: f.mimeType === 'application/vnd.google-apps.folder',
      size: Number(f.size ?? 0),
      quota_bytes_used: Number(f.quotaBytesUsed ?? 0),
      created_time: f.createdTime ?? '',
      modified_time: f.modifiedTime ?? '',
      last_modifying_user: f.lastModifyingUser?.emailAddress ?? '',
      shared: Boolean(f.shared),
      // null (not false) for Shared Drives: not probed, so not knowable here.
      shared_externally: driveId ? '' : (ext.length > 0),
      external_detail: ext.map((p) => p.type === 'anyone' ? `anyone(${p.role}${p.allowFileDiscovery === false ? ',link' : ''})` : (p.emailAddress || `domain:${p.domain}`)).join('; '),
      orphaned: !(f.parents ?? []).length,
      drive_id: f.driveId ?? '',
      file_id: f.id,
      web_view_link: f.webViewLink ?? '',
    }) + '\n');
  }
  await new Promise((res) => stream.end(res));
  await fsp.writeFile(doneMarker(id), new Date().toISOString());
  log(`  ${label}: ${items.length} files recorded`);
}

// ---------------------------------------------------------------- Step 2
log('=== Shared Drives ===');
const drives = [];
{
  let pageToken = null;
  do {
    const params = new URLSearchParams({ pageSize: '100', useDomainAdminAccess: 'true', fields: 'nextPageToken,drives(id,name,createdTime)' });
    if (pageToken) params.set('pageToken', pageToken);
    const d = await get(`https://www.googleapis.com/drive/v3/drives?${params}`, SCOPE_DRIVE, SUB);
    drives.push(...(d.drives ?? []));
    pageToken = d.nextPageToken;
  } while (pageToken);
}
for (const dr of drives) {
  try {
    const p = await get(`https://www.googleapis.com/drive/v3/permissions?fileId=${dr.id}&supportsAllDrives=true&useDomainAdminAccess=true&fields=permissions(id,type,emailAddress,role)&pageSize=100`, SCOPE_DRIVE, SUB);
    dr.members = (p.permissions ?? []).length;
    dr.memberList = (p.permissions ?? []).map((x) => `${x.emailAddress ?? x.type}:${x.role}`);
  } catch (e) { dr.members = null; dr.memberError = e.message.slice(0, 80); }
  log(`  ${dr.name} (${dr.id}) — ${dr.members ?? '?'} members`);
}

// ---------------------------------------------------------------- Step 3
log('=== Users ===');
const users = [];
{
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      customer: 'my_customer', maxResults: '500', showDeleted: 'false',
      fields: 'nextPageToken,users(primaryEmail,name/fullName,suspended,archived,isAdmin,creationTime,lastLoginTime,orgUnitPath)',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const d = await get(`https://admin.googleapis.com/admin/directory/v1/users?${params}`, SCOPE_DIR, SUB);
    users.push(...(d.users ?? []));
    pageToken = d.nextPageToken;
  } while (pageToken);
}
log(`  ${users.length} users — ${users.filter((u) => !u.suspended && !u.archived).length} active, ${users.filter((u) => u.suspended).length} suspended, ${users.filter((u) => u.archived).length} archived`);

// ---------------------------------------------------------------- Steps 2+4 walks
const started = Date.now();
for (const dr of drives) {
  log(`--- shared drive: ${dr.name}`);
  await walkCorpus({ id: `drive_${dr.id}`, label: dr.name, sub: SUB, driveId: dr.id });
}
let n = 0;
for (const u of users) {
  n += 1;
  const el = Math.round((Date.now() - started) / 1000);
  log(`--- [${n}/${users.length}] my drive: ${u.primaryEmail} (${Math.floor(el / 60)}m${String(el % 60).padStart(2, '0')}s elapsed, ${calls} API calls)`);
  if (u.suspended || u.archived) { log('    suspended/archived — attempting anyway'); }
  try {
    await walkCorpus({ id: `user_${u.primaryEmail}`, label: u.primaryEmail, sub: u.primaryEmail, driveId: null });
  } catch (e) {
    log(`    FAILED: ${e.message.slice(0, 140)}`);
    await fsp.writeFile(path.join(CKPT_DIR, `${u.primaryEmail}.error`), e.message);
  }
}

// ---------------------------------------------------------------- Step 6: CSV
const HEADERS = ['corpus','corpus_kind','owner','path','name','mime_type','type_label','is_google_native','is_folder','size','quota_bytes_used','created_time','modified_time','last_modifying_user','shared','shared_externally','external_detail','orphaned','drive_id','file_id','web_view_link'];
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
await fsp.mkdir('dist/inventory', { recursive: true });
const out = fs.createWriteStream(CSV_OUT);
out.write(HEADERS.join(',') + '\n');
let rows = 0;
for (const f of await fsp.readdir(CKPT_DIR)) {
  if (!f.endsWith('.jsonl')) continue;
  const text = await fsp.readFile(path.join(CKPT_DIR, f), 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    out.write(HEADERS.map((h) => esc(r[h])).join(',') + '\n');
    rows += 1;
  }
}
await new Promise((res) => out.end(res));
log(`wrote ${CSV_OUT} (${rows} rows)`);

console.log(JSON.stringify({
  shared_drives: drives.map((d) => ({ id: d.id, name: d.name, members: d.members, memberList: d.memberList })),
  users: users.map((u) => ({ email: u.primaryEmail, name: u.name?.fullName, suspended: !!u.suspended, archived: !!u.archived, isAdmin: !!u.isAdmin, lastLogin: u.lastLoginTime })),
  rows, api_calls: calls, csv: CSV_OUT,
}, null, 2));
