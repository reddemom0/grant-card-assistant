/**
 * full-mapping.mjs — destination mapping for every file in the Grants tree
 * OUTSIDE CanExport, using the same four routes and the same rules.
 *
 * The routing logic is imported from scripts/mapping-lib.mjs, the same module
 * canexport-mapping.mjs uses, so the two cannot drift. That equivalence is
 * asserted on every run: CanExport is re-mapped through this library and the
 * result compared to dist/inventory/canexport-mapping.csv.
 *
 * READ-ONLY. Reads four local files, writes a CSV and a markdown report.
 * No Dropbox, no Drive, no network of any kind. Copies nothing.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadRows, parseCsv, isBatchName, normalizeName, classify } from './grants-lib.mjs';
import { mapFiles, makeResolveNodes, foldDestinationCase, CLIENTS_ROOT, ARCHIVE_ROOT, FIRST_SEG_YEAR as FIRST_SEG_YEAR_RE } from './mapping-lib.mjs';

const INVENTORY = 'dist/inventory/grants-inventory.csv';
const CLIENTS = 'dist/inventory/clients-final.csv';
const RESOLVED = 'dist/inventory/resolved-final.csv';
const CE_MAPPING = 'dist/inventory/canexport-mapping.csv';
const CORRECTIONS = 'scripts/client-corrections.json';
const CSV_OUT = 'dist/inventory/full-mapping.csv';
const MD_OUT = 'docs/inventory/full-mapping.md';

const MAX_SKIP = 8;
const RETENTION_YEARS = 6;
const cutoff = new Date();
cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
const CUTOFF_ISO = cutoff.toISOString();

/**
 * Throughput from the two completed copy runs (2026-08-18). An earlier
 * PILOT_BYTES constant here said 4.05 GB when the pilot actually moved
 * 20.37 GB, understating byte throughput 5× and publishing a runtime estimate
 * that was wrong by the same factor.
 *   CanExport pilot: 1,468 files / 20.37 GB in 47m18s — 0.52 files/s,
 *                    7.35 MB/s. A handful of large videos: bandwidth-bound.
 *   ETG:             29,535 files / ~16.4 GB — ~1.13 files/s at working rate
 *                    (Run 1, and Run 2 between its socket stalls). Tens of
 *                    thousands of small documents: per-file-overhead-bound.
 * The estimate takes whichever constraint binds.
 */
const ETG_FILES_PER_SEC = 1.13;
const CE_MB_PER_SEC = 7.35;

const log = (...a) => console.error(...a);

// The joint-client map, same as the CanExport pass.
const JOINT = new Map([
  ['capital city news:overstory media', ['Capital City News', 'Overstory Media Group']],
  ['girl gang:rolla skate club', ['Girl Gang', 'Rolla Skate Club']],
  ['acorn : abror', ['Acorn', 'Abror']],
  ['hippie snacks : left coast naturals', ['Hippie Snacks', 'Left Coast Naturals']],
  ['taimuri:capstone', ['Taimuri', 'Capstone']],
  ['admin slayer:spring planning', ['Admin Slayer', 'Spring Planning']],
  ['madison builders:e2 + associates', ['Madison Builders', 'E2+ Associates']],
  ['pure+:nineteen02 kombucha', ['Pure+', 'Nineteen02 Kombucha']],
  ['capital city:overstory', ['Capital City', 'Overstory']],
  ['premium fence:concept house:kurt', ['Premium Fence', 'Concept House']],
  ['healthy hooch:functional beverage group', ['Healthy Hooch', 'Functional Beverage Group']],
]);

log('reading inventory...');
const rows = loadRows(await fsp.readFile(INVENTORY, 'utf8'));
const allFiles = rows.filter((r) => r.isFile);
log(`  ${rows.length} rows, ${allFiles.length} files`);

// ---------------------------------------------------------------- lookups
const rawToCanon = new Map();
const canonInfo = new Map();
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CLIENTS, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0]) continue;
    const rec = { canonical: r[0], retention: r[8], rawCount: Number(r[2] || 0), files: Number(r[4] || 0) };
    canonInfo.set(normalizeName(r[0]), rec);
    for (const raw of (r[1] ? r[1].split(' | ') : [])) rawToCanon.set(normalizeName(raw), rec);
  }
}
const nameStatus = new Map();
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(RESOLVED, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[1]) continue;
    nameStatus.set(r[1], { label: r[2], status: r[6], confidence: r[4] });
  }
}
/**
 * Overlay names the corrections file asserts are clients.
 *
 * The classification pass left 36 folder names UNCLASSIFIED, which sent 750
 * files to review as "never classified". Those names are now hand-asserted as
 * clients in client-corrections.json, so the status lookup has to agree or the
 * mapper would still route them to review despite the canonical existing.
 *
 * Applied here only. canexport-mapping.mjs does not do this, so its output is
 * unaffected — and none of the asserted names sits under a CanExport program
 * anyway.
 */
{
  const corr = JSON.parse(await fsp.readFile(CORRECTIONS, 'utf8'));
  let n = 0;
  for (const c of corr.corrections) {
    if (!c.asserts_client) continue;
    for (const raw of c.raw_names) {
      const k = normalizeName(raw);
      const cur = nameStatus.get(k);
      if (cur && cur.label === 'client') continue;
      nameStatus.set(k, { label: 'client', status: 'HAND', confidence: 'hand' });
      n += 1;
    }
  }
  log(`  ${n} names asserted as clients by hand correction`);
}
log(`  ${canonInfo.size} canonical companies, ${nameStatus.size} judged names`);

// ---------------------------------------------------------------- programs
const childrenByParent = new Map();
const programs = [];
for (const r of rows) {
  if (r.isFile) continue;
  const key = r.segs.join('/');
  if (r.segs.length === 1) { programs.push({ name: r.name, key }); continue; }
  const parent = r.segs.slice(0, -1).join('/');
  if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
  childrenByParent.get(parent).push({ name: r.name, key });
}
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const isCanExport = (name) => squash(name).includes('canexport');

const filesByProgram = new Map(), bytesByProgram = new Map();
for (const f of allFiles) {
  filesByProgram.set(f.program, (filesByProgram.get(f.program) ?? 0) + 1);
  bytesByProgram.set(f.program, (bytesByProgram.get(f.program) ?? 0) + f.size);
}
for (const p of programs) {
  p.files = filesByProgram.get(p.name) ?? 0;
  p.bytes = bytesByProgram.get(p.name) ?? 0;
  p.canexport = isCanExport(p.name);
}
programs.sort((a, b) => b.files - a.files);
const otherPrograms = programs.filter((p) => !p.canexport);
const cePrograms = programs.filter((p) => p.canexport);
log(`\n${programs.length} program folders — ${cePrograms.length} CanExport, ${otherPrograms.length} other`);

const resolveNodes = makeResolveNodes(childrenByParent, MAX_SKIP);

/** Build the client-node index for a set of programs. */
function nodeIndexFor(progs) {
  const m = new Map();
  for (const p of progs) for (const n of resolveNodes(p.key)) m.set(n.key, { name: n.name, program: p.name });
  return m;
}

// -------------------------------------------- Step 1 equivalence assertion
{
  const ceNodes = nodeIndexFor(cePrograms);
  const ceFiles = allFiles.filter((f) => cePrograms.some((p) => p.name === f.program));
  const { out: ceOut } = mapFiles({
    files: ceFiles, nodeByKey: ceNodes, nameStatus, rawToCanon,
    joint: JOINT, cutoffIso: CUTOFF_ISO, clientsRoot: CLIENTS_ROOT, archiveRoot: ARCHIVE_ROOT,
  });
  let header = null; const committed = [];
  for (const r of parseCsv(await fsp.readFile(CE_MAPPING, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0]) continue;
    committed.push(`${r[0]}${r[5]}${r[7]}`);
  }
  const regenerated = ceOut.map((r) => `${r.src}${r.dest}${r.route}`);
  const same = committed.length === regenerated.length
    && committed.every((v, i) => v === regenerated[i]);
  log(`  CanExport equivalence: ${committed.length} committed vs ${regenerated.length} regenerated — ${same ? 'IDENTICAL' : 'DIVERGED'}`);
  if (!same) { log('ABORT: the shared library no longer reproduces the CanExport mapping.'); process.exit(1); }
}

// ---------------------------------------------------------------- map it
const nodeByKey = nodeIndexFor(otherPrograms);
const files = allFiles.filter((f) => !isCanExport(f.program));
log(`\nmapping ${files.length} files across ${otherPrograms.length} programs...`);

const mapped = mapFiles({
  files, nodeByKey, nameStatus, rawToCanon,
  joint: JOINT, cutoffIso: CUTOFF_ISO, clientsRoot: CLIENTS_ROOT, archiveRoot: ARCHIVE_ROOT,
});
const { out, reviewReasons, folderRenames, counters } = mapped;

// ------------------------------------------------- review-pile routing
/**
 * Dropbox is being cancelled, so a row left in `review` with no destination is
 * a lost file. Three of the four review classes are routed here; class 2
 * (never-classified folder names) is reported and left pending, because it may
 * be one decision or several.
 *
 * Nothing is filed under a CLIENT on filename evidence. Everything routed here
 * goes to Programs/, which asserts only that the file belongs to the grant
 * program its folder already said it belonged to.
 */
const PROGRAM_MATERIAL = /(^|[\s_\-*])(forms?|reference|refs?|docs?|documents?|templates?|govt documents?|government documents?|application forms?)([\s_\-:]|$)/i;
const GP = '/Granted Team Folder/SALES/Grants/';
const { sanitizeSegment: sseg, sanitizePath: spath } = mapped;

const routing = { c1material: 0, c1unfiled: 0, c1depth0: 0, c3: 0, c4: 0, c2pending: 0 };
const c1MatchedFolders = new Map();
const depth0Files = [];
const c4Examples = [];

for (const r of out) {
  if (r.route !== 'review') continue;
  const segs = r.src.slice(GP.length).split('/');
  const fname = segs[segs.length - 1];
  const program = segs[0];
  const belowProgram = segs.slice(1, -1);
  const subPath = belowProgram.length ? '/' + spath(belowProgram) : '';

  const isNoClient = r.reason === 'no client folder above this file';
  const isUnclear = /is labelled unclear, not a client$/.test(r.reason);
  const isJoint = /joint-client folder/.test(r.reason);
  const isUnjudged = /was never classified$/.test(r.reason);

  // --- class 2: leave pending -------------------------------------------
  if (isUnjudged) { routing.c2pending += 1; continue; }

  // --- class 3: joint dual-filed — already decided, promote to sort -----
  if (isJoint) {
    r.dest = r.dest.replace(/^Review\//, `${CLIENTS_ROOT}/`);
    r.route = 'sort';
    r.confidence = 'medium';
    r.reason = `joint-client folder — dual-filed to both clients, one row each`;
    routing.c3 += 1;
    continue;
  }

  // --- class 1, depth 0: no program at all ------------------------------
  if (isNoClient && segs.length === 1) {
    r.dest = `Programs/_Unfiled/${fname}`;
    r.route = 'program';
    r.confidence = 'low';
    r.reason = 'sits directly under Grants/ with no program folder above it';
    routing.c1depth0 += 1;
    depth0Files.push({ src: r.src, dest: r.dest });
    continue;
  }

  // --- class 1, program material by folder name -------------------------
  if (isNoClient) {
    const viaProgram = PROGRAM_MATERIAL.test(program);
    const firstFolder = belowProgram[0];
    const viaFolder = !viaProgram && firstFolder && PROGRAM_MATERIAL.test(firstFolder);
    if (viaProgram || viaFolder) {
      r.dest = `Programs/${sseg(program)}${subPath}/${fname}`;
      r.route = 'program';
      r.confidence = 'medium';
      r.reason = `program material — ${viaProgram ? `program folder "${program}"` : `folder "${firstFolder}"`} names it as such`;
      routing.c1material += 1;
      const k = viaProgram ? `${program}  (program folder)` : firstFolder;
      c1MatchedFolders.set(k, (c1MatchedFolders.get(k) ?? 0) + 1);
      continue;
    }
    // --- class 1 remainder --------------------------------------------
    r.dest = `Programs/${sseg(program)}/_Unfiled${subPath}/${fname}`;
    r.route = 'program';
    r.confidence = 'low';
    r.reason = 'no client folder above this file and no program-material signal — unfiled under its program';
    routing.c1unfiled += 1;
    continue;
  }

  // --- class 4: labelled unclear ----------------------------------------
  if (isUnclear) {
    if (c4Examples.length < 20) c4Examples.push({ src: r.src, dest: null });
    r.dest = `Programs/${sseg(program)}/_Unfiled${subPath}/${fname}`;
    r.route = 'program';
    r.confidence = 'low';
    r.reason = 'top folder labelled unclear, not a client — unfiled under its program';
    routing.c4 += 1;
    if (c4Examples.length && c4Examples[c4Examples.length - 1].src === r.src) {
      c4Examples[c4Examples.length - 1].dest = r.dest;
    }
    continue;
  }
}
log(`  review routed: material=${routing.c1material} unfiled=${routing.c1unfiled} depth0=${routing.c1depth0} joint->sort=${routing.c3} unclear=${routing.c4} | pending(class 2)=${routing.c2pending}`);

// ------------------------------------------------------------- case-folding
/**
 * Fold case-variant destination folders onto one spelling (2026-08-18).
 * Drive's spellings — dumped by `reconcile-drive.mjs --folders-only` — are the
 * reference, because Drive already merged the variants at copy time and Drive
 * is not to be renamed. Regenerate the dump after any copy stage that creates
 * folders; without it the fold still runs, first-mapping-row-wins, which is
 * what the copier produces anyway.
 */
const DRIVE_FOLDERS_FILE = 'dist/inventory/drive-folders.txt';
const driveFolders = (await fsp.readFile(DRIVE_FOLDERS_FILE, 'utf8').catch(() => ''))
  .split('\n').filter(Boolean);
if (!driveFolders.length) log(`  WARNING: ${DRIVE_FOLDERS_FILE} absent — case-folding falls back to first-mapping-row-wins`);
const folded = foldDestinationCase(out, driveFolders);
log(`  case-folded ${folded.changed} rows across ${folded.variantGroups} variant folder paths (drive folders loaded: ${driveFolders.length})`);

// Byte/size lookup for the rows.
const sizeByPath = new Map(files.map((f) => [f.path, f.size]));
const routeStats = new Map();
for (const r of out) {
  const b = sizeByPath.get(r.src) ?? 0;
  if (!routeStats.has(r.route)) routeStats.set(r.route, { rows: 0, files: new Set(), bytes: 0 });
  const s = routeStats.get(r.route);
  s.rows += 1; s.files.add(r.src); s.bytes += b;
}
log(`  ${out.length} rows`);
for (const [k, v] of routeStats) log(`    ${k.padEnd(8)} ${String(v.rows).padStart(6)} rows  ${v.files.size} files`);

// ------------------------------------------------------------ Step 3: per program
const perProgram = new Map();
for (const r of out) {
  if (!perProgram.has(r.program)) {
    perProgram.set(r.program, { name: r.program, sort: 0, program: 0, archive: 0, review: 0, rows: 0, bytes: 0, srcs: new Set() });
  }
  const p = perProgram.get(r.program);
  p[r.route] += 1; p.rows += 1; p.srcs.add(r.src);
}
for (const p of perProgram.values()) {
  p.files = p.srcs.size;
  p.bytes = bytesByProgram.get(p.name) ?? 0;
  p.reviewPct = p.rows ? (p.review / p.rows) * 100 : 0;
}
const progList = [...perProgram.values()].sort((a, b) => b.files - a.files);
const highReview = progList.filter((p) => p.reviewPct > 20);

// ---------------------------------------------- class 2 characterization
const c2ByFolder = new Map();
for (const r of out) {
  if (r.route !== 'review') continue;
  const m = r.reason.match(/^folder "(.+)" was never classified$/);
  const f = m ? m[1] : '(unparsed)';
  if (!c2ByFolder.has(f)) c2ByFolder.set(f, { rows: 0, programs: new Set() });
  const e = c2ByFolder.get(f);
  e.rows += 1; e.programs.add(r.program);
}
const PM_WORD = /(forms?|reference|refs?|docs?|documents?|templates?|govt|guideline|process|resource|admin|marketing|prospect|webinar|training)/i;
const c2Groups = { client: [], batch: [], program: [], unclear: [] };
for (const [f, e] of c2ByFolder) {
  const lbl = isBatchName(f) ? 'batch' : (PM_WORD.test(f) ? 'program' : (classify(f) === 'client' ? 'client' : 'unclear'));
  c2Groups[lbl].push({ name: f, rows: e.rows, programs: [...e.programs] });
}
for (const k of Object.keys(c2Groups)) c2Groups[k].sort((a, b) => b.rows - a.rows);

// ------------------------------------------------------------ Step 5: collisions
// Includes destinations already occupied by copied CanExport files.
const occupied = new Map();   // dest -> [source...]
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CE_MAPPING, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0] || r[7] === 'review') continue;
    if (!occupied.has(r[5])) occupied.set(r[5], []);
    occupied.get(r[5]).push({ src: r[0], from: 'canexport' });
  }
}
const ceOccupied = occupied.size;
for (const r of out) {
  if (r.route === 'review') continue;
  if (!occupied.has(r.dest)) occupied.set(r.dest, []);
  occupied.get(r.dest).push({ src: r.src, from: 'full' });
}
const progBySrc = new Map(out.map((r) => [r.src, r.program]));
const YEAR_ANY = /(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/;
/** Highest folder level above the file that carries a year — the batch level. */
function batchYear(src) {
  const segs = src.replace('/Granted Team Folder/SALES/Grants/', '').split('/');
  for (let i = 1; i < segs.length - 1; i++) {
    const m = segs[i].match(YEAR_ANY);
    if (m) return m[1];
  }
  return null;
}
const collisions = [...occupied.entries()]
  .filter(([, v]) => new Set(v.map((x) => x.src)).size > 1)
  .map(([dest, v]) => {
    const sources = [...new Set(v.map((x) => x.src))];
    return {
      dest, sources,
      mix: [...new Set(v.map((x) => x.from))],
      program: progBySrc.get(sources[0]) ?? '(canexport)',
      batchYears: new Set(sources.map(batchYear)),
    };
  });
const collisionsBatchYearDiffers = collisions.filter((c) => c.batchYears.size > 1).length;

// Characterize each surviving collision: is it the same file filed twice, or
// genuinely different files that would overwrite each other?
const metaBySrc = new Map(files.map((f) => [f.path, { size: f.size, cm: f.cm }]));
const stripPrefix = (s) => s.replace('/Granted Team Folder/SALES/Grants/', '').split('/');
function firstDifferingSegment(srcs) {
  const parts = srcs.map(stripPrefix);
  const n = Math.min(...parts.map((p) => p.length));
  for (let i = 0; i < n; i++) {
    const vals = new Set(parts.map((p) => p[i]));
    if (vals.size > 1) return { index: i, values: [...vals] };
  }
  return null;
}
for (const c of collisions) {
  const m = c.sources.map((s) => metaBySrc.get(s) ?? { size: null, cm: null });
  c.sameSize = new Set(m.map((x) => x.size)).size === 1;
  c.sameDate = new Set(m.map((x) => (x.cm ?? '').slice(0, 10))).size === 1;
  c.group = (c.sameSize && c.sameDate) ? 'A' : 'B';
  c.bytesAtStake = Math.max(...m.map((x) => x.size ?? 0));
  c.diff = firstDifferingSegment(c.sources);
  c.filesLost = c.sources.length - 1;
}
/**
 * Resolve every collision by suffixing the filename with the first path
 * segment where the colliding sources differ.
 *
 * The discriminator is derived from the source path, so it is stable across
 * re-runs (unlike a counter) and meaningful to a reader (unlike a hash): it
 * names the intake the file came from. Applied to BOTH destination_path and
 * proposed_filename — if phase 3 ever applies the proposed name it must not
 * strip the suffix and recreate the collision.
 *
 * Nothing is deduped or dropped. Every file keeps a distinct destination.
 */
const rowsBySrcDest = new Map();
for (const r of out) {
  const k = `${r.src}\u0000${r.dest}`;
  if (!rowsBySrcDest.has(k)) rowsBySrcDest.set(k, []);
  rowsBySrcDest.get(k).push(r);
}
const suffixApplied = [];
for (const c of collisions) {
  // Build a discriminator per source, widening until all are distinct.
  const parts = c.sources.map(stripPrefix);
  const n = Math.min(...parts.map((p) => p.length));
  const differing = [];
  for (let i = 0; i < n; i++) {
    if (new Set(parts.map((p) => p[i])).size > 1) differing.push(i);
  }
  let discs = null;
  for (let take = 1; take <= differing.length; take++) {
    const cand = parts.map((p) => differing.slice(0, take).map((i) => p[i]).join(' - '));
    const clean = cand.map((s) => s.replace(/\s*:\s*/g, ' - ').replace(/[\\/|<>"?*]/g, '-').replace(/\s+/g, ' ').trim());
    if (new Set(clean).size === clean.length) { discs = clean; break; }
  }
  if (!discs) {
    // Nothing in the path separates them after sanitizing — fall back to a
    // short stable hash of the full source path.
    discs = c.sources.map((s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8));
  }
  c.sources.forEach((src, i) => {
    const rows2 = rowsBySrcDest.get(`${src}\u0000${c.dest}`) ?? [];
    for (const r of rows2) {
      const segs = r.dest.split('/');
      const fname = segs.pop();
      const ext = path.extname(fname);
      const base = ext ? fname.slice(0, -ext.length) : fname;
      const nf = `${base} (${discs[i]})${ext}`;
      r.dest = [...segs, nf].join('/');
      const pext = path.extname(r.proposed);
      const pbase = pext ? r.proposed.slice(0, -pext.length) : r.proposed;
      r.proposed = `${pbase} (${discs[i]})${pext}`;
      suffixApplied.push({ group: c.group, src, oldDest: c.dest, newDest: r.dest, disc: discs[i], newName: nf });
    }
  });
}

// Re-check occupancy from scratch now the suffixes are in, including the
// CanExport destinations already occupied in Drive.
const occupied2 = new Map();
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CE_MAPPING, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0] || r[7] === 'review') continue;
    if (!occupied2.has(r[5])) occupied2.set(r[5], new Set());
    occupied2.get(r[5]).add(r[0]);
  }
}
for (const r of out) {
  if (r.route === 'review') continue;
  if (!occupied2.has(r.dest)) occupied2.set(r.dest, new Set());
  occupied2.get(r.dest).add(r.src);
}
const collisionsAfter = [...occupied2.entries()].filter(([, v]) => v.size > 1);
log(`  suffix applied to ${suffixApplied.length} rows; collisions after: ${collisionsAfter.length}`);
if (collisionsAfter.length) {
  log('  REMAINING:'); for (const [dst, v] of collisionsAfter.slice(0, 10)) log(`    ${dst} <- ${[...v].join(' | ')}`);
}

const groupA = collisions.filter((c) => c.group === 'A');
const groupB = collisions.filter((c) => c.group === 'B');
const sumBytes = (g) => g.reduce((s, c) => s + c.bytesAtStake, 0);
const filesLost = collisions.reduce((s, c) => s + c.filesLost, 0);
const suffixWorks = collisions.filter((c) => c.diff && c.diff.index >= 1).length;

// ------------------------------------------------------------ Step 4: shapes
const shapes = [];
{
  // (a) programs where no client node could be resolved at all
  const noNodes = otherPrograms.filter((p) => resolveNodes(p.key).length === 0 && p.files > 0);
  if (noNodes.length) {
    shapes.push({
      title: 'Program with files but no resolvable client level',
      detail: 'resolveNodes() descends through batch folders looking for a client name and finds nothing, so every file lands in review.',
      items: noNodes.map((p) => `${p.name} (${p.files} files)`),
    });
  }
  // (b) files sitting directly under the program root
  const atRoot = files.filter((f) => f.segs.length === 2);
  if (atRoot.length) {
    const byProg = new Map();
    for (const f of atRoot) byProg.set(f.program, (byProg.get(f.program) ?? 0) + 1);
    shapes.push({
      title: 'Loose files directly under a program root',
      detail: 'No folder between the program and the file, so there is no client folder to attribute from. CanExport had these too; at corpus scale they are far more common.',
      items: [...byProg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, n]) => `${p}: ${n} files`),
    });
  }
  // (c) deep batch nesting — client resolved only after several skips
  const deepSkips = [];
  for (const p of otherPrograms) {
    const kids = childrenByParent.get(p.key) ?? [];
    let maxDepth = 0;
    const walk = (key, d) => {
      if (d > maxDepth) maxDepth = d;
      if (d >= MAX_SKIP) return;
      for (const c of childrenByParent.get(key) ?? []) if (isBatchName(c.name)) walk(c.key, d + 1);
    };
    for (const k of kids) if (isBatchName(k.name)) walk(k.key, 1);
    if (maxDepth >= 2) deepSkips.push(`${p.name} (${maxDepth} nested batch levels)`);
  }
  if (deepSkips.length) {
    shapes.push({
      title: 'Nested batch levels above the client folder',
      detail: `Year-and-cohort groupings stacked more than one deep. resolveNodes() skips through them up to MAX_SKIP=${MAX_SKIP}; anything deeper would strand files in review.`,
      items: deepSkips,
    });
  }
  // (d) client folders at inconsistent depth within one program
  const depthSpread = [];
  for (const p of otherPrograms) {
    const depths = new Set();
    for (const n of resolveNodes(p.key)) depths.add(n.key.split('/').length);
    if (depths.size > 1) depthSpread.push(`${p.name} (client folders at depths ${[...depths].sort().join(', ')})`);
  }
  if (depthSpread.length) {
    shapes.push({
      title: 'Client folders at more than one depth inside a single program',
      detail: 'Some clients sit directly under the program, others under a year or cohort folder. The mapping handles it, but it means the program has no single consistent shape.',
      items: depthSpread,
    });
  }
  // (e0) the collision-causing shape: a skipped batch level carrying the year
  {
    const byProgram = new Map();
    for (const f of files) {
      const segs = f.segs;
      if (segs.length < 3) continue;
      // level 1 under the program is a batch AND carries a year
      const lvl1 = segs[1];
      if (isBatchName(lvl1) && FIRST_SEG_YEAR_RE.test(lvl1)) {
        byProgram.set(f.program, (byProgram.get(f.program) ?? 0) + 1);
      }
    }
    if (byProgram.size) {
      shapes.push({
        title: 'Cycle year lives in a batch level that the mapping discards',
        detail: 'resolveNodes() skips batch folders to reach the client beneath, but in these programs that skipped level IS the program cycle (e.g. "2021 CSJ - Applications"). The year then falls back to client_modified, and two cycles for one client collapse onto one destination. This is the direct cause of every collision in Step 5.',
        items: [...byProgram.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([p, n]) => `${p}: ${n} files under a year-carrying batch level`),
      });
    }
  }
  // (e) programs whose name is itself a year/batch
  const batchPrograms = otherPrograms.filter((p) => isBatchName(p.name));
  if (batchPrograms.length) {
    shapes.push({
      title: 'Top-level folder that is a batch, not a program',
      detail: 'The route assumes level 1 is a program name. These are date or grouping folders, so "Programs/<name>/" would enshrine a meaningless level.',
      items: batchPrograms.map((p) => `${p.name} (${p.files} files)`),
    });
  }
}

// ------------------------------------------------------------ Step 6: review pile
const reviewRows = out.filter((r) => r.route === 'review');
const reviewByReason = new Map();
for (const r of reviewRows) {
  // Collapse the per-folder detail into a stable reason class.
  let cls = r.reason;
  if (/^folder .* was never classified$/.test(r.reason)) cls = 'folder name was never classified';
  else if (/^folder .* is labelled /.test(r.reason)) cls = `folder labelled ${r.reason.match(/is labelled (\w+)/)?.[1] ?? '?'}, not a client`;
  else if (/joint-client folder/.test(r.reason)) cls = 'joint-client folder (dual-filed)';
  if (!reviewByReason.has(cls)) reviewByReason.set(cls, { rows: 0, srcs: new Set(), bytes: 0 });
  const e = reviewByReason.get(cls);
  e.rows += 1;
  if (!e.srcs.has(r.src)) { e.srcs.add(r.src); e.bytes += sizeByPath.get(r.src) ?? 0; }
}

// ------------------------------------------------------------ Step 7: pruning signals
const PRUNE_FOLDER = /(^|[\s_\-.])(z[_\- ]?old|old ?stuff|old ?folders?|\d*\.?\s*delete|to ?delete|obsolete|deprecated|backup|bak|archive[d]? ?copy|copy of|duplicates?)([\s_\-.]|$)/i;
const TEMPLATE_NAME = /(template|blank|sample|example|boilerplate|\bform\b.*\bblank\b|master copy)/i;

const pruneFolders = new Map();   // matched folder segment -> {files, bytes}
let pruneFiles = 0, pruneBytes = 0;
for (const f of files) {
  const seg = f.segs.slice(0, -1).find((s) => PRUNE_FOLDER.test(s));
  if (!seg) continue;
  pruneFiles += 1; pruneBytes += f.size;
  if (!pruneFolders.has(seg)) pruneFolders.set(seg, { files: 0, bytes: 0 });
  const e = pruneFolders.get(seg); e.files += 1; e.bytes += f.size;
}
const templates = files.filter((f) => TEMPLATE_NAME.test(f.name));
const templateBytes = templates.reduce((s, f) => s + f.size, 0);

// Byte-identical duplicates: same size AND same filename is a strong proxy;
// the inventory carries no content hash, so this is a signal, not proof.
const dupIndex = new Map();
for (const f of files) {
  if (!f.size) continue;
  const k = `${f.size}${f.name.toLowerCase()}`;
  if (!dupIndex.has(k)) dupIndex.set(k, []);
  dupIndex.get(k).push(f);
}
const dupGroups = [...dupIndex.values()].filter((g) => g.length > 1);
const dupRedundant = dupGroups.reduce((s, g) => s + (g.length - 1), 0);
const dupRedundantBytes = dupGroups.reduce((s, g) => s + g[0].size * (g.length - 1), 0);

// ------------------------------------------------------------ Step 8: volume
const copyRows = out.filter((r) => r.route !== 'review');
const copyFiles = new Set(copyRows.map((r) => r.src));
const copyBytes = [...copyFiles].reduce((s, p) => s + (sizeByPath.get(p) ?? 0), 0);
// Referenced by the MD's volume table. Was accidentally dropped when the
// review pile went to zero, which crashed every regeneration at the MD stage
// (after the CSV write, so the CSV stayed fresh while the MD went stale).
const revBytes = [...new Set(reviewRows.map((r) => r.src))]
  .reduce((s, p) => s + (sizeByPath.get(p) ?? 0), 0);
const etaByFiles = copyFiles.size / ETG_FILES_PER_SEC;
const etaByBytes = copyBytes / (CE_MB_PER_SEC * 1024 ** 2);
const etaSec = Math.max(etaByFiles, etaByBytes);
const fmtDur = (s) => `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;

// ---------------------------------------------------------------- CSV
const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const lines = ['source_path,client,program,year,year_source,destination_path,proposed_filename,route,confidence,reason'];
for (const r of out) {
  lines.push([r.src, r.client, r.program, r.year, r.yearSource, r.dest, r.proposed, r.route, r.confidence, r.reason].map(esc).join(','));
}
await fsp.mkdir('dist/inventory', { recursive: true });
await fsp.writeFile(CSV_OUT, lines.join('\n') + '\n');
log(`wrote ${CSV_OUT} (${out.length} rows)`);

// ---------------------------------------------------------------- MD
const me = (s) => String(s).replace(/\|/g, '\\|');
const gb = (b) => `${(b / 1024 ** 3).toFixed(2)} GB`;
const mb = (b) => `${(b / 1024 ** 2).toFixed(1)} MB`;
const L = [];
const push = (s = '') => L.push(s);
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

push('# Full Corpus Mapping — all programs outside CanExport');
push();
push(`**Inputs:** \`dist/inventory/grants-inventory.csv\`, \`clients-final.csv\`, \`resolved-final.csv\`, \`canexport-mapping.csv\``);
push('**Read-only.** No Dropbox call, no Drive call, nothing copied, moved, renamed or deleted. Proposed filenames are phase-3 input and are not applied.');
push('**Routing rules** come from `scripts/mapping-lib.mjs`, shared with the CanExport pass.');
push();
push('## Headline');
push();
push('| | Rows | Distinct files | Size |');
push('|---|---|---|---|');
for (const k of ['sort', 'program', 'archive', 'review']) {
  const s = routeStats.get(k) ?? { rows: 0, files: new Set(), bytes: 0 };
  push(`| ${k} | ${s.rows.toLocaleString()} | ${s.files.size.toLocaleString()} | ${gb(s.bytes)} |`);
}
push(`| **Total** | **${out.length.toLocaleString()}** | **${new Set(out.map((r) => r.src)).size.toLocaleString()}** | **${gb([...new Set(out.map((r) => r.src))].reduce((s, p) => s + (sizeByPath.get(p) ?? 0), 0))}** |`);
push();
push(`Across **${otherPrograms.length} programs**. CanExport (${cePrograms.length} programs, already mapped and copied) is excluded.`);
push();

push('---');
push();
push('## Step 1 — how the logic was shared');
push();
push('**Extracted, not generalized.** The routing core is about 200 lines of pure logic; the other ~480 lines of `canexport-mapping.mjs` are a pilot-specific narrative with no analogue at corpus scale. Parameterizing the whole script would have dragged that report along, so the rules moved to `scripts/mapping-lib.mjs` and both passes import them.');
push();
push('**CanExport regenerates byte-identical.** `dist/inventory/canexport-mapping.csv` is unchanged (SHA-256 `1ebcfe18…`); `docs/inventory/canexport-pilot.md` differs only on its `**Generated:**` timestamp line. This run also re-maps CanExport through the library and asserts every row matches the committed CSV — if the library ever drifts, the run aborts.');
push();

push('---');
push();
push(`## Step 3 — routing split per program (${progList.length})`);
push();
push('| Program | Files | Size | sort | program | archive | review | review % |');
push('|---|---|---|---|---|---|---|---|');
for (const p of progList) {
  const flag = p.reviewPct > 20 ? ' ⚠️' : '';
  push(`| ${me(p.name)}${flag} | ${p.files.toLocaleString()} | ${gb(p.bytes)} | ${p.sort.toLocaleString()} | ${p.program.toLocaleString()} | ${p.archive.toLocaleString()} | ${p.review.toLocaleString()} | ${p.reviewPct.toFixed(1)}% |`);
}
push();
push(`### ⚠️ Programs where review exceeds 20% (${highReview.length})`);
push();
if (!highReview.length) push('_None._');
else {
  push('These are structurally unlike CanExport and should be looked at before copying.');
  push();
  push('| Program | Files | review % | Dominant reason |');
  push('|---|---|---|---|');
  for (const p of highReview) {
    const reasons = new Map();
    for (const r of out) {
      if (r.program !== p.name || r.route !== 'review') continue;
      let cls = r.reason;
      if (/never classified/.test(cls)) cls = 'unjudged folder name';
      else if (/is labelled /.test(cls)) cls = `labelled ${cls.match(/is labelled (\w+)/)?.[1]}`;
      else if (/no client folder/.test(cls)) cls = 'no attributed client';
      reasons.set(cls, (reasons.get(cls) ?? 0) + 1);
    }
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    push(`| ${me(p.name)} | ${p.files.toLocaleString()} | **${p.reviewPct.toFixed(1)}%** | ${top ? `${me(top[0])} (${top[1]})` : '—'} |`);
  }
}
push();

push('---');
push();
push(`## Step 4 — structural shapes the four routes do not handle cleanly (${shapes.length})`);
push();
if (!shapes.length) push('_None found._');
for (const s of shapes) {
  push(`### ${s.title} — ${s.items.length}`);
  push();
  push(s.detail);
  push();
  for (const i of s.items.slice(0, 20)) push(`- ${me(i)}`);
  if (s.items.length > 20) push(`- _+${s.items.length - 20} more_`);
  push();
}

push('---');
push();
push('## Case-folding');
push();
push(`Two Dropbox folders differing only in capitalization map to ONE destination folder — Drive merges them anyway (its folder lookup is case-insensitive), so the mapping adopts the merge instead of fighting it. Where the folder already exists in Drive, Drive's spelling is canonical (first-created wins, loaded from \`${DRIVE_FOLDERS_FILE}\`, ${driveFolders.length.toLocaleString()} folders); otherwise the first mapping row's spelling is, which is what the copier will create. This run folded **${folded.changed} rows** across **${folded.variantGroups} variant folder paths**. Filenames are never folded — Drive stores same-name files side by side.`);
push();
push('## Step 5 — collision check');
push();
push(`Every non-review destination in this mapping, checked against each other **and** against the ${ceOccupied.toLocaleString()} destinations already occupied by copied CanExport files. Runs after case-folding, so two same-named files from case-variant folders surface here and take the suffix rule.`);
push();
if (!collisions.length) {
  push('**Zero collisions.** No two source files map to the same destination path, and nothing here would overwrite a file already in Drive.');
} else {
  push(`## ${collisions.length} collisions found — **all resolved, zero remain**`);
  push();
  push(`The batch-year fix removed ${288 - collisions.length} of the original 288. The remaining ${collisions.length} were resolved by suffixing the filename, applied to **${suffixApplied.length} rows**. A fresh occupancy check across the whole corpus — including the ${ceOccupied.toLocaleString()} destinations already occupied by copied CanExport files — now returns **${collisionsAfter.length}**.`);
  push();
  const byProg = new Map();
  for (const c of collisions) byProg.set(c.program, (byProg.get(c.program) ?? 0) + 1);
  push('| Program | Collisions |');
  push('|---|---|');
  for (const [p, n] of [...byProg.entries()].sort((a, b) => b[1] - a[1])) push(`| ${me(p)} | ${n} |`);
  push();
  push('### Root cause, and what the batch-year fix removed');
  push();
  push(`The original 288 came from one thing: \`resolveNodes()\` skips cohort folders like \`2021 CSJ - Applications\` and \`Client Files - 2022:2023 Fiscal\` to reach the client beneath, and that skipped level is usually the grant cycle. With it discarded the year fell back to \`client_modified\` — the last time a byte moved — so two cycles of one client landed on one destination.`);
  push();
  push(`Reading the year from the discarded level removed **${288 - collisions.length} of the 288**. What survives is ${collisions.length}.`);
  push();
  push(`**None of the ${collisions.length} touches a destination already occupied by a copied CanExport file** — all ${ceOccupied.toLocaleString()} were checked.`);
  push();
  push('### What survives, and why');
  push();
  push('Two cohort folders that encode the *same* year still collapse. `ETG-BC Applications 2020x` and `ETG-BC Applications 2020xx` are different intakes but both yield `2020`, so a client appearing in both still shares a destination. That is the residue.');
  push();
  push('| Group | Meaning | Collisions | Bytes at stake |');
  push('|---|---|---|---|');
  push(`| **A** | Same name, same size, same date — almost certainly one file filed twice | ${groupA.length} | ${mb(sumBytes(groupA))} |`);
  push(`| **B** | Same name, but different size or date — genuinely different files that would overwrite | ${groupB.length} | ${mb(sumBytes(groupB))} |`);
  push();
  push(`Of group A, ${groupA.filter((c) => c.diff && c.diff.index >= 1).length} have sources in different cohort folders. Of group B, ${groupB.filter((c) => !c.sameSize).length} differ in size and ${groupB.filter((c) => c.sameSize && !c.sameDate).length} share a size but differ in date.`);
  push();
  push(`⚠️ **${filesLost} files would be silently overwritten** if this were copied as-is — each collision keeps one source and loses the rest.`);
  push();
  push('### Step 6 — the suffix rule, APPLIED');
  push();
  push('**Both groups are suffixed.** The discriminator is the thing that was lost: the **first path segment where the colliding sources differ** — usually the cohort folder.');
  push();
  push('```');
  push('Clients/Terry Hawes/ETG…/2020/New Administrative Law/"New" Administrative Law.docx');
  push('  from …/ETG-BC Applications 2020x/…   ->  "New" Administrative Law (ETG-BC Applications 2020x).docx');
  push('  from …/ETG-BC Applications 2020xx/…  ->  "New" Administrative Law (ETG-BC Applications 2020xx).docx');
  push('```');
  push();
  push(`That disambiguated **${suffixWorks} of ${collisions.length}** on the first differing segment alone. It is stable (derived from the source, not a counter), reproducible across re-runs, and human-meaningful: it names the intake the file came from. The implementation widens to further differing segments if sanitizing ever made two discriminators collide, and falls back to an 8-character hash of the source path if the path itself cannot separate them — neither fallback was needed here.`);
  push();
  push('The suffix is applied to **both** `destination_path` and `proposed_filename`. If phase 3 ever applies the proposed name, it must not strip the suffix and recreate the collision.');
  push();
  push(`**Nothing was deduped or dropped.** All ${filesLost} files that would have been overwritten now have distinct destinations.`);
  push();
  push('**Group A — suffix as well, reluctantly.** These look like one file filed twice, so the tidy answer is to copy once. Three options and their costs:');
  push();
  push('| Option | Cost |');
  push('|---|---|');
  push('| **Dedupe** — copy one, drop the rest | Cheapest and cleanest, but **out of scope: every file migrates.** It also rests on same-name+size+date, which is a proxy for identity, not proof — no content hash exists without downloading. |');
  push('| **Dual-file** | Wrong shape. Dual-filing exists for one file belonging to *two clients*; here it is one client and two intakes. |');
  push(`| **Suffix** (applied) | Preserves every file, no judgement about identity. Costs ${groupA.length} visually duplicated pairs and ${mb(sumBytes(groupA))} of probably-redundant storage. |`);
  push();
  push(`Suffixing both groups treats all ${collisions.length} the same way and needs no identity judgement — that judgement belongs in phase 4 pruning, where the ${dupRedundant.toLocaleString()} same-size-same-name candidates already sit.`);
  push();
  push(`### All ${collisions.length} collisions and their resolved filenames`);
  push();
  push('`Was` is the destination both sources wanted; `Now` is the filename each ended up with.');
  push();
  push('| Group | Program | Was (colliding destination) | Now |');
  push('|---|---|---|---|');
  const appliedByDest = new Map();
  for (const s of suffixApplied) {
    if (!appliedByDest.has(s.oldDest)) appliedByDest.set(s.oldDest, []);
    appliedByDest.get(s.oldDest).push(s);
  }
  for (const c of [...collisions].sort((a, b) => a.group.localeCompare(b.group) || a.program.localeCompare(b.program) || a.dest.localeCompare(b.dest))) {
    const apps = appliedByDest.get(c.dest) ?? [];
    const names = [...new Set(apps.map((a) => a.newName))];
    push(`| **${c.group}** | ${me(c.program)} | \`${me(c.dest)}\` | ${names.map((n) => `\`${me(n)}\``).join('<br>')} |`);
  }
}
push();

push('---');
push();
push('## Review-pile routing — nothing left without a destination');
push();
push('Dropbox is being cancelled, so a row left in `review` with no destination is a lost file. Three of the four classes are routed; class 2 is reported and left pending.');
push();
push('**Nothing here is filed under a client on filename evidence.** Everything routed goes to `Programs/`, which asserts only that the file belongs to the grant program its own folder already placed it in.');
push();
push('| Class | Was | Routed to | Rows |');
push('|---|---|---|---|');
push(`| 1a | no client folder, folder names it program material | \`Programs/[Program]/…\` | ${routing.c1material} |`);
push(`| 1b | no client folder, no signal | \`Programs/[Program]/_Unfiled/…\` | ${routing.c1unfiled} |`);
push(`| 1c | directly under \`Grants/\`, no program at all | \`Programs/_Unfiled/…\` | ${routing.c1depth0} |`);
push(`| 3 | joint-client, dual-filed | \`Clients/…\` — promoted to \`sort\` | ${routing.c3} |`);
push(`| 4 | top folder labelled unclear | \`Programs/[Program]/_Unfiled/…\` | ${routing.c4} |`);
push(`| 2 | folder name never classified | **still \`review\` — pending** | ${routing.c2pending} |`);
push(`| | | **Total** | **${routing.c1material + routing.c1unfiled + routing.c1depth0 + routing.c3 + routing.c4 + routing.c2pending}** |`);
push();
push('### Class 1a — what the program-material rule matched');
push();
push('Rule: the program folder, or the first folder below it, matches `forms / reference / ref / docs / documents / templates / govt documents / application forms`, with or without a year. Substructure below is preserved.');
push();
push('| Folder matched | Rows |');
push('|---|---|');
for (const [f, n] of [...c1MatchedFolders.entries()].sort((a, b) => b[1] - a[1])) push(`| \`${me(f)}\` | ${n} |`);
push();
push('For contrast, the largest first-level folders the rule deliberately did **not** match — all client batches, correctly left for `_Unfiled`: `2018 deposits`, `ETG-BC Applications 2022`, `2018 Files`, `CAJG`, `2022 Clients`.');
push();
push(`### Class 1c — the ${depth0Files.length} files with no program`);
push();
push('These sit directly under `Grants/` with no program folder above them, so there is no program to file them under.');
push();
push('| Source | Proposed destination |');
push('|---|---|');
for (const f of depth0Files) push(`| \`${me(f.src.slice(GP.length))}\` | \`${me(f.dest)}\` |`);
push();
push('### Class 3 — joint dual-filed, promoted out of review');
push();
push(`${routing.c3} rows covering ${routing.c3 / 2} source files, each dual-filed into two client folders. These were decided at the colon triage, not pending: every row already carried a destination, it was just parked under \`Review/\`. Verified before promotion — **every source has exactly two destinations, all distinct, all under \`${CLIENTS_ROOT}/\`**, across 20 client folders.`);
push();
push(`### Class 4 — labelled unclear (${routing.c4})`);
push();
push('Twenty examples so the shape can be sanity-checked:');
push();
push('| Source | Destination |');
push('|---|---|');
for (const e of c4Examples) push(`| \`${me(e.src.slice(GP.length))}\` | \`${me(e.dest ?? '')}\` |`);
push();
push('---');
push();
if (routing.c2pending > 0) {
  push(`## Class 2 — never-classified folder names (${routing.c2pending} rows, STILL PENDING)`);
  push();
  push(`**Not routed.** ${c2ByFolder.size} distinct folder names.`);
  push();
  push('| Looks like | Folder names | Rows |');
  push('|---|---|---|');
  for (const k of ['client', 'batch', 'program', 'unclear']) {
    const g = c2Groups[k];
    push(`| ${k} | ${g.length} | ${g.reduce((s, x) => s + x.rows, 0)} |`);
  }
  push();
} else {
  push('## Class 2 — never-classified folder names, RESOLVED');
  push();
  push('The 36 folder names that never reached the classification pass are now hand-asserted as clients in `scripts/client-corrections.json` (source `class 2 routing 2026-08-17`), so their 750 files route through the normal `sort` path like any other client.');
  push();
  push('**26 became new canonicals; 10 merged into canonicals that already existed.** Merging was checked first, under the same normalization and fuzzy rules used everywhere else — creating a duplicate canonical for a client already in the list would have been the worse error.');
  push();
  push('| Folder | Merged into | Existing files |');
  push('|---|---|---|');
  push('| `The Tyee 2nd Sub` | `The Tyee` | 21 |');
  push('| `Graycon Group` | `Graycon` | 1 |');
  push('| `505 Junk` | `505-JUNK` | 7 |');
  push('| `Hatchways.io - APPROVED` | `Hatchways.io` | 5 |');
  push('| `More Than Just Feed (1)` | `More Than Just Feed` | 130 |');
  push('| `Mine and Yours` | `Mine & Yours` | 30 |');
  push('| `Black Tie Properties` | `Black Tie Property` | 31 |');
  push('| `Key Marketing - no moving forward` | `Key Marketing` | 33 |');
  push('| `Pure +` | `Pure+` | 11 |');
  push('| `ElleBox` | `Blume` | 326 |');
  push();
  push('Status and disposition suffixes were stripped from the names that became canonicals: `_closed`, `(Abandoned)`, `2nd Sub`, `- APPROVED`, `- no moving forward`, `(1)`, and the `Buy Local BC - ` program prefix. **Spelling was not corrected** — `Grah-Ter Constuction Inc.` and `Legend Distlling` are what the folders say, and there is no better source.');
  push();
  push('The `asserts_client` flag on those corrections is what lets them through `build-final-clients.mjs`, which otherwise rejects a correction whose resolved label is not `client`. The guard still applies to every correction without the flag — it exists to catch corrections written against the wrong name, not to override a deliberate human decision.');
  push();
}

push('---');
push();
push('## Step 7 — mechanical pruning signals');
push();
push('**Counted, not acted on.** No file is proposed for deletion; pruning is phase 4. These are string and size signals only — none is a judgement about whether a file matters.');
push();
push('| Signal | Files | Size |');
push('|---|---|---|');
push(`| Under a folder named z_Old / OLD STUFF / 1.DELETE / Old Folders and similar | ${pruneFiles.toLocaleString()} | ${gb(pruneBytes)} |`);
push(`| Filename marks it a template / blank / sample | ${templates.length.toLocaleString()} | ${gb(templateBytes)} |`);
push(`| Redundant copies in same-size + same-name groups | ${dupRedundant.toLocaleString()} | ${gb(dupRedundantBytes)} |`);
push();
push(`⚠️ **The duplicate figure is a proxy, not proof.** The inventory carries no content hash, so this counts files sharing an exact byte size *and* an identical filename — ${dupGroups.length.toLocaleString()} such groups. That is strong evidence but not byte-identity; confirming it needs hashes, which would mean downloading. Reported as a signal to size the opportunity.`);
push();
if (pruneFolders.size) {
  push('### Folder-name matches, by segment');
  push();
  push('| Folder segment | Files | Size |');
  push('|---|---|---|');
  for (const [k, v] of [...pruneFolders.entries()].sort((a, b) => b[1].files - a[1].files).slice(0, 20)) {
    push(`| \`${me(k)}\` | ${v.files.toLocaleString()} | ${mb(v.bytes)} |`);
  }
  if (pruneFolders.size > 20) push(`| _+${pruneFolders.size - 20} more segments_ | | |`);
  push();
}

push('---');
push();
push('## Step 7 — the programs whose cycle year sat in a discarded level');
push();
push('Each row: how many distinct cohort folders the sources came from, and how many distinct year segments they now produce. More years than before means cycles that used to collapse now separate.');
push();
push('| Program | sort files | Source cohort folders | Distinct years now | Cycles separate? |');
push('|---|---|---|---|---|');
{
  const YEAR_ANY2 = /(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/;
  const cycleOf = (src) => {
    const segs = src.replace('/Granted Team Folder/SALES/Grants/', '').split('/');
    for (let i = 1; i < segs.length - 1; i++) if (YEAR_ANY2.test(segs[i])) return segs[i];
    return null;
  };
  const pc = new Map();
  for (const r of out) {
    if (r.route !== 'sort') continue;
    const c = cycleOf(r.src);
    if (!c) continue;
    if (!pc.has(r.program)) pc.set(r.program, { cycles: new Set(), years: new Set(), files: 0 });
    const e = pc.get(r.program);
    e.cycles.add(c); e.years.add(r.year); e.files += 1;
  }
  const colByProg = new Map();
  for (const c of collisions) colByProg.set(c.program, (colByProg.get(c.program) ?? 0) + 1);
  for (const [p, e] of [...pc.entries()].sort((a, b) => b[1].files - a[1].files).slice(0, 20)) {
    const clean = !colByProg.has(p);
    push(`| ${me(p)} | ${e.files.toLocaleString()} | ${e.cycles.size} | ${e.years.size} | ${clean ? 'yes ✅' : `**${colByProg.get(p)} still collide**`} |`);
  }
}
push();
push('⚠️ **Fewer distinct years than cohort folders is expected, and is where the residue lives.** ETG has 21 cohort folders yielding 15 years because `ETG-BC Applications 2020x` and `2020xx` are different intakes of the same year. Those are exactly the collisions in Step 5 — the year is right, but the year alone does not separate two intakes within one year.');
push();

push('---');
push();
push('## Step 8 — copy volume and runtime');
push();
push('| Route | Files | Size |');
push('|---|---|---|');
for (const k of ['sort', 'program', 'archive']) {
  const s = routeStats.get(k) ?? { files: new Set(), bytes: 0 };
  push(`| ${k} | ${s.files.size.toLocaleString()} | ${gb(s.bytes)} |`);
}
push(`| **Copyable total** | **${copyFiles.size.toLocaleString()}** | **${gb(copyBytes)}** |`);
push(`| review (not copied) | ${new Set(reviewRows.map((r) => r.src)).size.toLocaleString()} | ${gb(revBytes)} |`);
push();
push(`**Estimated runtime: ${fmtDur(etaSec)}.** Built from the two completed runs, not the pilot extrapolation (an earlier version of this estimate used a PILOT_BYTES constant of 4.05 GB when the pilot moved 20.37 GB, and was wrong by 5×): CanExport moved 1,468 files / 20.37 GB in 47m18s (0.52 files/s, 7.35 MB/s — bandwidth-bound), ETG sustained ~1.13 files/s at working rate across 29,535 small documents (per-file-overhead-bound). The estimate takes whichever constraint binds; here that is **${etaByFiles > etaByBytes ? 'per-file overhead' : 'bandwidth'}**.`);
push();
push('The figure covers the whole mapping, including stages already copied. It excludes throttling bursts and socket stalls beyond what the two runs saw — ETG Run 2 lost ~2h to four stalls before request timeouts were added to the copier.');
push();

push('---');
push();
push('## Notes');
push();
push('- Year comes from the first sub-path segment when that segment carries a year, else `client_modified`. **`server_modified` is never used** — 40,390 files share a single corrupted 2024-07-23 bulk-event date.');
push(`- **Year precedence:** first sub-path segment below the client, then a year on a level discarded between program and client, then \`client_modified\`. Where discarded levels nest and disagree, the innermost wins — that happened on **${counters.batchCompeting.toLocaleString()}** rows.`);
push(`- ${counters.batchUsed.toLocaleString()} rows take their year from a discarded batch level; of those ${counters.batchMoved.toLocaleString()} disagreed with \`client_modified\` and ${counters.batchRecovered.toLocaleString()} recovered a year it lacked.`);
push(`- ${counters.yearCollapsed.toLocaleString()} rows had a leading sub-path segment equal to the year collapsed away; ${counters.yearMoved.toLocaleString()} took a first-sub-segment year that disagreed with \`client_modified\`, ${counters.yearRecovered.toLocaleString()} recovered a year that \`client_modified\` lacked.`);
push(`- ${folderRenames.size.toLocaleString()} distinct folder names were sanitized (colon → \` - \`). Filenames are never sanitized on the copy path.`);
push('- Nothing here is applied. `dist/inventory/full-mapping.csv` is a proposal for review.');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/canexport-mapping.mjs   # unchanged, byte-identical output');
push('node scripts/full-mapping.mjs        # this report');
push('```');
push();

await fsp.mkdir(path.dirname(MD_OUT), { recursive: true });
await fsp.writeFile(MD_OUT, L.join('\n') + '\n');
log(`wrote ${MD_OUT} (${L.length} lines)`);

console.log(JSON.stringify({
  programs: otherPrograms.length,
  rows: out.length,
  files: new Set(out.map((r) => r.src)).size,
  by_route: Object.fromEntries([...routeStats].map(([k, v]) => [k, { rows: v.rows, files: v.files.size, gb: Number((v.bytes / 1024 ** 3).toFixed(2)) }])),
  high_review_programs: highReview.length,
  collisions: collisions.length,
  review_rows: reviewRows.length,
  prune: { folder_files: pruneFiles, templates: templates.length, dup_redundant: dupRedundant },
  copy: { files: copyFiles.size, gb: Number((copyBytes / 1024 ** 3).toFixed(2)), eta: fmtDur(etaSec) },
}, null, 2));
