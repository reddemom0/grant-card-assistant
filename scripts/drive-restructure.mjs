/**
 * drive-restructure.mjs — move existing client folders under a Clients/ root
 * on the Shared Drive, and create Live Clients/ shortcuts for active clients.
 *
 * DRIVE-SIDE ONLY. Nothing is downloaded, re-copied, or fetched from Dropbox —
 * there is no Dropbox code path in this file at all. Moves are metadata-only
 * (files.update with addParents/removeParents), so no bytes transfer and the
 * folder's contents and internal structure are untouched.
 *
 * NOTHING IS EVER DELETED. The only methods used are:
 *   GET    /drive/v3/files            (list)
 *   GET    /drive/v3/files/{id}       (read back / verify)
 *   POST   /drive/v3/files            (create Clients/, Live Clients/, shortcuts)
 *   PATCH  /drive/v3/files/{id}       (move: addParents + removeParents)
 * No DELETE, no trash, no files.emptyTrash. The service account does not even
 * hold the capability — the Shared Drive reports canDeleteChildren: false.
 *
 * Resumable: every action appends to dist/inventory/restructure-ledger.jsonl
 * and anything already recorded there is skipped on a re-run.
 *
 * Usage:
 *   node scripts/drive-restructure.mjs --dry-run          # plan only, no writes
 *   node scripts/drive-restructure.mjs --limit 3          # act on 3 clients
 *   node scripts/drive-restructure.mjs                    # act on all
 */

import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { parseCsv, normalizeName } from './grants-lib.mjs';

const DRIVE_ID = process.env.PILOT_DEST_ROOT || '0AKxoOSs3WbQ0Uk9PVA';
const STATUS = 'dist/inventory/client-status.csv';
const CLIENTS_FINAL = 'dist/inventory/clients-final.csv';
const LEDGER = 'dist/inventory/restructure-ledger.jsonl';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const LIMIT = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
/** Restrict the run to named folders. Staged runs should not depend on listing order. */
const ONLY = argv.includes('--only')
  ? new Set(argv[argv.indexOf('--only') + 1].split(',').map((s) => s.trim()))
  : null;

const CLIENTS_ROOT = 'Clients';
const LIVE_ROOT = 'Live Clients';

/**
 * Top-level folders that are NOT clients and must be left exactly where they
 * are. `_permission-check` is an artifact of the pilot copy's write probe; it
 * appears in no ledger row and belongs to no client.
 */
const NOT_CLIENTS = new Set([
  'Programs', 'Archive', 'Review', CLIENTS_ROOT, LIVE_ROOT, '_permission-check',
]);

const log = (...a) => console.error(...a);

// ---------------------------------------------------------------- auth
async function loadServiceKey() {
  const fromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (fromEnv && fromEnv.trim().startsWith('{')) {
    try { return JSON.parse(fromEnv); } catch { /* dotenv truncates multiline */ }
  }
  const lines = (await fsp.readFile('.env', 'utf8')).split('\n');
  const i = lines.findIndex((l) => l.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY='));
  if (i < 0) throw new Error('no GOOGLE_SERVICE_ACCOUNT_KEY');
  let raw = lines[i].slice('GOOGLE_SERVICE_ACCOUNT_KEY='.length);
  for (let j = i + 1; j < lines.length; j++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(lines[j])) break;
    raw += '\n' + lines[j];
  }
  return JSON.parse(raw.trim().replace(/^['"]|['"]$/g, ''));
}

// A dry run only ever reads, so it asks for the read-only scope. Write scope is
// requested only when the run will actually move something.
const SCOPE = DRY
  ? 'https://www.googleapis.com/auth/drive.readonly'
  : 'https://www.googleapis.com/auth/drive';

const key = await loadServiceKey();
const nowSec = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: key.client_email, scope: SCOPE,
  aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600,
})}`;
const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
const tokRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
});
if (!tokRes.ok) { log('token failed:', await tokRes.text()); process.exit(1); }
const TOKEN = (await tokRes.json()).access_token;
log(`auth: ${key.client_email} (${DRY ? 'read-only' : 'read-write'})`);

// ---------------------------------------------------------------- api
async function api(url, opts = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        ...opts,
        headers: { Authorization: `Bearer ${TOKEN}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers ?? {}) },
      });
    } catch (err) {
      // Transport-level failure — DNS, reset, timeout. `fetch` throws rather
      // than returning a status, so this has to be caught separately or a
      // single blip kills the whole run. One ENOTFOUND on www.googleapis.com
      // ended the first full pass at 65 of 90 folders.
      lastErr = err;
      const wait = Math.min(1000 * 2 ** attempt, 30000);
      log(`  network error (${err.cause?.code ?? err.message}), retry ${attempt} in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(1000 * 2 ** attempt, 30000);
      log(`  ${res.status}, retry ${attempt} in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.status === 204 ? {} : res.json();
  }
  throw new Error(`exhausted retries${lastErr ? `: ${lastErr.cause?.code ?? lastErr.message}` : ''}`);
}

async function children(id) {
  const out = []; let page = null;
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
    const u = `https://www.googleapis.com/drive/v3/files?q=${q}`
      + `&fields=nextPageToken,files(id,name,mimeType,size,parents)&pageSize=1000`
      + `&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${DRIVE_ID}`
      + (page ? `&pageToken=${page}` : '');
    const d = await api(u);
    out.push(...(d.files ?? []));
    page = d.nextPageToken;
  } while (page);
  return out;
}

const isFolder = (f) => f.mimeType === 'application/vnd.google-apps.folder';

/** Recursive file/folder census plus a path fingerprint of the whole subtree. */
async function census(id) {
  let files = 0, folders = 0, bytes = 0;
  const paths = [];
  const stack = [[id, '']];
  while (stack.length) {
    const [cur, prefix] = stack.pop();
    for (const c of await children(cur)) {
      const p = prefix ? `${prefix}/${c.name}` : c.name;
      if (isFolder(c)) { folders += 1; stack.push([c.id, p]); }
      else { files += 1; bytes += Number(c.size ?? 0); paths.push(p); }
    }
  }
  paths.sort();
  const fingerprint = crypto.createHash('sha256').update(paths.join('\n')).digest('hex').slice(0, 16);
  return { files, folders, bytes, fingerprint, paths };
}

// ---------------------------------------------------------------- ledger
const done = new Set();
try {
  const txt = await fsp.readFile(LEDGER, 'utf8');
  for (const line of txt.trim().split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (r.status === 'ok') done.add(`${r.action}:${r.name}`);
  }
  log(`ledger: ${done.size} actions already completed`);
} catch { log('ledger: none yet'); }

async function record(row) {
  if (DRY) return;
  await fsp.mkdir('dist/inventory', { recursive: true });
  await fsp.appendFile(LEDGER, JSON.stringify({ ...row, timestamp: new Date().toISOString() }) + '\n');
}

// ---------------------------------------------------------------- status
const status = new Map();   // normalized canonical -> {canonical, status, files}
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(STATUS, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0]) continue;
    status.set(normalizeName(r[0]), { canonical: r[0], status: r[1], files: Number(r[10] || 0) });
  }
}

/**
 * Raw folder name -> current canonical.
 *
 * These Drive folders were named from the canonical list as it stood at the
 * pilot copy on 2026-08-11. Several of those canonicals have since been merged
 * away — `Debrand` into `Debrand Services Inc.`, `Clearmind` into `Clearmind
 * International Institute` — so a canonical-only lookup reports them as
 * unmatched and they would silently miss their Live shortcut. `Debrand` is
 * Live. The merged-away name survives as a raw folder name, so resolve through
 * that too.
 */
const rawToCanon = new Map();
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CLIENTS_FINAL, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0]) continue;
    for (const raw of (r[1] ? r[1].split(' | ') : [])) rawToCanon.set(normalizeName(raw), r[0]);
  }
}

/** Drive folder names were sanitized on copy: ':' became ' - '. Undo for lookup. */
const unsanitize = (n) => n.replace(/\s+-\s+/g, ':');

function statusFor(driveName) {
  for (const n of [driveName, unsanitize(driveName)]) {
    const k = normalizeName(n);
    const direct = status.get(k);
    if (direct) return { ...direct, via: 'canonical' };
    const canon = rawToCanon.get(k);
    if (canon) {
      const st = status.get(normalizeName(canon));
      if (st) return { ...st, via: `raw folder name -> "${canon}"` };
    }
  }
  return null;
}

// ---------------------------------------------------------------- plan
const root = await children(DRIVE_ID);
const rootFolders = root.filter(isFolder);
const looseFiles = root.filter((f) => !isFolder(f));

const skipped = rootFolders.filter((f) => NOT_CLIENTS.has(f.name));
const clientFolders = rootFolders.filter((f) => !NOT_CLIENTS.has(f.name));
const selected = ONLY ? clientFolders.filter((f) => ONLY.has(f.name)) : clientFolders;
if (ONLY) {
  const miss = [...ONLY].filter((n) => !clientFolders.some((f) => f.name === n));
  if (miss.length) { log(`ABORT: --only names not found at root: ${miss.join(', ')}`); process.exit(1); }
}

const plan = selected.map((f) => {
  const st = statusFor(f.name);
  return {
    id: f.id, name: f.name,
    canonical: st?.canonical ?? null,

    resolvedVia: st?.via ?? null,
    status: st?.status ?? 'UNMATCHED',
    live: st?.status === 'Live',
    moveDone: done.has(`move:${f.name}`),
    shortcutDone: done.has(`shortcut:${f.name}`),
  };
});

log(`\nroot: ${rootFolders.length} folders, ${looseFiles.length} loose files`);
log(`  left alone (not clients): ${skipped.map((f) => f.name).join(', ') || '(none)'}`);
log(`  client folders to move:   ${plan.length}`);
log(`  of those, Live:           ${plan.filter((p) => p.live).length}`);
log(`  unmatched to any client:  ${plan.filter((p) => p.status === 'UNMATCHED').length}`);

if (DRY) {
  console.log(JSON.stringify({
    mode: 'dry-run',
    drive_id: DRIVE_ID,
    root_folders: rootFolders.length,
    loose_files_at_root: looseFiles.map((f) => f.name),
    left_alone: skipped.map((f) => f.name),
    would_move: plan.length,
    would_get_live_shortcut: plan.filter((p) => p.live).length,
    unmatched: plan.filter((p) => p.status === 'UNMATCHED').map((p) => p.name),
    live: plan.filter((p) => p.live).map((p) => p.name),
    archived: plan.filter((p) => !p.live && p.status !== 'UNMATCHED').length,
  }, null, 2));
  process.exit(0);
}

// -------------------------------------------------- ensure the two roots
async function ensureFolder(name) {
  const hit = rootFolders.find((f) => f.name === name);
  if (hit) { log(`  ${name}/ exists (${hit.id})`); return hit.id; }
  const d = await api('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,parents', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [DRIVE_ID] }),
  });
  log(`  created ${name}/ (${d.id})`);
  await record({ action: 'create-root', name, id: d.id, status: 'ok' });
  return d.id;
}
log('\nensuring roots...');
const clientsRootId = await ensureFolder(CLIENTS_ROOT);
const liveRootId = await ensureFolder(LIVE_ROOT);

// ---------------------------------------------------------------- act
const results = [];
let acted = 0;
for (const p of plan) {
  if (acted >= LIMIT) break;
  if (p.moveDone && (!p.live || p.shortcutDone)) continue;

  const before = await census(p.id);
  const rec = { name: p.name, canonical: p.canonical, status: p.status, before };

  try {
    if (!p.moveDone) {
      // METADATA MOVE. addParents/removeParents re-parents the folder; it does
      // not copy bytes and does not touch anything inside it.
      await api(`https://www.googleapis.com/drive/v3/files/${p.id}`
        + `?addParents=${clientsRootId}&removeParents=${DRIVE_ID}`
        + `&supportsAllDrives=true&fields=id,name,parents`, { method: 'PATCH', body: JSON.stringify({}) });

      // Verify by reading the folder back.
      const back = await api(`https://www.googleapis.com/drive/v3/files/${p.id}?fields=id,name,parents,trashed&supportsAllDrives=true`);
      const ok = (back.parents ?? []).includes(clientsRootId) && !back.trashed;
      if (!ok) throw new Error(`verify failed: parents=${JSON.stringify(back.parents)} trashed=${back.trashed}`);
      rec.newParent = clientsRootId;
      rec.verifiedParent = back.parents;
      await record({ action: 'move', name: p.name, id: p.id, newParent: clientsRootId, status: 'ok' });
      log(`  moved ${p.name} -> ${CLIENTS_ROOT}/`);
    } else {
      rec.newParent = clientsRootId;
      rec.note = 'move already recorded in ledger';
    }

    if (p.live && !p.shortcutDone) {
      const sc = await api('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,parents,shortcutDetails', {
        method: 'POST',
        body: JSON.stringify({
          name: p.name,
          mimeType: 'application/vnd.google-apps.shortcut',
          parents: [liveRootId],
          shortcutDetails: { targetId: p.id },
        }),
      });
      rec.shortcutId = sc.id;
      await record({ action: 'shortcut', name: p.name, id: sc.id, target: p.id, status: 'ok' });
      log(`  shortcut ${LIVE_ROOT}/${p.name} -> ${p.id}`);
    }

    // Post-move census: file count, folder count and subtree fingerprint must
    // be identical. A move that flattened anything would change all three.
    const after = await census(p.id);
    rec.after = after;
    rec.intact = before.files === after.files
      && before.folders === after.folders
      && before.fingerprint === after.fingerprint;
    if (!rec.intact) {
      rec.error = 'STRUCTURE CHANGED';
      await record({ action: 'verify', name: p.name, status: 'failed', before, after });
    }
  } catch (err) {
    // Never clean up, never delete. Leave whatever exists and record it.
    rec.error = err.message;
    await record({ action: 'move', name: p.name, id: p.id, status: 'failed', error: err.message });
    log(`  FAILED ${p.name}: ${err.message} — original left in place`);
  }

  results.push(rec);
  acted += 1;
}

console.log(JSON.stringify({
  mode: 'apply',
  limit: LIMIT === Infinity ? 'all' : LIMIT,
  clients_root: clientsRootId,
  live_root: liveRootId,
  acted: results.length,
  results: results.map((r) => ({
    name: r.name, canonical: r.canonical, status: r.status,
    files_before: r.before?.files, files_after: r.after?.files,
    folders_before: r.before?.folders, folders_after: r.after?.folders,
    fingerprint_before: r.before?.fingerprint, fingerprint_after: r.after?.fingerprint,
    intact: r.intact, verified_parents: r.verifiedParent, shortcut: r.shortcutId ?? null,
    error: r.error ?? null,
  })),
}, null, 2));
