/**
 * scripts/dropbox-inventory-non-grants.js — READ-ONLY inventory of everything
 * in the team folder EXCEPT the already-walked Grants tree.
 *
 * Produces the real accessible volume for the storage-upgrade decision.
 *
 * Reuses the auth and Dropbox-API-Path-Root pattern from
 * scripts/dropbox-inventory.js. Calls only read endpoints:
 *   files/list_folder, files/list_folder/continue, files/get_metadata
 * No file content is fetched. No mutating endpoint is imported or called.
 *
 * Outputs:
 *   dist/inventory/non-grants-inventory.csv   (gitignored — regenerable)
 *   docs/inventory/non-grants-summary.md      (committed)
 *
 * Resume: streams to a JSONL scratch file outside the repo and checkpoints the
 * cursor every 1000 entries. Delete the checkpoint to force a fresh walk.
 */

import 'dotenv/config';
import { Dropbox, DropboxAuth } from 'dropbox';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';
import { classifyCached } from './grants-lib.mjs';

const t0 = Date.now();

const {
  DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, DROPBOX_NAMESPACE_ID,
} = process.env;

const TEAM_FOLDER = '/granted team folder';
const GRANTS_PATH = '/granted team folder/sales/grants';   // already inventoried — never re-walked
const TEAM_FOLDER_DISPLAY = '/Granted Team Folder';

const CSV_DIR = 'dist/inventory';
const DOC_DIR = 'docs/inventory';
const CHECKPOINT_DIR = process.env.DROPBOX_INVENTORY_CHECKPOINT_DIR
  || path.join(os.tmpdir(), 'dropbox-inventory-non-grants');
const JSONL = path.join(CHECKPOINT_DIR, 'walk.jsonl');
const CHECKPOINT = path.join(CHECKPOINT_DIR, 'walk.checkpoint.json');

const log = (...a) => console.log(...a);
const section = (t) => log(`\n===== ${t} =====`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeError(err) {
  const status = err?.status ?? null;
  const body = err?.error ?? null;
  if (typeof body === 'string') return { status, raw: body.trim().slice(0, 300) };
  if (body && typeof body === 'object') {
    return { status, error_summary: body.error_summary ?? null, tag: body.error?.['.tag'] ?? null };
  }
  return { status, message: err?.message ?? String(err) };
}

async function withRetry(label, fn) {
  let delay = 1000;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { return await fn(); } catch (err) {
      const status = err?.status ?? 0;
      if (!(status === 429 || (status >= 500 && status < 600)) || attempt === 6) throw err;
      let waitMs = delay;
      const hdr = err?.headers?.get?.('retry-after');
      const apiRetry = err?.error?.error?.retry_after;
      if (hdr) waitMs = Number(hdr) * 1000; else if (apiRetry) waitMs = Number(apiRetry) * 1000;
      log(`  ⏳ ${label}: ${status}, retry ${attempt}/5 in ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      delay = Math.min(delay * 2, 16000);
    }
  }
}

// ============================================================ Step 1: assert
section('STEP 1 — auth + team-namespace assertion');
for (const [n, v] of Object.entries({ DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, DROPBOX_NAMESPACE_ID })) {
  if (!v) { console.error(`ABORT: ${n} is not set.`); process.exit(1); }
}
const auth = new DropboxAuth({
  clientId: DROPBOX_APP_KEY, clientSecret: DROPBOX_APP_SECRET, refreshToken: DROPBOX_REFRESH_TOKEN,
});
await withRetry('token refresh', () => auth.checkAndRefreshAccessToken());
log(`  refresh exchange: SUCCESS (token length ${auth.getAccessToken().length}, value not printed)`);

const plain = new Dropbox({ auth });
// No selectUser: the app is not permitted to send Dropbox-API-Select-User.
const dbx = new Dropbox({
  auth,
  pathRoot: JSON.stringify({ '.tag': 'namespace_id', namespace_id: DROPBOX_NAMESPACE_ID }),
});

const acct = (await withRetry('users/get_current_account', () => plain.usersGetCurrentAccount())).result;
const homeNs = acct.root_info?.home_namespace_id ?? null;
const rootNs = acct.root_info?.root_namespace_id ?? null;
log(`  account: ${acct.email} (team: ${acct.team?.name ?? 'none'})`);
log(`  home_namespace_id=${homeNs}  root_namespace_id=${rootNs}`);

if (DROPBOX_NAMESPACE_ID === homeNs) {
  console.error("\nABORT: DROPBOX_NAMESPACE_ID is the member's PERSONAL Dropbox, not the team namespace.");
  console.error('That tree contains a decoy "Granted Team Folder (view-only conflicts…)" copy.');
  process.exit(1);
}
if (DROPBOX_NAMESPACE_ID !== rootNs) {
  console.error(`\nABORT: DROPBOX_NAMESPACE_ID does not match the account root namespace (${rootNs}).`);
  process.exit(1);
}
const nsRoot = (await withRetry('list ns root', () =>
  dbx.filesListFolder({ path: '', recursive: false, include_mounted_folders: true })
)).result.entries;
if (!nsRoot.some((e) => e.name.trim().toLowerCase() === 'granted team folder')) {
  console.error('\nABORT: namespace root does not contain "Granted Team Folder".');
  console.error('  saw: ' + nsRoot.map((e) => e.name).join(', '));
  process.exit(1);
}
log('  ✓ team namespace confirmed');

await fsp.mkdir(CHECKPOINT_DIR, { recursive: true });
await fsp.mkdir(CSV_DIR, { recursive: true });
await fsp.mkdir(DOC_DIR, { recursive: true });

// ============================================================ Step 2: targets
section('STEP 2 — enumerate walk targets');
const topLevel = (await withRetry('list team folder', () =>
  dbx.filesListFolder({ path: TEAM_FOLDER, recursive: false, include_mounted_folders: true })
)).result.entries;

const sharingOf = (e) => ({
  no_access: e.sharing_info?.no_access === true,
  traverse_only: e.sharing_info?.traverse_only === true,
  read_only: e.sharing_info?.read_only === true,
});

/** Walk targets: each top-level folder, with SALES exploded so Grants is skipped. */
const targets = [];
const looseTopFiles = [];
for (const e of topLevel) {
  if (e['.tag'] !== 'folder') { looseTopFiles.push(e); continue; }
  const flags = sharingOf(e);
  if (e.name.trim().toLowerCase() === 'sales') {
    // Walk SALES child by child so the already-inventoried Grants subtree is
    // never re-walked. A recursive walk of SALES would pull it back in.
    let kids = [];
    try {
      kids = (await withRetry('list SALES', () =>
        dbx.filesListFolder({ path: e.path_lower, recursive: false, include_mounted_folders: true })
      )).result.entries;
    } catch (err) {
      targets.push({ top: e.name, label: e.name, path: e.path_lower, flags, error: describeError(err) });
      continue;
    }
    for (const k of kids) {
      if (k['.tag'] !== 'folder') { looseTopFiles.push(k); continue; }
      if (k.path_lower === GRANTS_PATH) { log(`  SKIP (already inventoried): ${k.path_display}`); continue; }
      targets.push({ top: e.name, label: `${e.name}/${k.name}`, path: k.path_lower, flags: sharingOf(k) });
    }
  } else {
    targets.push({ top: e.name, label: e.name, path: e.path_lower, flags });
  }
}
log(`  ${targets.length} walk targets across ${new Set(targets.map((t) => t.top)).size} top-level folders`);
for (const t of targets) {
  const f = [t.flags.no_access && 'no_access', t.flags.traverse_only && 'traverse_only'].filter(Boolean).join(',');
  log(`    ${t.label}${f ? `   <<${f}>>` : ''}`);
}

// ============================================================ Step 3: walk
section('STEP 3 — recursive walk (metadata only)');

function toRow(e, top) {
  const isFile = e['.tag'] === 'file';
  const si = e.sharing_info ?? null;
  return {
    path: e.path_display ?? '',
    name: e.name,
    type: e['.tag'],
    size: isFile ? (e.size ?? null) : null,
    server_modified: isFile ? (e.server_modified ?? null) : null,
    client_modified: isFile ? (e.client_modified ?? null) : null,
    extension: isFile ? path.extname(e.name).slice(1).toLowerCase() : '',
    top,
    no_access: si?.no_access === true,
    traverse_only: si?.traverse_only === true,
    read_only: si?.read_only === true,
  };
}

// resume
let doneTargets = new Set();
let seen = 0;
let resumed = false;
if (fs.existsSync(CHECKPOINT) && fs.existsSync(JSONL)) {
  const cp = JSON.parse(await fsp.readFile(CHECKPOINT, 'utf8'));
  if (cp.version === 1) {
    doneTargets = new Set(cp.doneTargets ?? []);
    seen = cp.entries ?? 0;
    failures = cp.failures ?? [];
    walkedFlags = cp.walkedFlags ?? [];
    resumed = true;
    log(`  resuming: ${doneTargets.size} targets already walked, ${seen} entries recorded`);
  }
}
if (!resumed) await fsp.writeFile(JSONL, '');
const out = fs.createWriteStream(JSONL, { flags: resumed ? 'a' : 'w' });
async function write(chunk) { if (!out.write(chunk)) await once(out, 'drain'); }

// Failures and sharing flags must survive a resume: a resumed run skips the
// walk entirely, so if these live only in memory the report silently claims
// zero failures and full visibility. They go in the checkpoint.
let failures = [];
let walkedFlags = [];

async function checkpoint() {
  await fsp.writeFile(CHECKPOINT, JSON.stringify({
    version: 1, doneTargets: [...doneTargets], entries: seen, failures, walkedFlags,
  }, null, 2));
}

for (const t of targets) {
  if (doneTargets.has(t.path)) { log(`  (done) ${t.label}`); continue; }
  walkedFlags.push({ label: t.label, ...t.flags });
  let count = 0;
  try {
    let res = await withRetry(`list ${t.label}`, () => dbx.filesListFolder({
      path: t.path, recursive: true, limit: 2000,
      include_deleted: false, include_mounted_folders: true,
    }));
    while (true) {
      for (const e of res.result.entries) {
        const r = toRow(e, t.top);
        await write(JSON.stringify(r) + '\n');
        seen += 1; count += 1;
        if (seen % 1000 === 0) await checkpoint();
      }
      if (!res.result.has_more) break;
      const cursor = res.result.cursor;
      await sleep(120);
      res = await withRetry(`continue ${t.label}`, () => dbx.filesListFolderContinue({ cursor }));
    }
    log(`  ${t.label}: ${count} entries`);
  } catch (err) {
    const e = describeError(err);
    failures.push({ label: t.label, path: t.path, error: e, flags: t.flags });
    log(`  ${t.label}: FAILED — ${JSON.stringify(e)}`);
  }
  doneTargets.add(t.path);
  await checkpoint();
  await sleep(120);
}
out.end();
await once(out, 'finish');
log(`\n  walk complete: ${seen} entries, ${failures.length} target(s) failed`);

// ============================================================ Step 5: CSV
section('STEP 5 — writing non-grants-inventory.csv');
const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const CSV_OUT = path.join(CSV_DIR, 'non-grants-inventory.csv');
const cs = fs.createWriteStream(CSV_OUT);
await new Promise((r) => cs.write(
  'path,name,type,size,server_modified,client_modified,extension,top_level,no_access,traverse_only,read_only\n', r
));

const agg = new Map();      // top -> {files, folders, bytes}
const byExt = new Map();
const flagged = [];         // folders carrying no_access / traverse_only
let files = 0, folders = 0, bytes = 0, noExt = 0;
let oldest = null, newest = null;

{
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (!cs.write([
      csv(r.path), csv(r.name), csv(r.type), csv(r.size), csv(r.server_modified),
      csv(r.client_modified), csv(r.extension), csv(r.top), csv(r.no_access),
      csv(r.traverse_only), csv(r.read_only),
    ].join(',') + '\n')) await once(cs, 'drain');

    if (!agg.has(r.top)) agg.set(r.top, { files: 0, folders: 0, bytes: 0 });
    const a = agg.get(r.top);
    if (r.type === 'file') {
      files += 1; a.files += 1; bytes += r.size ?? 0; a.bytes += r.size ?? 0;
      if (r.extension) byExt.set(r.extension, (byExt.get(r.extension) ?? 0) + 1); else noExt += 1;
      if (r.client_modified) {
        if (!oldest || r.client_modified < oldest) oldest = r.client_modified;
        if (!newest || r.client_modified > newest) newest = r.client_modified;
      }
    } else {
      folders += 1; a.folders += 1;
      if (r.no_access || r.traverse_only) flagged.push({ path: r.path, no_access: r.no_access, traverse_only: r.traverse_only });
    }
  }
}
cs.end();
await once(cs, 'finish');
log(`  ${seen} rows -> ${CSV_OUT}`);

// ---- Step 7: which folders look like client material? ----------------------
// A folder whose immediate children are mostly company-shaped names, rather
// than document categories, is a candidate for holding client work.
const childrenByFolder = new Map();   // folder path -> Set(child folder names)
const filesUnder = new Map();         // folder path -> file count
{
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const segs = r.path.replace(TEAM_FOLDER_DISPLAY + '/', '').split('/');
    if (r.type === 'folder' && segs.length >= 2) {
      const parent = segs.slice(0, -1).join('/');
      if (!childrenByFolder.has(parent)) childrenByFolder.set(parent, new Set());
      childrenByFolder.get(parent).add(r.name);
    }
    if (r.type === 'file') {
      for (let k = 1; k < segs.length; k++) {
        const anc = segs.slice(0, k).join('/');
        filesUnder.set(anc, (filesUnder.get(anc) ?? 0) + 1);
      }
    }
  }
}
const clientLooking = [];
for (const [folder, kids] of childrenByFolder) {
  if (kids.size < 4) continue;                     // too few to judge
  if (folder.split('/').length > 3) continue;      // only near the top of the tree
  const names = [...kids];
  const clientCount = names.filter((n) => classifyCached(n) === 'client').length;
  const share = clientCount / names.length;
  if (share >= 0.7) {
    clientLooking.push({ path: folder, total: names.length, clients: clientCount, share, files: filesUnder.get(folder) ?? 0 });
  }
}
clientLooking.sort((a, b) => b.files - a.files);

// ============================================================ Step 6/7: report
const gb = (n) => (n / 1024 ** 3).toFixed(2);
const runtimeSec = Math.round((Date.now() - t0) / 1000);

// The grants side, for the combined total.
let grantsFiles = 0, grantsFolders = 0, grantsBytes = 0;
try {
  const rl = readline.createInterface({
    input: fs.createReadStream('dist/inventory/grants-inventory.csv'), crlfDelay: Infinity,
  });
  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    if (!line.trim()) continue;
    const m = line.match(/,(file|folder),(\d*),/);
    if (!m) continue;
    if (m[1] === 'file') { grantsFiles += 1; grantsBytes += Number(m[2] || 0); }
    else grantsFolders += 1;
  }
} catch { /* absent */ }

const partial = walkedFlags.filter((f) => f.traverse_only || f.no_access);
const inaccessible = failures.map((f) => f.label);

const esc = (s) => String(s).replace(/\|/g, '\\|');
const L = [];
const push = (s = '') => L.push(s);

push('# Non-Grants Dropbox Inventory');
push();
push(`**Generated:** ${new Date().toISOString()}`);
push(`**Source:** \`${TEAM_FOLDER}\` — every top-level folder except the already-inventoried \`SALES/Grants\``);
push(`**Runtime:** ${Math.floor(runtimeSec / 60)}m ${runtimeSec % 60}s`);
push('**Method:** metadata only — `files/list_folder` recursive. No file content fetched, nothing written to Dropbox.');
push();

push('## Per top-level folder');
push();
push('| Folder | Files | Folders | Size |');
push('|---|---|---|---|');
for (const [top, a] of [...agg.entries()].sort((x, y) => y[1].bytes - x[1].bytes)) {
  push(`| ${esc(top)} | ${a.files.toLocaleString()} | ${a.folders.toLocaleString()} | ${gb(a.bytes)} GB |`);
}
push(`| **Total (accessible)** | **${files.toLocaleString()}** | **${folders.toLocaleString()}** | **${gb(bytes)} GB** |`);
push();
if (failures.length) {
  push('### Inaccessible — not counted above');
  push();
  push('| Folder | Error | Flags |');
  push('|---|---|---|');
  for (const f of failures) {
    const fl = [f.flags.no_access && 'no_access', f.flags.traverse_only && 'traverse_only'].filter(Boolean).join(', ') || '—';
    push(`| ${esc(f.label)} | ${esc(f.error.error_summary ?? f.error.raw ?? f.error.message ?? 'error')} | ${fl} |`);
  }
  push();
}

push('---');
push();
push('## Combined total — the storage number');
push();
push('| | Files | Folders | Size |');
push('|---|---|---|---|');
push(`| Grants (already inventoried) | ${grantsFiles.toLocaleString()} | ${grantsFolders.toLocaleString()} | ${gb(grantsBytes)} GB |`);
push(`| Everything else | ${files.toLocaleString()} | ${folders.toLocaleString()} | ${gb(bytes)} GB |`);
push(`| **Combined** | **${(grantsFiles + files).toLocaleString()}** | **${(grantsFolders + folders).toLocaleString()}** | **${gb(grantsBytes + bytes)} GB** |`);
push();
push(`⚠️ **This is an accessible-only figure, not the true total.** It counts what the \`consultants@granted.ca\` member can see. It excludes:`);
push();
if (inaccessible.length) for (const n of inaccessible) push(`- \`${esc(n)}\` — could not be listed at all`);
push();
push('Budget for the storage upgrade should treat this as a **floor**.');
push();

push('---');
push();
push('## Step 4 — completeness');
push();
push('| Folder | no_access | traverse_only |');
push('|---|---|---|');
for (const f of walkedFlags) push(`| ${esc(f.label)} | ${f.no_access ? '**yes**' : 'no'} | ${f.traverse_only ? '**yes**' : 'no'} |`);
push();
if (partial.length) {
  push(`⚠️ **${partial.length} folder${partial.length === 1 ? '' : 's'} are only partially visible.** A \`traverse_only\` folder returns *only the subset this member can reach* — the listing looks complete and is not. Their counts are a **lower bound, not a total**:`);
  push();
  for (const p of partial) push(`- \`${esc(p.label)}\` — ${[p.no_access && 'no_access', p.traverse_only && 'traverse_only'].filter(Boolean).join(', ')}`);
  push();
} else {
  push('No walked folder carried `no_access` or `traverse_only` at the top level.');
  push();
}
if (flagged.length) {
  push(`${flagged.length} folder(s) **inside** the walked trees carry a restriction flag; their subtrees are likewise a lower bound. First 20:`);
  push();
  push('| Path | Flags |');
  push('|---|---|');
  for (const f of flagged.slice(0, 20)) {
    push(`| \`${esc(f.path)}\` | ${[f.no_access && 'no_access', f.traverse_only && 'traverse_only'].filter(Boolean).join(', ')} |`);
  }
  push();
}

push('---');
push();
push('## Step 7 — extensions');
push();
push('| Extension | Files |');
push('|---|---|');
for (const [e, c] of [...byExt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  push(`| \`.${e}\` | ${c.toLocaleString()} |`);
}
push(`| _(none)_ | ${noExt.toLocaleString()} |`);
push();
push(`Client-modified range: ${oldest ? oldest.slice(0, 10) : 'n/a'} → ${newest ? newest.slice(0, 10) : 'n/a'}.`);
push();

push('---');
push();
push('## Step 7 — folders that look like client material');
push();
push('Flagged by shape only: a second-level folder whose children look like company names rather than document categories. **Not acted on** — this changes migration scope and is Chris\'s call.');
push();
// Reuse the segment classifier from the grants pipeline rather than inventing
// a second definition of "looks like a company name".
if (clientLooking.length) {
  push('| Folder | Child folders | Classed as client | Share | Files |');
  push('|---|---|---|---|---|');
  for (const c of clientLooking) {
    push(`| \`${esc(c.path)}\` | ${c.total} | ${c.clients} | ${(c.share * 100).toFixed(0)}% | ${c.files.toLocaleString()} |`);
  }
  push();
  push(`**${clientLooking.reduce((s2, c) => s2 + c.files, 0).toLocaleString()} files** sit under folders whose children read as company names. If any of these are client work rather than internal material, the migration scope is larger than the Grants tree alone.`);
} else {
  push('None found — every walked folder\'s children read as document categories or internal material rather than company names.');
}
push();

push('---');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/dropbox-inventory-non-grants.js');
push('```');
push();
push(`Read-only and resumable. Delete \`${CHECKPOINT}\` to force a fresh walk.`);
push();

const MD_OUT = path.join(DOC_DIR, 'non-grants-summary.md');
await fsp.writeFile(MD_OUT, L.join('\n'));
log(`  -> ${MD_OUT}`);

section('DONE');
console.log(JSON.stringify({
  targets: targets.length, entries: seen, files, folders,
  bytes, gb: Number(gb(bytes)),
  failures: failures.map((f) => ({ label: f.label, error: f.error })),
  partial: partial.map((p) => p.label),
  flagged_subfolders: flagged.length,
  grants: { files: grantsFiles, folders: grantsFolders, gb: Number(gb(grantsBytes)) },
  combined_gb: Number(gb(grantsBytes + bytes)),
  runtime_seconds: runtimeSec,
}, null, 2));
