/**
 * gdrive-org-inventory.mjs — READ-ONLY metadata inventory of the organization's
 * Google Drive: every Shared Drive and every user's My Drive, with full paths.
 *
 * Establishes what exists in Drive before the Dropbox migration is folded in.
 * This pass OBSERVES ONLY. It proposes no destinations and classifies nothing.
 *
 * Guarantees:
 *   - Every Drive/Admin call is a GET. The only POST is the OAuth token grant,
 *     which is the sole way to authenticate.
 *   - No file CONTENT is ever fetched: no alt=media, no files.export, no
 *     download of any kind. get() refuses such URLs. Metadata fields only.
 *   - Nothing is moved, copied, renamed, deleted, or re-shared. No permission
 *     is modified — permissions are read to classify sharing.
 *   - Checkpointed per phase and per corpus: an interrupted run resumes.
 *   - The existing CSV is copied to a dated backup before it is replaced, and
 *     an existing backup is never overwritten.
 *
 * Paths. files.list never returns a My Drive's root folder, so a chain that
 * climbs to the root used to miss and fall back to "(unparented)" — for 92% of
 * My Drive rows and every Shared Drive row. The root ID is now fetched per
 * user (files/root) and seeded; a Shared Drive's root is its drive ID.
 * Ancestors outside every walked corpus (folders owned by outside accounts or
 * the service account) are fetched by ID. "(unparented)" is reserved for
 * chains that end at an item no walked account sees a parent for.
 *
 * Phases:
 *   1. Shared Drives (with member permission IDs) and users.
 *   2. Walk each corpus: root ID plus every non-trashed item it owns.
 *   3. Per user, the items they can see but do NOT own — finds outside-owned
 *      files inside their folders, and parents the owner cannot see.
 *   4. Fetch missing ancestors, then resolve every path.
 *   5. Resolve shortcut targets.
 *   6. Shared Drive sharing: classify permission IDs beyond drive membership.
 *   7. Write the CSV.
 *
 * Access requirements (see docs/inventory/gdrive-org-rewalk.md):
 *   domain-wide delegation for the service account, impersonating a super
 *   admin via GOOGLE_IMPERSONATE, with scopes
 *     https://www.googleapis.com/auth/drive.readonly
 *     https://www.googleapis.com/auth/admin.directory.user.readonly
 *
 * Usage:
 *   GOOGLE_IMPERSONATE=<super admin> GDRIVE_CKPT_DIR=<dir> node scripts/gdrive-org-inventory.mjs
 *   Rerunning with the same GDRIVE_CKPT_DIR resumes from completed phases.
 *   --preview writes the CSV into GDRIVE_CKPT_DIR instead of replacing CSV_OUT.
 */
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import 'dotenv/config';

process.chdir('/Users/Chris/grant-card-assistant');
const CSV_OUT = 'dist/inventory/gdrive-org-inventory.csv';
const CKPT_DIR = process.env.GDRIVE_CKPT_DIR || path.join(os.tmpdir(), 'gdrive-org-ckpt');
const PREVIEW = process.argv.includes('--preview');
const DOMAIN = process.env.GDRIVE_ORG_DOMAIN || 'granted.ca';
const SUB = process.env.GOOGLE_IMPERSONATE;
const API = 'https://www.googleapis.com/drive/v3';
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
const SA = KEY.client_email.toLowerCase();

await fsp.mkdir(CKPT_DIR, { recursive: true });
const CALLS_PATH = path.join(CKPT_DIR, 'api-calls.json');
const apiCalls = JSON.parse(await fsp.readFile(CALLS_PATH, 'utf8').catch(() => '{}'));
const tally = (k) => { apiCalls[k] = (apiCalls[k] ?? 0) + 1; };
const saveCalls = () => fsp.writeFile(CALLS_PATH, JSON.stringify(apiCalls, null, 2));

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
  tally('POST oauth2.googleapis.com/token (token grant)');
  const d = await r.json();
  if (!r.ok) throw new Error(`token(${sub}): ${d.error_description || d.error}`);
  tokenCache.set(k, { token: d.access_token, exp: Date.now() + d.expires_in * 1000 });
  return d.access_token;
}

/** Endpoint label for the call tally, with IDs collapsed. */
function endpoint(url) {
  const u = new URL(url);
  const p = u.pathname
    .replace(/\/files\/(?!root$)[^/]+/, '/files/{id}')
    .replace(/\/permissions\/[^/]+$/, '/permissions/{id}');
  return `GET ${u.host}${p}`;
}

/**
 * Google signals read throttling with 403 `userRateLimitExceeded` /
 * `rateLimitExceeded`, NOT 429 — the same trap that turned a transient throttle
 * into 151 permanent failures during the ETG copy. A 403 is retried only when
 * its reason says throttling. With `allowMissing`, a 404 or a permission
 * refusal comes back as `{ __missing }` instead of throwing.
 */
const RETRYABLE_403 = new Set(['userRateLimitExceeded', 'rateLimitExceeded', 'quotaExceeded', 'backendError']);
let throttles = 0;
async function get(url, scope, sub, { allowMissing = false, attempts = 8 } = {}) {
  if (/[?&]alt=media|\/export(\?|$)|\/download/.test(url)) throw new Error(`refusing content URL: ${url}`);
  let delay = 2000;
  for (let i = 1; ; i++) {
    try {
      const tok = await token(scope, sub);
      const r = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(T) });
      tally(endpoint(url));
      let throttled403 = false;
      if (r.status === 403) {
        const body = await r.clone().json().catch(() => ({}));
        const reason = body?.error?.errors?.[0]?.reason ?? '';
        throttled403 = RETRYABLE_403.has(reason);
        if (throttled403) throttles += 1;
        else if (allowMissing) return { __missing: `403 ${reason || 'forbidden'}` };
        else throw new Error(`403 ${body?.error?.message ?? ''} (reason: ${reason || 'none'})`);
      }
      if (r.status === 404 && allowMissing) return { __missing: '404 notFound' };
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

/** Page through files.list, streaming each page to `onPage`. */
async function listAll(params, sub, onPage, label) {
  let pageToken = null, pages = 0, n = 0;
  do {
    const p = new URLSearchParams(params);
    if (pageToken) p.set('pageToken', pageToken);
    const d = await get(`${API}/files?${p}`, SCOPE_DRIVE, sub);
    await onPage(d.files ?? []);
    n += (d.files ?? []).length;
    pageToken = d.nextPageToken;
    if (++pages % 20 === 0) { log(`    ${label}: ${n} items…`); await saveCalls(); }
    await sleep(250);   // pace — 403 userRateLimitExceeded appears above ~8 pages/sec
  } while (pageToken);
  return n;
}

// ---------------------------------------------------------------- checkpoint
const safe = (s) => s.replace(/[^a-zA-Z0-9._@-]/g, '_');
const ckpt = (name) => path.join(CKPT_DIR, safe(name));
const exists = (p) => fsp.access(p).then(() => true).catch(() => false);
async function readJsonl(p) {
  const out = [];
  const text = await fsp.readFile(p, 'utf8');
  for (const line of text.split('\n')) if (line.trim()) out.push(JSON.parse(line));
  return out;
}

// ---------------------------------------------------------------- fields
// Metadata only. No content field is ever requested.
const BASE_FIELDS = [
  'id', 'name', 'mimeType', 'size', 'quotaBytesUsed', 'createdTime', 'modifiedTime', 'parents',
  'owners(emailAddress)', 'lastModifyingUser(emailAddress)', 'shared', 'driveId', 'webViewLink',
  'shortcutDetails(targetId,targetMimeType)',
].join(',');
const PERM = 'id,type,emailAddress,domain,role,allowFileDiscovery,deleted';
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
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
const ownerOf = (f) => (f.owners?.[0]?.emailAddress ?? '').toLowerCase();

// ---------------------------------------------------------------- Phase 1
log('=== Phase 1: Shared Drives and users ===');
const drives = [];
{
  let pageToken = null;
  do {
    const params = new URLSearchParams({ pageSize: '100', useDomainAdminAccess: 'true', fields: 'nextPageToken,drives(id,name,createdTime)' });
    if (pageToken) params.set('pageToken', pageToken);
    const d = await get(`${API}/drives?${params}`, SCOPE_DRIVE, SUB);
    drives.push(...(d.drives ?? []));
    pageToken = d.nextPageToken;
  } while (pageToken);
}
for (const dr of drives) {
  const p = await get(`${API}/files/${dr.id}/permissions?supportsAllDrives=true&useDomainAdminAccess=true&fields=permissions(${PERM})&pageSize=100`, SCOPE_DRIVE, SUB);
  dr.memberPerms = p.permissions ?? [];
  log(`  ${dr.name} (${dr.id}) — ${dr.memberPerms.length} members`);
}
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
const WALKED = new Set(users.map((u) => u.primaryEmail.toLowerCase()));
log(`  ${users.length} users — ${users.filter((u) => !u.suspended && !u.archived).length} active`);
await saveCalls();

// ---------------------------------------------------------------- Phase 2
log('=== Phase 2: walk every corpus ===');
async function walkCorpus({ key, label, sub, driveId }) {
  const done = ckpt(`items_${key}.done`), file = ckpt(`items_${key}.jsonl`);
  if (await exists(done)) { log(`  ${label}: already walked — skipping`); return; }
  const rootId = driveId ?? (await get(`${API}/files/root?fields=id`, SCOPE_DRIVE, sub)).id;
  const out = fs.createWriteStream(file);
  out.write(JSON.stringify({ meta: { key, label, sub, driveId: driveId ?? null, rootId } }) + '\n');
  const params = driveId
    ? { corpora: 'drive', driveId, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true',
        q: 'trashed = false', pageSize: '1000', fields: `nextPageToken,files(${BASE_FIELDS},permissionIds)` }
    : { corpora: 'user', q: "'me' in owners and trashed = false", pageSize: '100',
        fields: `nextPageToken,files(${BASE_FIELDS},permissions(${PERM}))` };
  const pending = [];
  const n = await listAll(params, sub, async (files) => {
    for (const f of files) {
      // Owners can always read permissions on their own My Drive files, so this
      // fallback should not fire; it exists so a missing field is never read as "private".
      if (!driveId && f.shared && !f.permissions) pending.push(f);
      else out.write(JSON.stringify(f) + '\n');
    }
  }, label);
  for (const f of pending) {
    const d = await get(`${API}/files/${f.id}/permissions?fields=permissions(${PERM})&pageSize=100`, SCOPE_DRIVE, sub);
    f.permissions = d.permissions ?? [];
    out.write(JSON.stringify(f) + '\n');
    await sleep(60);
  }
  await new Promise((res) => out.end(res));
  await fsp.writeFile(done, new Date().toISOString());
  log(`  ${label}: ${n} items (root ${rootId}), ${pending.length} permission fallbacks`);
}
for (const dr of drives) await walkCorpus({ key: `drive_${dr.id}`, label: dr.name, sub: SUB, driveId: dr.id });
for (const u of users) {
  try {
    await walkCorpus({ key: `user_${u.primaryEmail}`, label: u.primaryEmail, sub: u.primaryEmail, driveId: null });
  } catch (e) {
    log(`    FAILED ${u.primaryEmail}: ${e.message.slice(0, 140)}`);
    throw e;
  }
}
await saveCalls();

// ---------------------------------------------------------------- Phase 3
log('=== Phase 3: items each user can see but does not own ===');
for (const u of users) {
  const email = u.primaryEmail;
  const done = ckpt(`notowned_${email}.done`), file = ckpt(`notowned_${email}.jsonl`);
  if (await exists(done)) { log(`  ${email}: already listed — skipping`); continue; }
  const out = fs.createWriteStream(file);
  let kept = 0;
  const n = await listAll({
    corpora: 'user', q: "not 'me' in owners and trashed = false", pageSize: '1000',
    fields: `nextPageToken,files(${BASE_FIELDS})`,
  }, email, async (files) => {
    for (const f of files) {
      if (f.driveId || !(f.parents ?? []).length) continue;   // loose "shared with me" can't sit in a tree
      out.write(JSON.stringify(f) + '\n'); kept += 1;
    }
  }, `${email} (not owned)`);
  await new Promise((res) => out.end(res));
  await fsp.writeFile(done, new Date().toISOString());
  log(`  ${email}: ${n} visible-not-owned, ${kept} with a visible parent`);
}
await saveCalls();

// ---------------------------------------------------------------- load
log('=== Loading checkpoints ===');
const corpora = [];                     // {meta, items}
for (const dr of drives) corpora.push(await readJsonl(ckpt(`items_drive_${dr.id}.jsonl`)));
for (const u of users) corpora.push(await readJsonl(ckpt(`items_user_${u.primaryEmail}.jsonl`)));
const ROOTS = new Map();                // rootId -> {kind: 'user'|'drive', host, label}
const OWNED = new Map();                // id -> {f, meta}
for (const c of corpora) {
  const { meta } = c[0];
  ROOTS.set(meta.rootId, meta.driveId
    ? { kind: 'drive', host: meta.label, label: meta.label }
    : { kind: 'user', host: meta.label.toLowerCase(), label: 'My Drive' });
  for (let i = 1; i < c.length; i++) OWNED.set(c[i].id, { f: c[i], meta });
}
const VIEWS = new Map();                // id -> {f, viewer} — non-owner views with a visible parent
for (const u of users) {
  for (const f of await readJsonl(ckpt(`notowned_${u.primaryEmail}.jsonl`))) {
    if (!VIEWS.has(f.id)) VIEWS.set(f.id, { f, viewer: u.primaryEmail });
  }
}
log(`  ${OWNED.size} owned/drive items, ${VIEWS.size} non-owner views, ${ROOTS.size} roots`);

/** Parent as the best-placed account sees it: the owner first, then any other walked user. */
function parentOf(id) {
  const o = OWNED.get(id);
  const p = o?.f.parents?.[0];
  if (p) return { parent: p, viewer: o.meta.sub, via: 'owner' };
  const v = VIEWS.get(id);
  if (v?.f.parents?.[0]) return { parent: v.f.parents[0], viewer: v.viewer, via: 'other_user' };
  return { parent: null, viewer: o?.meta.sub ?? v?.viewer ?? SUB, via: 'none' };
}

// ---------------------------------------------------------------- Phase 4
log('=== Phase 4: fetch missing ancestors, resolve paths ===');
const FETCHED_PATH = ckpt('ancestors.json');
const FETCHED = new Map(Object.entries(JSON.parse(await fsp.readFile(FETCHED_PATH, 'utf8').catch(() => '{}'))));
const known = (id) => ROOTS.has(id) || OWNED.has(id) || VIEWS.has(id) || FETCHED.has(id);
{
  let queue = new Map();                 // id -> viewer
  const consider = (id) => {
    const { parent, viewer } = parentOf(id);
    if (parent && !known(parent)) queue.set(parent, viewer);
  };
  for (const id of OWNED.keys()) consider(id);
  for (const id of VIEWS.keys()) consider(id);
  let fetched = 0;
  while (queue.size) {
    const next = new Map();
    for (const [id, viewer] of queue) {
      if (known(id)) continue;
      const fields = 'id,name,mimeType,parents,owners(emailAddress),driveId,trashed';
      let d = await get(`${API}/files/${id}?fields=${fields}&supportsAllDrives=true`, SCOPE_DRIVE, viewer, { allowMissing: true });
      if (d.__missing && viewer !== SUB) {
        d = await get(`${API}/files/${id}?fields=${fields}&supportsAllDrives=true`, SCOPE_DRIVE, SUB, { allowMissing: true });
      }
      FETCHED.set(id, { ...d, viewer });
      fetched += 1;
      const p = d.parents?.[0];
      if (p && !known(p)) next.set(p, viewer);
      if (fetched % 200 === 0) {
        log(`    ancestors fetched: ${fetched}`);
        await fsp.writeFile(FETCHED_PATH, JSON.stringify(Object.fromEntries(FETCHED)));
        await saveCalls();
      }
      await sleep(60);
    }
    queue = next;
  }
  await fsp.writeFile(FETCHED_PATH, JSON.stringify(Object.fromEntries(FETCHED)));
  log(`  ${fetched} ancestors fetched this run, ${FETCHED.size} total`);
}

const nameOf = (id) => OWNED.get(id)?.f.name ?? VIEWS.get(id)?.f.name ?? FETCHED.get(id)?.name ?? '?';
function nodeOwner(id) {
  const o = OWNED.get(id);
  if (o) return o.meta.driveId ? '' : ownerOf(o.f);
  return ownerOf(VIEWS.get(id)?.f ?? FETCHED.get(id) ?? {});
}
function nodeParent(id) {
  const pv = parentOf(id);
  if (pv.parent) return pv;
  const x = FETCHED.get(id);
  if (x?.parents?.[0]) return { parent: x.parents[0], viewer: x.viewer, via: 'fetched' };
  return pv;
}

/**
 * Chain above a folder: its names from the root down (inclusive), the top of
 * the chain, and every owner along the way. Memoised; depth-guarded.
 */
const chainMemo = new Map();
function chain(fid, depth = 0) {
  if (chainMemo.has(fid)) return chainMemo.get(fid);
  if (depth > 100) return { segs: ['(cycle)'], top: { kind: 'not_visible', host: '', label: '(cycle)' }, owners: [] };
  let res;
  const fx = FETCHED.get(fid);
  if (fx?.__missing && !OWNED.has(fid) && !VIEWS.has(fid)) {
    res = { segs: [], top: { kind: 'not_visible', host: '', label: '(parent not visible)' }, owners: [] };
  } else {
    const own = nodeOwner(fid);
    const { parent } = nodeParent(fid);
    let base;
    if (!parent) {
      base = OWNED.has(fid) && !OWNED.get(fid).meta.driveId
        ? { segs: [], top: { kind: 'orphaned', host: '(orphaned)', label: '(unparented)' }, owners: [] }
        : { segs: [], top: { kind: 'hidden_parent', host: own, label: `(folder owned by ${own || 'unknown'}; parent not visible)` }, owners: [] };
    } else if (ROOTS.has(parent)) {
      const r = ROOTS.get(parent);
      base = { segs: [], top: r, owners: [] };
    } else {
      base = chain(parent, depth + 1);
    }
    res = { segs: [...base.segs, nameOf(fid)], top: base.top, owners: [...new Set([...base.owners, own])] };
  }
  chainMemo.set(fid, res);
  return res;
}

const isInternal = (e) => e.endsWith(`@${DOMAIN}`);
function placement(id, itemOwner, isDriveItem) {
  const { parent, via } = nodeParent(id);
  let segs = [], top, owners = [];
  if (!parent) {
    top = { kind: 'orphaned', host: '(orphaned)', label: '(unparented)' };
  } else if (ROOTS.has(parent)) {
    top = ROOTS.get(parent);
  } else {
    ({ segs, top, owners } = chain(parent));
  }
  let rootLabel = top.label, hostKind;
  if (top.kind === 'drive') hostKind = 'shared_drive';
  else if (top.kind === 'user') {
    hostKind = top.host === itemOwner ? 'own' : 'other_user';
    if (hostKind === 'other_user') rootLabel = `My Drive (${top.host})`;
  } else if (top.kind === 'orphaned') hostKind = parent ? 'under_orphaned_folder' : 'orphaned';
  else hostKind = top.kind === 'hidden_parent'
    ? (isInternal(top.host) ? 'internal_folder_parent_hidden' : 'external_folder_parent_hidden')
    : top.kind;
  const foreign = isDriveItem ? [] : owners.filter((o) => o && o !== itemOwner);
  return {
    path: [rootLabel, ...segs].join('/'),
    depth: segs.length,
    host: top.host,
    hostKind,
    foreign,
    externalAncestor: foreign.some((o) => !isInternal(o) && o !== SA),
    parentVia: via,
  };
}

// ---------------------------------------------------------------- sharing
function classify(perms) {
  const ps = perms.filter((p) => p.role !== 'owner');
  const anyone = ps.filter((p) => p.type === 'anyone');
  const ext = ps.filter((p) => (p.type === 'domain' && p.domain && p.domain !== DOMAIN)
    || (p.emailAddress && !isInternal(p.emailAddress.toLowerCase()) && p.emailAddress.toLowerCase() !== SA));
  const dom = ps.filter((p) => p.type === 'domain' && p.domain === DOMAIN);
  const internal = ps.filter((p) => p.emailAddress && isInternal(p.emailAddress.toLowerCase()));
  const sa = ps.some((p) => (p.emailAddress ?? '').toLowerCase() === SA);
  const state = anyone.length ? (anyone.some((p) => p.allowFileDiscovery) ? 'public' : 'anyone_with_link')
    : ext.length ? 'external' : dom.length ? 'domain' : internal.length ? 'internal' : 'private';
  return {
    state,
    external: anyone.length + ext.length > 0,
    externalDetail: [
      ...anyone.map((p) => `anyone(${p.role ?? '?'}${p.allowFileDiscovery === false ? ',link' : ''})`),
      ...ext.map((p) => p.emailAddress || `domain:${p.domain}`),
    ].join('; '),
    internalDetail: [...dom.map((p) => `domain:${p.domain}(${p.role ?? '?'})`), ...internal.map((p) => p.emailAddress.toLowerCase())].join('; '),
    sa,
  };
}

// ---------------------------------------------------------------- Phase 5
log('=== Phase 5: shortcut targets ===');
const TARGETS_PATH = ckpt('shortcut-targets.json');
const TARGETS = JSON.parse(await fsp.readFile(TARGETS_PATH, 'utf8').catch(() => '{}'));   // targetId -> meta | {__missing}
{
  const need = new Map();
  const shortcuts = [...OWNED.values()].filter(({ f }) => f.mimeType === SHORTCUT);
  for (const { f, meta } of shortcuts) {
    const t = f.shortcutDetails?.targetId;
    if (t && !OWNED.has(t) && !VIEWS.has(t) && !(t in TARGETS)) need.set(t, meta.sub);
  }
  log(`  ${shortcuts.length} shortcuts, ${need.size} targets outside the inventory to look up`);
  let i = 0;
  for (const [t, viewer] of need) {
    const fields = 'id,mimeType,owners(emailAddress),driveId,trashed';
    let d = await get(`${API}/files/${t}?fields=${fields}&supportsAllDrives=true`, SCOPE_DRIVE, viewer, { allowMissing: true });
    if (d.__missing && viewer !== SUB) {
      d = await get(`${API}/files/${t}?fields=${fields}&supportsAllDrives=true`, SCOPE_DRIVE, SUB, { allowMissing: true });
    }
    TARGETS[t] = d;
    if (++i % 200 === 0) { log(`    targets: ${i}/${need.size}`); await fsp.writeFile(TARGETS_PATH, JSON.stringify(TARGETS)); await saveCalls(); }
    await sleep(60);
  }
  await fsp.writeFile(TARGETS_PATH, JSON.stringify(TARGETS));
}
function shortcutKind(f, shortcutOwner, isDriveItem) {
  const t = f.shortcutDetails?.targetId;
  if (!t) return 'no_target';
  const o = OWNED.get(t);
  let driveId, owner;
  if (o) { driveId = o.meta.driveId; owner = o.meta.driveId ? '' : ownerOf(o.f); }
  else if (VIEWS.has(t)) { owner = ownerOf(VIEWS.get(t).f); }
  else {
    const x = TARGETS[t];
    if (!x || x.__missing) return 'broken_or_no_access';
    if (x.trashed) return 'broken_trashed';
    driveId = x.driveId; owner = ownerOf(x);
  }
  if (driveId) return 'shared_drive';
  if (!isDriveItem && owner === shortcutOwner) return 'own_drive';
  if (WALKED.has(owner)) return 'other_user_drive';
  if (owner && isInternal(owner)) return 'other_internal_account';
  return 'external_owner';
}

// ---------------------------------------------------------------- Phase 6
log('=== Phase 6: Shared Drive permission IDs beyond membership ===');
const DRIVE_PERMS_PATH = ckpt('drive-extra-perms.json');
const DRIVE_PERMS = JSON.parse(await fsp.readFile(DRIVE_PERMS_PATH, 'utf8').catch(() => '{}'));   // `${driveId}|${permId}` -> perm
{
  const memberIds = new Map(drives.map((d) => [d.id, new Set(d.memberPerms.map((p) => p.id))]));
  const sample = new Map();
  for (const { f, meta } of OWNED.values()) {
    if (!meta.driveId) continue;
    for (const pid of f.permissionIds ?? []) {
      if (memberIds.get(meta.driveId).has(pid)) continue;
      const k = `${meta.driveId}|${pid}`;
      if (!sample.has(k) && !DRIVE_PERMS[k]) sample.set(k, f.id);
    }
  }
  log(`  ${sample.size} distinct permission IDs to identify`);
  for (const [k, fileId] of sample) {
    const pid = k.split('|')[1];
    const d = await get(`${API}/files/${fileId}/permissions/${pid}?supportsAllDrives=true&fields=${PERM}`, SCOPE_DRIVE, SUB, { allowMissing: true });
    DRIVE_PERMS[k] = d;
    await sleep(60);
  }
  await fsp.writeFile(DRIVE_PERMS_PATH, JSON.stringify(DRIVE_PERMS));
}

// ---------------------------------------------------------------- Phase 7
log('=== Phase 7: rows and CSV ===');
const HEADERS = [
  'corpus', 'corpus_kind', 'row_kind', 'owner', 'host', 'host_kind', 'path', 'depth', 'name',
  'mime_type', 'type_label', 'is_google_native', 'is_folder', 'size', 'quota_bytes_used',
  'created_time', 'modified_time', 'last_modifying_user', 'shared', 'sharing_state',
  'shared_externally', 'external_detail', 'internal_detail', 'service_account_access',
  'foreign_ancestor_owners', 'external_ancestor', 'orphaned', 'parent_seen_by',
  'shortcut_target_id', 'shortcut_target_kind', 'drive_id', 'file_id', 'web_view_link',
];
const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function row(f, { corpus, corpusKind, rowKind, owner, isDriveItem, sharing }) {
  const pl = placement(f.id, owner, isDriveItem);
  const native = GOOGLE_NATIVE.test(f.mimeType ?? '');
  const isShortcut = f.mimeType === SHORTCUT;
  return {
    corpus, corpus_kind: corpusKind, row_kind: rowKind, owner,
    host: pl.host, host_kind: pl.hostKind,
    path: `${pl.path}/${f.name}`, depth: pl.depth, name: f.name,
    mime_type: f.mimeType, type_label: NATIVE_LABEL[f.mimeType] ?? (native ? 'Google native (other)' : 'binary'),
    is_google_native: native, is_folder: f.mimeType === FOLDER,
    size: Number(f.size ?? 0), quota_bytes_used: Number(f.quotaBytesUsed ?? 0),
    created_time: f.createdTime ?? '', modified_time: f.modifiedTime ?? '',
    last_modifying_user: f.lastModifyingUser?.emailAddress ?? '',
    shared: Boolean(f.shared),
    sharing_state: sharing?.state ?? '',
    shared_externally: sharing ? sharing.external : '',
    external_detail: sharing?.externalDetail ?? '',
    internal_detail: sharing?.internalDetail ?? '',
    service_account_access: sharing ? sharing.sa : '',
    foreign_ancestor_owners: pl.foreign.join('; '),
    external_ancestor: pl.externalAncestor,
    orphaned: pl.hostKind === 'orphaned',   // no walked account sees any parent for this item itself
    parent_seen_by: pl.parentVia,
    shortcut_target_id: isShortcut ? (f.shortcutDetails?.targetId ?? '') : '',
    shortcut_target_kind: isShortcut ? shortcutKind(f, owner, isDriveItem) : '',
    drive_id: f.driveId ?? '', file_id: f.id, web_view_link: f.webViewLink ?? '',
  };
}

const rows = [];
const driveMembers = new Map(drives.map((d) => [d.id, new Set(d.memberPerms.map((p) => p.id))]));
for (const { f, meta } of OWNED.values()) {
  if (meta.driveId) {
    const extra = (f.permissionIds ?? []).filter((pid) => !driveMembers.get(meta.driveId).has(pid));
    const perms = extra.map((pid) => DRIVE_PERMS[`${meta.driveId}|${pid}`]).filter((p) => p && !p.__missing);
    const c = classify(perms);
    if (c.state === 'private') c.state = 'drive_members';
    rows.push(row(f, { corpus: meta.label, corpusKind: 'shared_drive', rowKind: 'shared_drive',
      owner: `(shared drive: ${meta.label})`, isDriveItem: true, sharing: c }));
  } else {
    rows.push(row(f, { corpus: meta.label, corpusKind: 'my_drive', rowKind: 'owned',
      owner: ownerOf(f) || meta.label, isDriveItem: false, sharing: classify(f.permissions ?? []) }));
  }
}
// Items inside a walked user's tree whose owner is not walked (outside accounts,
// the service account) appear in no corpus above. Their permissions are not
// readable by a non-owner, so sharing is left blank rather than guessed.
let foreignRows = 0;
for (const [id, { f }] of VIEWS) {
  if (OWNED.has(id)) continue;
  const owner = ownerOf(f);
  const pl = placement(id, owner, false);
  if (pl.hostKind !== 'other_user') continue;      // not inside any walked user's My Drive
  rows.push(row(f, { corpus: pl.host, corpusKind: 'my_drive', rowKind: 'nonowned_in_tree', owner, isDriveItem: false, sharing: null }));
  foreignRows += 1;
}
log(`  ${rows.length} rows (${foreignRows} non-owned items inside walked trees)`);

// Back up the existing CSV (dated) before replacing it; never overwrite a backup.
const target = PREVIEW ? path.join(CKPT_DIR, 'preview.csv') : CSV_OUT;
if (!PREVIEW && await exists(CSV_OUT)) {
  const stamp = new Date().toISOString().slice(0, 10);
  const backup = CSV_OUT.replace(/\.csv$/, `.${stamp}.pre-rewalk.csv`);
  if (await exists(backup)) log(`  backup ${backup} already exists — left untouched`);
  else { await fsp.copyFile(CSV_OUT, backup, fs.constants.COPYFILE_EXCL); log(`  backed up ${CSV_OUT} → ${backup}`); }
}
const tmp = `${target}.tmp`;
const out = fs.createWriteStream(tmp);
out.write(HEADERS.join(',') + '\n');
for (const r of rows) out.write(HEADERS.map((h) => esc(r[h])).join(',') + '\n');
await new Promise((res) => out.end(res));
await fsp.rename(tmp, target);
await saveCalls();
log(`wrote ${target} (${rows.length} rows)`);

console.log(JSON.stringify({
  shared_drives: drives.map((d) => ({ id: d.id, name: d.name, members: d.memberPerms.map((p) => `${p.emailAddress || p.type}:${p.role}`) })),
  users: users.map((u) => ({ email: u.primaryEmail, suspended: !!u.suspended, archived: !!u.archived, isAdmin: !!u.isAdmin })),
  rows: rows.length, nonowned_in_tree_rows: foreignRows, ancestors_fetched: FETCHED.size,
  shortcut_targets_looked_up: Object.keys(TARGETS).length, drive_extra_perm_ids: Object.keys(DRIVE_PERMS).length,
  throttles, api_calls: apiCalls, csv: target,
}, null, 2));
