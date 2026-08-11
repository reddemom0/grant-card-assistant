/**
 * scripts/dropbox-inventory.js — READ-ONLY file-level inventory of the Grants tree.
 *
 * Walks /granted team folder/sales/grants and records METADATA ONLY. It calls
 * exactly four Dropbox endpoints, all read-only:
 *   files/list_folder, files/list_folder/continue,
 *   files/get_metadata, sharing/get_folder_metadata
 * No file content is ever fetched; no mutating endpoint is imported or called.
 *
 * Outputs:
 *   dist/inventory/grants-inventory.csv    (gitignored — regenerable)
 *   dist/inventory/raw-client-names.csv    (gitignored — regenerable)
 *   docs/inventory/inventory-summary.md    (committed — small, worth history)
 *
 * Resume: the walk streams to a JSONL scratch file and checkpoints its cursor
 * every 1000 entries outside the repo. An interrupted run resumes from the
 * cursor instead of re-walking. Delete the checkpoint to force a fresh run.
 */

import 'dotenv/config';
import { Dropbox, DropboxAuth } from 'dropbox';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';

const t0 = Date.now();

const {
  DROPBOX_APP_KEY,
  DROPBOX_APP_SECRET,
  DROPBOX_REFRESH_TOKEN,
  DROPBOX_NAMESPACE_ID,
} = process.env;

const TEAM_FOLDER = '/granted team folder';
const GRANTS_PATH = '/granted team folder/sales/grants';

const CSV_DIR = 'dist/inventory';
const DOC_DIR = 'docs/inventory';
const CHECKPOINT_DIR =
  process.env.DROPBOX_INVENTORY_CHECKPOINT_DIR ||
  path.join(os.tmpdir(), 'dropbox-inventory');
const JSONL = path.join(CHECKPOINT_DIR, 'grants-walk.jsonl');
const CHECKPOINT = path.join(CHECKPOINT_DIR, 'grants-walk.checkpoint.json');

const log = (...a) => console.log(...a);
const section = (t) => log(`\n===== ${t} =====`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeError(err) {
  const status = err?.status ?? null;
  const body = err?.error ?? null;
  if (typeof body === 'string') return { status, raw: body.trim().slice(0, 400) };
  if (body && typeof body === 'object') {
    return {
      status,
      error_summary: body.error_summary ?? null,
      tag: body.error?.['.tag'] ?? null,
    };
  }
  return { status, message: err?.message ?? String(err) };
}

/** Retry on 429 (honouring Retry-After) and 5xx. Never retries a 4xx auth/path error. */
async function withRetry(label, fn) {
  let delay = 1000;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? 0;
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt === 6) throw err;

      let waitMs = delay;
      const hdr = err?.headers?.get?.('retry-after');
      const apiRetry = err?.error?.error?.retry_after;
      if (hdr) waitMs = Number(hdr) * 1000;
      else if (apiRetry) waitMs = Number(apiRetry) * 1000;

      log(`  ⏳ ${label}: ${status}, retry ${attempt}/5 in ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      delay = Math.min(delay * 2, 16000);
    }
  }
  throw new Error(`${label}: retries exhausted`);
}

const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function write(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

// ============================================================ Step 1: auth
section('STEP 1 — auth + team-namespace assertion');

for (const [n, v] of Object.entries({
  DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, DROPBOX_NAMESPACE_ID,
})) {
  if (!v) {
    console.error(`ABORT: ${n} is not set.`);
    process.exit(1);
  }
  log(`  ${n}: present`);
}

const auth = new DropboxAuth({
  clientId: DROPBOX_APP_KEY,
  clientSecret: DROPBOX_APP_SECRET,
  refreshToken: DROPBOX_REFRESH_TOKEN,
});

await withRetry('token refresh', () => auth.checkAndRefreshAccessToken());
log(`  refresh exchange: SUCCESS (token length ${auth.getAccessToken().length}, value not printed)`);

const plain = new Dropbox({ auth });

// NOTE: no selectUser. The app is not permitted to send Dropbox-API-Select-User;
// including it makes every call fail with a 400 (see docs/dropbox-probe-findings.md).
const dbx = new Dropbox({
  auth,
  pathRoot: JSON.stringify({ '.tag': 'namespace_id', namespace_id: DROPBOX_NAMESPACE_ID }),
});

const acct = (await withRetry('users/get_current_account', () => plain.usersGetCurrentAccount())).result;
const homeNs = acct.root_info?.home_namespace_id ?? null;
const rootNs = acct.root_info?.root_namespace_id ?? null;

log(`  account: ${acct.email} (team: ${acct.team?.name ?? 'none'})`);
log(`  home_namespace_id: ${homeNs}`);
log(`  root_namespace_id: ${rootNs}`);
log(`  DROPBOX_NAMESPACE_ID matches root: ${DROPBOX_NAMESPACE_ID === rootNs}`);

// Assertion 1 — the killer case: without Path-Root the API silently returns the
// member's PERSONAL Dropbox, which contains a decoy conflict-copy team folder.
if (DROPBOX_NAMESPACE_ID === homeNs) {
  console.error('\nABORT: DROPBOX_NAMESPACE_ID equals home_namespace_id — that is the');
  console.error('member\'s personal Dropbox, not the team namespace. Refusing to inventory it.');
  process.exit(1);
}
// Assertion 2
if (DROPBOX_NAMESPACE_ID !== rootNs) {
  console.error(`\nABORT: DROPBOX_NAMESPACE_ID does not match the account root namespace (${rootNs}).`);
  process.exit(1);
}

// Assertion 3 — the namespace root really is the team space, and grants resolves.
const nsRoot = (await withRetry('list namespace root', () =>
  dbx.filesListFolder({ path: '', recursive: false, include_mounted_folders: true })
)).result.entries;

if (!nsRoot.some((e) => e.name.trim().toLowerCase() === 'granted team folder')) {
  console.error('\nABORT: namespace root does not contain "Granted Team Folder". Wrong root.');
  console.error('  saw: ' + nsRoot.map((e) => e.name).join(', '));
  process.exit(1);
}

let grantsMeta;
try {
  grantsMeta = (await withRetry('grants metadata', () =>
    dbx.filesGetMetadata({ path: GRANTS_PATH })
  )).result;
} catch (err) {
  console.error(`\nABORT: ${GRANTS_PATH} did not resolve — ${JSON.stringify(describeError(err))}`);
  process.exit(1);
}
if (grantsMeta['.tag'] !== 'folder') {
  console.error(`\nABORT: ${GRANTS_PATH} is not a folder.`);
  process.exit(1);
}

const GRANTS_DISPLAY = grantsMeta.path_display;
log(`  ✓ team namespace confirmed; grants resolves at "${GRANTS_DISPLAY}"`);

// Assertions passed — only now create output directories.
await fsp.mkdir(CHECKPOINT_DIR, { recursive: true });
await fsp.mkdir(CSV_DIR, { recursive: true });
await fsp.mkdir(DOC_DIR, { recursive: true });

// ============================================================ Step 2/3: walk
section('STEP 2/3 — recursive walk (metadata only)');

/** Shape one API entry into an inventory row. */
function toRow(e) {
  const display = e.path_display ?? '';
  // Raw, un-normalized segments. path_display preserves original casing, which
  // Step 6 requires — path_lower would silently normalize the client names.
  const rel = display.toLowerCase().startsWith(GRANTS_DISPLAY.toLowerCase() + '/')
    ? display.slice(GRANTS_DISPLAY.length + 1)
    : '';
  const segments = rel ? rel.split('/') : [];
  const isFile = e['.tag'] === 'file';
  const ext = isFile ? path.extname(e.name).slice(1).toLowerCase() : '';
  const si = e.sharing_info ?? null;
  return {
    path: display,
    name: e.name,
    type: e['.tag'],
    size: isFile ? (e.size ?? null) : null,
    server_modified: isFile ? (e.server_modified ?? null) : null,
    client_modified: isFile ? (e.client_modified ?? null) : null,
    extension: ext,
    depth: segments.length,
    segments,
    no_access: si?.no_access === true,
    traverse_only: si?.traverse_only === true,
    read_only: si?.read_only === true,
  };
}

// Aggregates, accumulated during the walk (entries are NOT held in memory).
const agg = {
  files: 0,
  folders: 0,
  bytes: 0,
  byExt: new Map(),
  noExt: 0,
  fileDepth: new Map(),
  oldest: null,
  newest: null,
  flagged: [],            // folders carrying no_access / traverse_only
  childFolders: [],       // immediate children of grants (depth 1, folder)
  segProgram: new Map(),  // third-level segment -> Set(program folders)
  segEntries: new Map(),  // third-level segment -> row count
};

function accumulate(r) {
  if (r.type === 'file') {
    agg.files += 1;
    agg.bytes += r.size ?? 0;
    if (r.extension) agg.byExt.set(r.extension, (agg.byExt.get(r.extension) ?? 0) + 1);
    else agg.noExt += 1;
    agg.fileDepth.set(r.depth, (agg.fileDepth.get(r.depth) ?? 0) + 1);
    if (r.server_modified) {
      if (!agg.oldest || r.server_modified < agg.oldest) agg.oldest = r.server_modified;
      if (!agg.newest || r.server_modified > agg.newest) agg.newest = r.server_modified;
    }
  } else {
    agg.folders += 1;
    if (r.depth === 1) agg.childFolders.push({ name: r.name, path: r.path });
  }
  if (r.no_access || r.traverse_only) {
    agg.flagged.push({ path: r.path, no_access: r.no_access, traverse_only: r.traverse_only });
  }
  if (r.depth >= 2) {
    const seg = r.segments[1];
    const program = r.segments[0];
    if (!agg.segProgram.has(seg)) agg.segProgram.set(seg, new Set());
    agg.segProgram.get(seg).add(program);
    agg.segEntries.set(seg, (agg.segEntries.get(seg) ?? 0) + 1);
  }
}

// --- resume ------------------------------------------------------------------
let cursor = null;
let seen = 0;
let resumed = false;

if (fs.existsSync(CHECKPOINT) && fs.existsSync(JSONL)) {
  const cp = JSON.parse(await fsp.readFile(CHECKPOINT, 'utf8'));
  if (cp.grants_path === GRANTS_PATH && cp.cursor) {
    log(`  resuming from checkpoint (${cp.entries} entries already walked)`);
    const rl = readline.createInterface({
      input: fs.createReadStream(JSONL),
      crlfDelay: Infinity,
    });
    let replayed = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (replayed >= cp.entries) break; // ignore rows written after the last checkpoint
      accumulate(JSON.parse(line));
      replayed += 1;
    }
    // Truncate anything past the checkpoint so the JSONL matches the cursor exactly.
    cursor = cp.cursor;
    seen = replayed;
    resumed = true;
    log(`  replayed ${replayed} entries from scratch file`);
  }
}

if (!resumed) {
  await fsp.writeFile(JSONL, '');
}

const jsonlOut = fs.createWriteStream(JSONL, { flags: resumed ? 'a' : 'w' });

async function checkpoint() {
  await fsp.writeFile(
    CHECKPOINT,
    JSON.stringify({ grants_path: GRANTS_PATH, cursor, entries: seen }, null, 2)
  );
}

let page = 0;
let hasMore = true;

while (hasMore) {
  const res = cursor
    ? await withRetry('list_folder/continue', () => dbx.filesListFolderContinue({ cursor }))
    : await withRetry('list_folder', () =>
        dbx.filesListFolder({
          path: GRANTS_PATH,
          recursive: true,
          limit: 2000,
          include_deleted: false,
          include_mounted_folders: true,
        })
      );

  const { entries, cursor: next, has_more: more } = res.result;
  page += 1;

  for (const e of entries) {
    const r = toRow(e);
    accumulate(r);
    await write(jsonlOut, JSON.stringify(r) + '\n');
    seen += 1;
    if (seen % 1000 === 0) {
      cursor = next;
      await checkpoint();
    }
  }

  cursor = next;
  hasMore = more;
  log(`  page ${page}: +${entries.length} (total ${seen})${more ? '' : ' — done'}`);
  await checkpoint();
  if (more) await sleep(120); // pace between pages
}

jsonlOut.end();
await once(jsonlOut, 'finish');

log(`  walk complete: ${seen} entries (${agg.files} files, ${agg.folders} folders)`);

// ============================================================ Step 4
section('STEP 4 — completeness check');

// sharing/get_folder_metadata takes a shared_folder_id, not a path. Most program
// folders inherit the team folder's ACL and have no shared_folder_id, so the
// path-based files/get_metadata is the call that actually answers "can this
// member read it"; sharing/get_folder_metadata is used only where an id exists.
const completeness = {
  children_checked: 0,
  no_access: [],
  traverse_only: [],
  clean: 0,
  errors: [],
  shared_folder_checks: [],
};

// The grants folder itself first.
try {
  const md = (await withRetry('grants get_metadata', () =>
    dbx.filesGetMetadata({ path: GRANTS_PATH })
  )).result;
  completeness.grants_self = {
    no_access: md.sharing_info?.no_access === true,
    traverse_only: md.sharing_info?.traverse_only === true,
    read_only: md.sharing_info?.read_only === true,
    shared_folder_id: md.shared_folder_id ?? null,
  };
  log(`  grants root: ${JSON.stringify(completeness.grants_self)}`);
} catch (err) {
  completeness.grants_self_error = describeError(err);
}

log(`  checking ${agg.childFolders.length} immediate child folders...`);

for (const child of agg.childFolders) {
  completeness.children_checked += 1;
  try {
    const md = (await withRetry(`get_metadata ${child.name}`, () =>
      dbx.filesGetMetadata({ path: child.path })
    )).result;

    const si = md.sharing_info ?? {};
    const sfid = md.shared_folder_id ?? null;

    if (si.no_access === true) completeness.no_access.push(child.name);
    else if (si.traverse_only === true) completeness.traverse_only.push(child.name);
    else completeness.clean += 1;

    if (sfid) {
      try {
        const sf = (await withRetry(`shared_folder ${child.name}`, () =>
          dbx.sharingGetFolderMetadata({ shared_folder_id: sfid })
        )).result;
        completeness.shared_folder_checks.push({
          name: child.name,
          access_type: sf.access_type?.['.tag'] ?? null,
          is_inside_team_folder: sf.is_inside_team_folder ?? null,
        });
      } catch (err) {
        completeness.shared_folder_checks.push({
          name: child.name,
          error: describeError(err),
        });
      }
    }
  } catch (err) {
    completeness.errors.push({ name: child.name, error: describeError(err) });
  }
  if (completeness.children_checked % 50 === 0) {
    log(`    ...${completeness.children_checked}/${agg.childFolders.length}`);
  }
  await sleep(30);
}

// Cross-check against flags seen during the walk itself.
const walkFlagged = agg.flagged.length;
const partial =
  completeness.no_access.length > 0 ||
  completeness.traverse_only.length > 0 ||
  walkFlagged > 0;

completeness.walk_flagged_count = walkFlagged;
completeness.verdict = partial ? 'PARTIALLY VISIBLE' : 'FULLY VISIBLE';

log(`  no_access: ${completeness.no_access.length}`);
log(`  traverse_only: ${completeness.traverse_only.length}`);
log(`  clean: ${completeness.clean}`);
log(`  errors: ${completeness.errors.length}`);
log(`  flagged anywhere in walk: ${walkFlagged}`);
log(`  VERDICT: ${completeness.verdict}`);

// ============================================================ Step 5
section('STEP 5 — writing grants-inventory.csv');

const invPath = path.join(CSV_DIR, 'grants-inventory.csv');
const invOut = fs.createWriteStream(invPath);
await write(
  invOut,
  'path,name,type,size,server_modified,client_modified,extension,depth,no_access,traverse_only,read_only\n'
);

{
  const rl = readline.createInterface({
    input: fs.createReadStream(JSONL),
    crlfDelay: Infinity,
  });
  let rows = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    await write(
      invOut,
      [
        csv(r.path), csv(r.name), csv(r.type), csv(r.size),
        csv(r.server_modified), csv(r.client_modified), csv(r.extension),
        csv(r.depth), csv(r.no_access), csv(r.traverse_only), csv(r.read_only),
      ].join(',') + '\n'
    );
    rows += 1;
  }
  invOut.end();
  await once(invOut, 'finish');
  log(`  ${rows} rows -> ${invPath}`);
}

// ============================================================ Step 6
section('STEP 6 — writing raw-client-names.csv');

const namesPath = path.join(CSV_DIR, 'raw-client-names.csv');
const namesOut = fs.createWriteStream(namesPath);
await write(namesOut, 'raw_segment,occurrences,entries_beneath\n');

const segRows = [...agg.segProgram.entries()]
  .map(([seg, programs]) => ({
    seg,
    occurrences: programs.size,
    entries: agg.segEntries.get(seg) ?? 0,
  }))
  .sort((a, b) => b.entries - a.entries || a.seg.localeCompare(b.seg));

for (const s of segRows) {
  await write(namesOut, `${csv(s.seg)},${s.occurrences},${s.entries}\n`);
}
namesOut.end();
await once(namesOut, 'finish');
log(`  ${segRows.length} distinct third-level segments -> ${namesPath}`);

// ============================================================ Step 7
section('STEP 7 — sibling top-level folders (one level each)');

const topLevel = (await withRetry('list team folder', () =>
  dbx.filesListFolder({ path: TEAM_FOLDER, recursive: false, include_mounted_folders: true })
)).result.entries.filter((e) => e['.tag'] === 'folder');

const siblings = [];
for (const f of topLevel) {
  try {
    const res = (await withRetry(`list ${f.name}`, () =>
      dbx.filesListFolder({ path: f.path_lower, recursive: false, include_mounted_folders: true })
    )).result;
    let entries = res.entries;
    let c = res.cursor;
    let more = res.has_more;
    while (more) {
      const n = (await withRetry(`continue ${f.name}`, () =>
        dbx.filesListFolderContinue({ cursor: c })
      )).result;
      entries = entries.concat(n.entries);
      c = n.cursor;
      more = n.has_more;
    }
    siblings.push({
      name: f.name,
      access: 'ACCESSIBLE',
      children: entries.length,
      folders: entries.filter((e) => e['.tag'] === 'folder').length,
      files: entries.filter((e) => e['.tag'] === 'file').length,
      traverse_only: f.sharing_info?.traverse_only === true,
    });
    log(`  ${f.name}: ${entries.length} children`);
  } catch (err) {
    siblings.push({
      name: f.name,
      access: 'DENIED',
      error: describeError(err),
      no_access: f.sharing_info?.no_access === true,
    });
    log(`  ${f.name}: DENIED — ${JSON.stringify(describeError(err))}`);
  }
  await sleep(50);
}

// ============================================================ Step 8
section('STEP 8 — writing inventory-summary.md');

const runtimeMs = Date.now() - t0;
const mins = Math.floor(runtimeMs / 60000);
const secs = Math.round((runtimeMs % 60000) / 1000);
const gb = (agg.bytes / 1024 ** 3).toFixed(2);
const invSize = (await fsp.stat(invPath)).size;

const extRows = [...agg.byExt.entries()].sort((a, b) => b[1] - a[1]);
const depthRows = [...agg.fileDepth.entries()].sort((a, b) => a[0] - b[0]);
const shapeLabel = (d) =>
  d === 1 ? 'file directly in grants/' :
  d === 2 ? 'program/file' :
  d === 3 ? 'program/client/file' :
  `depth ${d} (deeper than program/client/file)`;

const md = `# Grants Inventory — Summary

**Generated:** ${new Date().toISOString()}
**Source:** \`${GRANTS_DISPLAY}\` (Dropbox team namespace)
**Runtime:** ${mins}m ${secs}s
**Method:** metadata only — \`files/list_folder\` (recursive), \`files/get_metadata\`, \`sharing/get_folder_metadata\`. No file content fetched.

## Totals

| Metric | Value |
|---|---|
| Total entries | ${seen.toLocaleString()} |
| Files | ${agg.files.toLocaleString()} |
| Folders | ${agg.folders.toLocaleString()} |
| Total bytes | ${agg.bytes.toLocaleString()} (${gb} GB) |
| Immediate child folders of grants | ${agg.childFolders.length} |
| Distinct third-level segments | ${segRows.length.toLocaleString()} |
| Oldest \`server_modified\` | ${agg.oldest ?? 'n/a'} |
| Newest \`server_modified\` | ${agg.newest ?? 'n/a'} |
| Files with no extension | ${agg.noExt.toLocaleString()} |

## Completeness verdict — ${completeness.verdict}

| Check | Count |
|---|---|
| Immediate children checked | ${completeness.children_checked} |
| \`no_access\` | ${completeness.no_access.length} |
| \`traverse_only\` | ${completeness.traverse_only.length} |
| Clean | ${completeness.clean} |
| Metadata errors | ${completeness.errors.length} |
| Folders flagged anywhere in the walk | ${completeness.walk_flagged_count} |

${
  partial
    ? `**The Grants tree is PARTIALLY VISIBLE to this token.** At least one folder carries \`no_access\` or \`traverse_only\`, which means this inventory is a **lower bound** — a \`traverse_only\` folder returns only the subset this member can reach and looks complete when it is not.

${completeness.no_access.length ? `- \`no_access\`: ${completeness.no_access.map((n) => `\`${n}\``).join(', ')}\n` : ''}${completeness.traverse_only.length ? `- \`traverse_only\`: ${completeness.traverse_only.map((n) => `\`${n}\``).join(', ')}\n` : ''}`
    : `**The Grants tree is FULLY VISIBLE to this token.** No folder in the tree carries \`no_access\` or \`traverse_only\`, and every one of the ${completeness.children_checked} immediate child folders resolved cleanly. The counts above are complete, not a lower bound.`
}
${completeness.errors.length ? `\n⚠️ ${completeness.errors.length} child folder(s) failed metadata lookup: ${completeness.errors.map((e) => `\`${e.name}\``).join(', ')}\n` : ''}
## Files by extension

| Extension | Files |
|---|---|
${extRows.map(([e, c]) => `| \`.${e}\` | ${c.toLocaleString()} |`).join('\n')}
| _(none)_ | ${agg.noExt.toLocaleString()} |

## Path shape (files only)

Depth is relative to \`grants/\`.

| Depth | Shape | Files |
|---|---|---|
${depthRows.map(([d, c]) => `| ${d} | ${shapeLabel(d)} | ${c.toLocaleString()} |`).join('\n')}

## Sibling top-level folders (one level, no recursion)

\`grants\` is not itself top-level — it sits under \`SALES\`. All ${siblings.length} top-level folders of the team folder are listed here.

| Folder | Access | Immediate children |
|---|---|---|
${siblings
  .map((s) =>
    s.access === 'ACCESSIBLE'
      ? `| ${s.name} | ACCESSIBLE${s.traverse_only ? ' (traverse_only — may be partial)' : ''} | ${s.children} (${s.folders} folders, ${s.files} files) |`
      : `| ${s.name} | **DENIED**${s.no_access ? ' (no_access)' : ''} | ${s.error?.error_summary ?? s.error?.raw ?? s.error?.message ?? 'error'} |`
  )
  .join('\n')}

## Outputs

| File | Size | In git? |
|---|---|---|
| \`dist/inventory/grants-inventory.csv\` | ${(invSize / 1024 / 1024).toFixed(2)} MB | no — gitignored, regenerable |
| \`dist/inventory/raw-client-names.csv\` | ${((await fsp.stat(namesPath)).size / 1024).toFixed(1)} KB | no — gitignored, regenerable |
| \`docs/inventory/inventory-summary.md\` | this file | yes |

\`raw-client-names.csv\` columns: \`raw_segment\` (verbatim, un-normalized), \`occurrences\` (how many distinct program folders contain that segment name), \`entries_beneath\` (total inventory rows at or under it).

## Reproducing

\`\`\`bash
node scripts/dropbox-inventory.js
\`\`\`

Read-only and resumable. Delete \`${CHECKPOINT}\` to force a fresh walk.
`;

const summaryPath = path.join(DOC_DIR, 'inventory-summary.md');
await fsp.writeFile(summaryPath, md);
log(`  -> ${summaryPath}`);

section('DONE');
log(`  runtime: ${mins}m ${secs}s`);
log(`  entries: ${seen}, files: ${agg.files}, folders: ${agg.folders}`);
log(`  verdict: ${completeness.verdict}`);
