/**
 * delta-pull-mapping.mjs — map the delta copy set through the EXISTING pipeline,
 * unchanged, without touching any committed contract sheet.
 *
 * How "unchanged" is guaranteed: scripts/full-mapping.mjs is executed as-is, in
 * a sandbox under dist/inventory/delta/sandbox/, fed the original inputs plus
 * the new rows only. Every pre-existing source must then regenerate to exactly
 * the row already in dist/inventory/full-mapping.csv — if a new file had
 * shifted an old destination (a collision suffix, a case fold, a node change),
 * that assertion fails. departments-mapping.mjs is run the same way; its copy
 * differs from the committed script only in the hardcoded process.chdir into
 * the repo (removed, or it would overwrite the committed sheet) and in import
 * paths pointing back at the repo's libraries.
 *
 * Two inputs are augmented beyond "append the new rows", both recorded here:
 *
 *   Zanzibar. The folder "ETG/…2026 : 2027 Intake/Zanzibar" was never
 *   classified — it did not exist at inventory time — so the pipeline would
 *   leave it in review. It is the next intake of the existing canonical
 *   "Zanzibar Holdings" (same S-100 course folder, invoice issued to Zanzibar
 *   Holdings Ltd, HubSpot active match). The sandbox applies that as a
 *   corrections entry and a raw name on the canonical — exactly what
 *   build-final-clients.mjs emits for a hand correction. The committed
 *   client-corrections.json and clients-final.csv are not modified: the brief
 *   adds corrections only for genuinely new clients.
 *
 *   CanExport review rows. canexport-mapping.csv predates the review-pile
 *   routing added to full-mapping.mjs, so its 45 review rows (24 sources) were
 *   never routed. The same routing is applied to them here, lifted verbatim
 *   from full-mapping.mjs: joint-client rows promote to Clients/ dual-filed,
 *   no-client rows go to Programs/<program>/_Unfiled.
 *
 * READ-ONLY: no network of any kind. Reads the delta outputs of
 * delta-pull-inventory.mjs and delta-pull-verify.mjs, writes only under
 * dist/inventory/delta/.
 *
 * Usage: node scripts/delta-pull-mapping.mjs
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseCsv } from './grants-lib.mjs';
import { foldDestinationCase, CLIENTS_ROOT } from './mapping-lib.mjs';

const REPO = '/Users/Chris/grant-card-assistant';
process.chdir(REPO);
const DIR = 'dist/inventory/delta';
const SB = path.join(REPO, DIR, 'sandbox');
const GRANTS_PREFIX = '/Granted Team Folder/SALES/Grants/';
const TRIAGE_GROUPS = new Set(['SALES / *Keep', 'SALES / *Obsolete : Duplicate - Delete', 'SALES / *Needs Review']);
const COPY_ROUTES = new Set(['sort', 'program', 'archive', 'mirror']);
const log = (...a) => console.error(...a);

const esc = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** One CSV record per line (no field in these sheets contains a newline). */
function splitLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const readLines = (p) => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);

// ---------------------------------------------------------------- copy set
const verify = JSON.parse(await fsp.readFile(path.join(DIR, 'verify.json'), 'utf8'));
const triage = verify.results.filter((r) => TRIAGE_GROUPS.has(r.group));
const copySet = verify.results.filter((r) => !TRIAGE_GROUPS.has(r.group));
const isGrants = (p) => p.startsWith(GRANTS_PREFIX);
const carry = copySet.filter((r) => r.sub === 'inventoried_review_route');
const grantsNew = copySet.filter((r) => r.sub === 'new_since_inventory' && isGrants(r.path));
const deptNew = copySet.filter((r) => r.sub === 'new_since_inventory' && !isGrants(r.path));
log(`copy set: ${copySet.length} sources — grants new ${grantsNew.length}, departments new ${deptNew.length}, CanExport carryover ${carry.length}; triage held back ${triage.length}`);

const live = new Map(), liveFolders = new Map();
for (const l of readLines(path.join(DIR, 'live-dropbox.jsonl'))) {
  const o = JSON.parse(l);
  (o.type === 'file' ? live : liveFolders).set(o.path_lower, o);
}

// ---------------------------------------------------------------- sandbox
await fsp.rm(SB, { recursive: true, force: true });
for (const d of ['dist/inventory', 'docs/inventory', 'scripts']) await fsp.mkdir(path.join(SB, d), { recursive: true });
for (const f of ['resolved-final.csv', 'canexport-mapping.csv']) await fsp.copyFile(`dist/inventory/${f}`, path.join(SB, 'dist/inventory', f));
await fsp.copyFile(path.join(DIR, 'drive-folders.txt'), path.join(SB, 'dist/inventory/drive-folders.txt'));

// Casing: Dropbox guarantees only a path's last segment. Rebuild each new path
// from the inventory's own spelling of every folder it already had, so node
// lookups in mapFiles (exact-case keys) hit.
const invFolderDisplay = new Map();
const grantsInvText = fs.readFileSync('dist/inventory/grants-inventory.csv', 'utf8');
{
  let h = null;
  for (const r of parseCsv(grantsInvText)) { if (!h) { h = r; continue; } if (r[2] === 'folder') invFolderDisplay.set(r[0].toLowerCase(), r[0]); }
}
const canonCache = new Map();
function canonFolder(lower) {
  if (canonCache.has(lower)) return canonCache.get(lower);
  let v = invFolderDisplay.get(lower);
  if (!v) {
    const parent = lower.slice(0, lower.lastIndexOf('/'));
    const own = liveFolders.get(lower)?.path ?? lower;
    v = `${parent ? canonFolder(parent) : ''}/${path.basename(own)}`;
    if (lower === '/granted team folder/sales/grants') v = GRANTS_PREFIX.slice(0, -1);
  }
  canonCache.set(lower, v);
  return v;
}
const recased = [];
const canonPathOf = (p) => {
  const lower = p.toLowerCase();
  const c = `${canonFolder(lower.slice(0, lower.lastIndexOf('/')))}/${path.basename(live.get(lower).path)}`;
  if (c !== p) recased.push({ from: p, to: c });
  return c;
};

// grants-inventory: original + new files + the new folders above them.
const INV_HEAD = 'path,name,type,size,server_modified,client_modified,extension,depth,no_access,traverse_only,read_only';
const invAppend = [];
const addedFolders = new Set();
const srcOf = new Map();          // canonical source path -> verify record
for (const r of grantsNew) {
  const src = canonPathOf(r.path);
  srcOf.set(src, r);
  const lf = live.get(r.path.toLowerCase());
  const segs = src.slice(GRANTS_PREFIX.length).split('/');
  for (let k = 1; k < segs.length; k++) {
    const fp = GRANTS_PREFIX + segs.slice(0, k).join('/');
    const low = fp.toLowerCase();
    if (invFolderDisplay.has(low) || addedFolders.has(low)) continue;
    addedFolders.add(low);
    invAppend.push([fp, segs[k - 1], 'folder', '', '', '', '', k, false, false, false].map(esc).join(','));
  }
  invAppend.push([src, path.basename(src), 'file', lf.size, lf.server_modified, lf.client_modified,
    path.extname(src).slice(1).toLowerCase(), segs.length, false, false, false].map(esc).join(','));
}
await fsp.writeFile(path.join(SB, 'dist/inventory/grants-inventory.csv'), grantsInvText.replace(/\n?$/, '\n') + invAppend.join('\n') + '\n');

// Zanzibar → Zanzibar Holdings, as a hand correction would record it.
const ZAN = { raw: 'Zanzibar', canonical: 'Zanzibar Holdings' };
{
  const corr = JSON.parse(await fsp.readFile('scripts/client-corrections.json', 'utf8'));
  corr.corrections.push({
    canonical_name: ZAN.canonical, raw_names: [ZAN.raw], asserts_client: true,
    source: 'delta pull 2026-09-13',
    note: 'SANDBOX ONLY. New folder in the 2026 : 2027 ETG intake; next intake of the existing canonical (same S-100 course, invoice to Zanzibar Holdings Ltd).',
  });
  await fsp.writeFile(path.join(SB, 'scripts/client-corrections.json'), JSON.stringify(corr, null, 2));
  const lines = readLines('dist/inventory/clients-final.csv');
  let hit = 0;
  const outLines = lines.map((line, i) => {
    if (i === 0) return line;
    const c = splitLine(line);
    if (c[0] !== ZAN.canonical) return line;
    hit += 1;
    c[1] = `${c[1]} | ${ZAN.raw}`; c[2] = String(Number(c[2]) + 1);
    return c.map(esc).join(',');
  });
  if (hit !== 1) { log(`ABORT: expected exactly one "${ZAN.canonical}" canonical, found ${hit}`); process.exit(1); }
  await fsp.writeFile(path.join(SB, 'dist/inventory/clients-final.csv'), outLines.join('\n') + '\n');
}

// non-grants-inventory: original + the new department files.
{
  const text = fs.readFileSync('dist/inventory/non-grants-inventory.csv', 'utf8');
  const add = deptNew.map((r) => {
    const lf = live.get(r.path.toLowerCase());
    const top = r.path.split('/').length > 3 ? r.path.split('/')[2] : '(root)';
    return [lf.path, lf.name, 'file', lf.size, lf.server_modified, lf.client_modified,
      path.extname(lf.name).slice(1).toLowerCase(), top, false, false, false].map(esc).join(',');
  });
  await fsp.writeFile(path.join(SB, 'dist/inventory/non-grants-inventory.csv'), text.replace(/\n?$/, '\n') + add.join('\n') + '\n');
}

// departments-mapping.mjs, minus its chdir into the repo.
{
  const src = await fsp.readFile('scripts/departments-mapping.mjs', 'utf8');
  const edits = [
    ["process.chdir('/Users/Chris/grant-card-assistant');\n", '// [delta sandbox] process.chdir removed\n'],
    ["from './grants-lib.mjs'", `from '${REPO}/scripts/grants-lib.mjs'`],
    ["from './mapping-lib.mjs'", `from '${REPO}/scripts/mapping-lib.mjs'`],
  ];
  let s = src;
  for (const [a, b] of edits) {
    if (s.split(a).length !== 2) { log(`ABORT: departments-mapping.mjs no longer contains exactly one ${JSON.stringify(a)}`); process.exit(1); }
    s = s.replace(a, b);
  }
  await fsp.writeFile(path.join(SB, 'scripts/departments-mapping.mjs'), s);
}

// ---------------------------------------------------------------- run the pipeline
const run = (script) => {
  log(`\n--- running ${script} in sandbox`);
  const out = execFileSync(process.execPath, ['--max-old-space-size=8192', script], { cwd: SB, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  return out;
};
let fullLog, deptLog;
try {
  fullLog = run(`${REPO}/scripts/full-mapping.mjs`);
  deptLog = run(path.join(SB, 'scripts/departments-mapping.mjs'));
} catch (err) {
  log(`ABORT: pipeline run failed (exit ${err.status})\n${String(err.stderr).slice(-3000)}`);
  process.exit(1);
}

// ---------------------------------------------------------------- equivalence
/** Only the retention cutoff date in an archive reason may legitimately differ: it is computed from "now". */
const norm = (line) => line.replace(/newer than \d{4}-\d{2}-\d{2}/, 'newer than <cutoff>');
function equivalence(committedPath, sandboxPath, newSources) {
  const committed = readLines(committedPath);
  const sandbox = readLines(sandboxPath);
  const header = committed[0] === sandbox[0];
  const oldSb = sandbox.slice(1).filter((l) => !newSources.has(splitLine(l)[0]));
  const newSb = sandbox.slice(1).filter((l) => newSources.has(splitLine(l)[0]));
  const a = committed.slice(1);
  let exact = a.length === oldSb.length, normalized = exact, order = exact;
  const diffs = [];
  if (a.length === oldSb.length) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== oldSb[i]) { exact = false; if (norm(a[i]) !== norm(oldSb[i])) { normalized = false; if (diffs.length < 10) diffs.push({ committed: a[i], sandbox: oldSb[i] }); } }
    }
  } else {
    // Different row counts: fall back to a multiset comparison to locate the drift.
    order = false;
    const m = new Map();
    for (const l of a) m.set(norm(l), (m.get(norm(l)) ?? 0) + 1);
    for (const l of oldSb) m.set(norm(l), (m.get(norm(l)) ?? 0) - 1);
    for (const [k, v] of m) if (v !== 0 && diffs.length < 10) diffs.push({ line: k, count_delta: v });
    normalized = [...m.values()].every((v) => v === 0);
  }
  return { header_identical: header, committed_rows: a.length, sandbox_old_rows: oldSb.length, sandbox_new_rows: newSb.length,
    byte_identical: exact, identical_after_cutoff_normalization: normalized, same_order: order, diffs, newLines: newSb };
}
const grantsSources = new Set(srcOf.keys());
const eqFull = equivalence('dist/inventory/full-mapping.csv', path.join(SB, 'dist/inventory/full-mapping.csv'), grantsSources);
const deptSources = new Set(deptNew.map((r) => live.get(r.path.toLowerCase()).path));
const eqDept = equivalence('dist/inventory/departments-mapping.csv', path.join(SB, 'dist/inventory/departments-mapping.csv'), deptSources);
log(`\nfull-mapping equivalence: ${eqFull.committed_rows} committed vs ${eqFull.sandbox_old_rows} regenerated — byte-identical ${eqFull.byte_identical}, after cutoff normalization ${eqFull.identical_after_cutoff_normalization}`);
log(`departments equivalence: ${eqDept.committed_rows} committed vs ${eqDept.sandbox_old_rows} regenerated — byte-identical ${eqDept.byte_identical}`);
if (!eqFull.identical_after_cutoff_normalization || !eqDept.identical_after_cutoff_normalization) {
  log('ABORT: the pipeline no longer reproduces the committed sheets — new rows shifted existing destinations.');
  log(JSON.stringify({ full: eqFull.diffs, dept: eqDept.diffs }, null, 2).slice(0, 4000));
  process.exit(1);
}

const GHEAD = splitLine(readLines('dist/inventory/full-mapping.csv')[0]);
const DHEAD = splitLine(readLines('dist/inventory/departments-mapping.csv')[0]);
const toObj = (h, line) => Object.fromEntries(h.map((k, i) => [k, splitLine(line)[i] ?? '']));
const grantRows = eqFull.newLines.map((l) => toObj(GHEAD, l));
const deptRows = eqDept.newLines.map((l) => toObj(DHEAD, l));

// ---------------------------------------------------------------- CanExport review rows
// Review-pile routing, lifted verbatim from full-mapping.mjs. Kept byte-for-byte
// in its decisions; only the variable names around it are local.
const PROGRAM_MATERIAL = /(^|[\s_\-*])(forms?|reference|refs?|docs?|documents?|templates?|govt documents?|government documents?|application forms?)([\s_\-:]|$)/i;
const sseg = (seg) => seg.replace(/\s*:\s*/g, ' - ').replace(/\s+/g, ' ').trim();
const spath = (segs) => segs.map(sseg).join('/');
const carrySources = new Set(carry.map((r) => r.path));
const ceRows = [];
{
  const lines = readLines('dist/inventory/canexport-mapping.csv');
  const h = splitLine(lines[0]);
  for (const l of lines.slice(1)) {
    const r = toObj(h, l);
    if (r.route !== 'review' || !carrySources.has(r.source_path)) continue;
    const segs = r.source_path.slice(GRANTS_PREFIX.length).split('/');
    const fname = segs[segs.length - 1];
    const program = segs[0];
    const belowProgram = segs.slice(1, -1);
    const subPath = belowProgram.length ? '/' + spath(belowProgram) : '';
    const isNoClient = r.reason === 'no client folder above this file';
    const isUnclear = /is labelled unclear, not a client$/.test(r.reason);
    const isJoint = /joint-client folder/.test(r.reason);
    if (isJoint) {
      r.destination_path = r.destination_path.replace(/^Review\//, `${CLIENTS_ROOT}/`);
      r.route = 'sort'; r.confidence = 'medium';
      r.reason = 'joint-client folder — dual-filed to both clients, one row each';
    } else if (isNoClient && segs.length === 1) {
      r.destination_path = `Programs/_Unfiled/${fname}`; r.route = 'program'; r.confidence = 'low';
      r.reason = 'sits directly under Grants/ with no program folder above it';
    } else if (isNoClient) {
      const viaProgram = PROGRAM_MATERIAL.test(program);
      const firstFolder = belowProgram[0];
      const viaFolder = !viaProgram && firstFolder && PROGRAM_MATERIAL.test(firstFolder);
      if (viaProgram || viaFolder) {
        r.destination_path = `Programs/${sseg(program)}${subPath}/${fname}`; r.route = 'program'; r.confidence = 'medium';
        r.reason = `program material — ${viaProgram ? `program folder "${program}"` : `folder "${firstFolder}"`} names it as such`;
      } else {
        r.destination_path = `Programs/${sseg(program)}/_Unfiled${subPath}/${fname}`; r.route = 'program'; r.confidence = 'low';
        r.reason = 'no client folder above this file and no program-material signal — unfiled under its program';
      }
    } else if (isUnclear) {
      r.destination_path = `Programs/${sseg(program)}/_Unfiled${subPath}/${fname}`; r.route = 'program'; r.confidence = 'low';
      r.reason = 'top folder labelled unclear, not a client — unfiled under its program';
    }
    ceRows.push(r);
  }
}
const driveFolders = readLines(path.join(DIR, 'drive-folders.txt'));
const ceFold = foldDestinationCase(ceRows.map((r) => Object.assign(r, { src: r.source_path, dest: r.destination_path })), driveFolders);
for (const r of ceRows) { r.destination_path = r.dest; delete r.src; delete r.dest; }

// ---------------------------------------------------------------- coverage
const unrouted = [];
const destsBySource = new Map();
for (const r of [...grantRows, ...ceRows]) {
  if (!COPY_ROUTES.has(r.route)) unrouted.push({ source: r.source_path, route: r.route, reason: r.reason });
  if (!destsBySource.has(r.source_path)) destsBySource.set(r.source_path, []);
  destsBySource.get(r.source_path).push(r.destination_path);
}
for (const r of deptRows) {
  if (!COPY_ROUTES.has(r.route)) unrouted.push({ source: r.source_path, route: r.route, reason: r.reason });
  if (!destsBySource.has(r.source_path)) destsBySource.set(r.source_path, []);
  destsBySource.get(r.source_path).push(r.destination_path);
}
const expectedSources = [...grantsSources, ...deptSources, ...carrySources];
const missingSources = expectedSources.filter((s) => !destsBySource.has(s));
const extraSources = [...destsBySource.keys()].filter((s) => !expectedSources.includes(s));

// ---------------------------------------------------------------- Step 4: collisions
const deltaRows = [...grantRows, ...ceRows, ...deptRows];
const existing = new Map();       // dest -> where it is already occupied
const existingLower = new Map();
const occupy = (d, why) => { if (!existing.has(d)) existing.set(d, why); if (!existingLower.has(d.toLowerCase())) existingLower.set(d.toLowerCase(), d); };
for (const l of readLines(path.join(DIR, 'drive-files.jsonl'))) occupy(JSON.parse(l).path, 'present in Drive');
for (const [sheet, ri, di] of [['full-mapping.csv', 7, 5], ['canexport-mapping.csv', 7, 5], ['departments-mapping.csv', 8, 3]]) {
  for (const l of readLines(`dist/inventory/${sheet}`).slice(1)) {
    const c = splitLine(l);
    if (COPY_ROUTES.has(c[ri])) occupy(c[di], `mapped in ${sheet}`);
  }
}
const vsExisting = deltaRows.filter((r) => existing.has(r.destination_path)).map((r) => ({ dest: r.destination_path, source: r.source_path, occupied_by: existing.get(r.destination_path) }));
const vsExistingCase = deltaRows.filter((r) => !existing.has(r.destination_path) && existingLower.has(r.destination_path.toLowerCase()))
  .map((r) => ({ dest: r.destination_path, source: r.source_path, existing: existingLower.get(r.destination_path.toLowerCase()) }));
const within = new Map();
for (const r of deltaRows) { if (!within.has(r.destination_path)) within.set(r.destination_path, new Set()); within.get(r.destination_path).add(r.source_path); }
const withinCollisions = [...within.entries()].filter(([, s]) => s.size > 1).map(([d, s]) => ({ dest: d, sources: [...s] }));

// ---------------------------------------------------------------- clients, shortcuts, years
const status = new Map();
for (const l of readLines('dist/inventory/client-status.csv').slice(1)) { const c = splitLine(l); status.set(c[0], c[1]); }
const driveFolderSet = new Set(driveFolders);
const clientFolders = new Map();
for (const r of deltaRows) {
  if (!r.destination_path.startsWith(`${CLIENTS_ROOT}/`)) continue;
  const name = r.destination_path.split('/')[1];
  if (!clientFolders.has(name)) clientFolders.set(name, { name, rows: 0, exists_in_drive: driveFolderSet.has(`${CLIENTS_ROOT}/${name}`), status: status.get(name) ?? '(no status row)' });
  clientFolders.get(name).rows += 1;
}
const tally = (arr, fn) => { const m = new Map(); for (const x of arr) { const k = fn(x); m.set(k, (m.get(k) ?? 0) + 1); } return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1])); };
const bytesOf = (src) => live.get(src.toLowerCase())?.size ?? 0;

// ---------------------------------------------------------------- outputs
const writeSheet = async (file, head, rows) => {
  await fsp.writeFile(path.join(DIR, file), [head.join(','), ...rows.map((r) => head.map((k) => esc(r[k])).join(','))].join('\n') + '\n');
};
await writeSheet('delta-grants-mapping.csv', GHEAD, [...grantRows, ...ceRows]);
await writeSheet('delta-departments-mapping.csv', DHEAD, deptRows);

const zanRows = grantRows.filter((r) => /2026 : 2027 Intake\/Zanzibar\//.test(r.source_path));
const knownNameRows = grantRows.filter((r) => /\/Talent Opportunities\/Horizon\/|2026 : 2027 Intake\/Tradable Bits\//.test(r.source_path));
const report = {
  generated: new Date().toISOString(),
  copy_set: { sources: copySet.length, grants_new: grantsNew.length, departments_new: deptNew.length, canexport_carryover: carry.length },
  held_back_triage: triage.map((r) => ({ path: r.path, size: r.size })),
  sandbox_inputs: { grants_inventory_rows_appended: invAppend.length, grants_folders_appended: addedFolders.size, department_files_appended: deptNew.length, recased_source_paths: recased },
  equivalence: {
    full_mapping: { ...eqFull, newLines: undefined },
    departments_mapping: { ...eqDept, newLines: undefined },
  },
  rows: { grants: grantRows.length, canexport_carryover: ceRows.length, departments: deptRows.length, total: deltaRows.length,
    distinct_sources: destsBySource.size, bytes: [...destsBySource.keys()].reduce((s, p) => s + bytesOf(p), 0) },
  coverage: { missing_sources: missingSources, extra_sources: extraSources, unrouted },
  by_route: tally(deltaRows, (r) => r.route),
  by_year_source: tally([...grantRows, ...ceRows], (r) => r.year_source || '(none)'),
  by_program: tally([...grantRows, ...ceRows], (r) => r.program),
  canexport_case_folded: ceFold.changed,
  collisions: { vs_existing_exact: vsExisting, vs_existing_case_only: vsExistingCase, within_delta: withinCollisions, total: vsExisting.length + withinCollisions.length },
  client_folders: [...clientFolders.values()].sort((a, b) => b.rows - a.rows),
  zanzibar: zanRows.map((r) => ({ source: r.source_path, dest: r.destination_path, client: r.client, year: r.year, year_source: r.year_source, route: r.route })),
  known_name_new_folder: knownNameRows.map((r) => ({ source: r.source_path, dest: r.destination_path, client: r.client, year: r.year, year_source: r.year_source, route: r.route })),
  canexport_rows: ceRows.map((r) => ({ source: r.source_path, dest: r.destination_path, client: r.client, route: r.route })),
  departments: deptRows.map((r) => ({ source: r.source_path, dest: r.destination_path })),
  pipeline_logs: { full_mapping: fullLog.slice(-1500), departments: deptLog.slice(-1500) },
};
await fsp.writeFile(path.join(DIR, 'mapping-report.json'), JSON.stringify(report, null, 2));
const { pipeline_logs, canexport_rows, departments, ...brief } = report;
console.log(JSON.stringify(brief, null, 2));
if (missingSources.length || unrouted.length || report.collisions.total) process.exit(3);
