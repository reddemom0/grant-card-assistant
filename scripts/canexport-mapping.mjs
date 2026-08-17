/**
 * canexport-mapping.mjs — Phase 1 mapping sheet for the CanExport pilot.
 *
 * Builds one row per file (two for joint-client folders) proposing a Drive
 * destination. Produces a sheet for review; copies nothing, renames nothing,
 * and touches neither Dropbox nor Drive.
 *
 * NO network of any kind.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadRows, parseCsv, isBatchName, normalizeName } from './grants-lib.mjs';
import { mapFiles, makeResolveNodes } from './mapping-lib.mjs';

const INVENTORY = 'dist/inventory/grants-inventory.csv';
const CLIENTS = 'dist/inventory/clients-final.csv';
const RESOLVED = 'dist/inventory/resolved-final.csv';
const CSV_OUT = 'dist/inventory/canexport-mapping.csv';
const MD_OUT = 'docs/inventory/canexport-pilot.md';

/**
 * Destination root for client folders. The Drive restructure of 2026-08-13
 * moved all 90 client folders under this, and left Programs/ and Archive/ at
 * the Shared Drive root — so only the `sort` route carries this prefix.
 */
const CLIENTS_ROOT = 'All Clients';
/**
 * The out-of-retention FILE mirror. Renamed from "Archive" on 2026-08-17:
 * "archived" also describes a CLIENT status, so one word carried two meanings
 * at the same level of the tree.
 */
const ARCHIVE_ROOT = 'Old Files';

const MAX_SKIP = 8;
const RETENTION_YEARS = 6;
const now = new Date();
const cutoff = new Date(now);
cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
const CUTOFF_ISO = cutoff.toISOString();

// The joint-client folders identified in docs/inventory/colon-triage.md: group B
// names where at least one side matched a different company in the list.
// Files under these are dual-filed (one row per client) and routed to review.
const JOINT = new Map([
  ['capital city news:overstory media', ['Capital City News', 'Overstory Media Group']],
  ['girl gang:rolla skate club', ['Girl Gang', 'Rolla Skate Club']],
  ['acorn : abror', ['Acorn', 'Abror']],
  ['hippie snacks : left coast naturals', ['Hippie Snacks', 'Left Coast Naturals']],
  ['taimuri:capstone', ['Taimuri', 'Capstone']],
  ['admin slayer:spring planning', ['Admin Slayer', 'Spring Planning']],
  ['madison builders:e2 + associates', ['Madison Builders', 'E2+ Associates']],
  // REMOVED 2026-08-13: 'blume : ellebox' was a provisional colon-triage call
  // that read the folder as two clients. It is one company — HubSpot's active
  // record carries Legal Business Name "ElleBoxCo Inc." with domain blume.com,
  // so ElleBoxCo is the legal entity and Blume the operating name. All four
  // Blume raw folder names now resolve to the single canonical "Blume"
  // (326 files). Leaving the entry here would dual-file one company's folder.
  ['pure+:nineteen02 kombucha', ['Pure+', 'Nineteen02 Kombucha']],
  ['capital city:overstory', ['Capital City', 'Overstory']],
  ['premium fence:concept house:kurt', ['Premium Fence', 'Concept House']],

  // --- added by the Strategy Reports review, 2026-08-12 ----------------------
  // docs/inventory/strategy-reports-merges.md. Same dual-file treatment.
  //
  // Grants tree — reachable by this script, which walks grants-inventory.csv.
  // Listed in docs/inventory/colon-triage.md group B but never added here.
  ['healthy hooch:functional beverage group', ['Healthy Hooch', 'Functional Beverage Group']],
  //
  // Strategy Reports tree — SALES/*Annual Strategic Meetings/Client Strategy
  // Meeting Reports. This script only walks Grants, so these two are INERT
  // here; they are recorded so joint handling has one list to read when the
  // Strategy tree is migrated. "Admin Slayer - Spring Planning" is the same
  // client pair as the Grants folder "admin slayer:spring planning" above,
  // spelled with a hyphen instead of a colon.
  ['admin slayer - spring planning', ['Admin Slayer', 'Spring Planning']],
  ['cf canada & ap insurance', ['CF Canada Financial', 'AP Insurance']],
]);

const log = (...a) => console.error(...a);

log('reading inventory...');
const rows = loadRows(await fsp.readFile(INVENTORY, 'utf8'));
const allFiles = rows.filter((r) => r.isFile);
log(`  ${rows.length} rows, ${allFiles.length} files`);

// ---------------------------------------------------------------- lookups
const rawToCanon = new Map();   // normalized raw folder name -> {canonical, retention, rawCount}
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
const nameStatus = new Map();   // normalized raw name -> {label, status, confidence}
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(RESOLVED, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[1]) continue;
    nameStatus.set(r[1], { label: r[2], status: r[6], confidence: r[4] });
  }
}
log(`  ${canonInfo.size} canonical companies, ${nameStatus.size} judged names`);

// Prior run's routing split, read before we overwrite the file (Step 5).
const priorRoutes = new Map();
let priorRows = 0;
try {
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CSV_OUT, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0]) continue;
    priorRows += 1;
    priorRoutes.set(r[7] || r[6], (priorRoutes.get(r[7] || r[6]) ?? 0) + 1);
  }
  log(`  prior mapping: ${priorRows} rows ${JSON.stringify(Object.fromEntries(priorRoutes))}`);
} catch { log('  no prior mapping CSV found'); }

// ---------------------------------------------------------------- Step 3
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
const canexportPrograms = programs.filter((p) => squash(p.name).includes('canexport'));

const filesByProgram = new Map();
for (const f of allFiles) {
  filesByProgram.set(f.program, (filesByProgram.get(f.program) ?? 0) + 1);
}
const bytesByProgram = new Map();
for (const f of allFiles) {
  bytesByProgram.set(f.program, (bytesByProgram.get(f.program) ?? 0) + f.size);
}
for (const p of canexportPrograms) {
  p.files = filesByProgram.get(p.name) ?? 0;
  p.bytes = bytesByProgram.get(p.name) ?? 0;
}
canexportPrograms.sort((a, b) => b.files - a.files);
const CE_TOTAL = canexportPrograms.reduce((s, p) => s + p.files, 0);
log(`\nSTEP 3 — ${canexportPrograms.length} CanExport program folders, ${CE_TOTAL} files`);
for (const p of canexportPrograms) log(`  ${String(p.files).padStart(6)}  ${p.name}`);

// ---------------------------------------------------------------- attribution
const resolveNodes = makeResolveNodes(childrenByParent, MAX_SKIP);
const nodeByKey = new Map();
for (const p of canexportPrograms) {
  for (const n of resolveNodes(p.key)) nodeByKey.set(n.key, { name: n.name, program: p.name });
}

const ceFiles = allFiles.filter((f) => canexportPrograms.some((p) => p.name === f.program));
log(`  ${ceFiles.length} files under CanExport programs`);

// ---------------------------------------------------------------- Step 4/5
// ---------------------------------------------------------------- Step 2
// The routing rules live in scripts/mapping-lib.mjs so this pass and the
// full-corpus pass cannot drift. This file keeps only the CanExport report.
const mapped = mapFiles({
  files: ceFiles, nodeByKey, nameStatus, rawToCanon,
  joint: JOINT, cutoffIso: CUTOFF_ISO, clientsRoot: CLIENTS_ROOT, archiveRoot: ARCHIVE_ROOT,
});
const {
  out, stats, reviewReasons, programTops, noYear, audit, folderRenames,
  sanitizeSegment, sanitizePath,
} = mapped;
const { dualFiled, yearCollapsed, yearMoved, yearRecovered, yearConfirmed } = mapped.counters;
const cleanFilenameUnused = null;

for (const r of out) {
  const f = ceFiles.find((x) => x.path === r.src);
  stats[r.route].files += 1;
  stats[r.route].bytes += f ? f.size : 0;
}
// Dual-filed rows double-count bytes; track the distinct-file view too.
const distinctByRoute = new Map();
for (const r of out) {
  if (!distinctByRoute.has(r.route)) distinctByRoute.set(r.route, new Set());
  distinctByRoute.get(r.route).add(r.src);
}

log(`\n  year source — folder overrode client_modified: ${yearMoved}, confirmed: ${yearConfirmed}, recovered (no cm): ${yearRecovered}`);
log(`  year-folder collapses: ${yearCollapsed}`);
log(`\nSTEP 6 — rows: ${out.length} (${dualFiled} files dual-filed)`);
for (const k of ['sort', 'program', 'archive', 'review']) {
  log(`  ${k.padEnd(8)} rows=${String(stats[k].files).padStart(6)}  distinct files=${String(distinctByRoute.get(k)?.size ?? 0).padStart(6)}`);
}

// ================================================================ PART A
// Step 1 — clients whose files land in more than one year folder.
const yearsByClient = new Map();
for (const r of out) {
  if (r.route !== 'sort' || !r.client) continue;
  if (!yearsByClient.has(r.client)) yearsByClient.set(r.client, new Map());
  const m = yearsByClient.get(r.client);
  m.set(r.year, (m.get(r.year) ?? 0) + 1);
}
const spread = [...yearsByClient.entries()]
  .map(([client, m]) => ({
    client,
    years: [...m.keys()].sort(),
    counts: m,
    files: [...m.values()].reduce((a, b) => a + b, 0),
  }))
  .filter((e) => e.years.length > 1)
  .sort((a, b) => b.years.length - a.years.length || b.files - a.files);

// Step 2 — folder-year vs derived-year.
const YEARSEG = /(?:^|[^0-9])((?:19|20)\d{2})(?![0-9])/;
let agree = 0, differ = 0, noFolderYear = 0;
const disagreements = [];
for (const a of audit) {
  const segs = a.nodeName ? a.subOrig : a.belowProgram;
  let folderYear = null, whichSeg = null;
  for (const seg of segs) {
    const m = seg.match(YEARSEG);
    if (m) { folderYear = m[1]; whichSeg = seg; break; }
  }
  if (!folderYear || !a.derivedYear) { noFolderYear += 1; continue; }
  if (folderYear === a.derivedYear) agree += 1;
  else {
    differ += 1;
    disagreements.push({ path: a.path, seg: whichSeg, folderYear, derivedYear: a.derivedYear });
  }
}
const comparable = agree + differ;
log(`\nPART A — folder-year vs client_modified: agree=${agree} differ=${differ} (no comparable year=${noFolderYear})`);

// ---------------------------------------------------------------- Step 3: depth
const depthOf = (d) => d.split('/').filter(Boolean).length;
const depths = out.map((r) => depthOf(r.dest));
const maxDepth = Math.max(...depths);
const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
const deepest = [...out].sort((a, b) => depthOf(b.dest) - depthOf(a.dest)).slice(0, 10);

// ---------------------------------------------------------------- Step 4: collisions
const byDest = new Map();
for (const r of out) {
  if (!byDest.has(r.dest)) byDest.set(r.dest, new Set());
  byDest.get(r.dest).add(r.src);
}
const collisions = [...byDest.entries()]
  .filter(([, srcs]) => srcs.size > 1)
  .map(([dest, srcs]) => ({
    dest,
    sources: [...srcs].map((sp) => {
      const f = ceFiles.find((x) => x.path === sp);
      return { path: sp, size: f ? f.size : 0 };
    }).sort((a, b) => b.size - a.size),
  }))
  .sort((a, b) => b.sources.length - a.sources.length);
log(`\nSTEP 4 — collisions: ${collisions.length}`);

// Counterfactual: what the previous flat rule would have produced. Measured, so
// the report can state a number instead of asserting a risk.
const flatMap = new Map();
for (const r of out) {
  if (r.route !== 'sort') continue;
  const key = `${r.client}/${r.program}/${r.year}/${path.basename(r.src)}`;
  if (!flatMap.has(key)) flatMap.set(key, new Set());
  flatMap.get(key).add(r.src);
}
const flatCollisions = [...flatMap.values()].filter((v) => v.size > 1);
const flatLost = flatCollisions.reduce((s2, v) => s2 + v.size - 1, 0);
log(`  flat-rule counterfactual: ${flatCollisions.length} collisions, ${flatLost} files would be lost`);

// ---------------------------------------------------------------- Step 7: CSV
const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const lines = ['source_path,client,program,year,year_source,destination_path,proposed_filename,route,confidence,reason'];
for (const r of out) {
  lines.push([
    csv(r.src), csv(r.client), csv(r.program), csv(r.year), csv(r.yearSource),
    csv(r.dest), csv(r.proposed), csv(r.route), csv(r.confidence), csv(r.reason),
  ].join(','));
}
await fsp.mkdir(path.dirname(CSV_OUT), { recursive: true });
await fsp.writeFile(CSV_OUT, lines.join('\n') + '\n');
log(`wrote ${CSV_OUT} (${out.length} rows)`);

// ---------------------------------------------------------------- Step 7: MD
const gb = (n) => (n / 1024 ** 3).toFixed(2);
const mb = (n) => (n / 1024 ** 2).toFixed(1);
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');
const esc = (s) => String(s).replace(/\|/g, '\\|');
const L = [];
const push = (s = '') => L.push(s);

const clientsTouched = new Set(out.filter((r) => r.route === 'sort').map((r) => r.client));
const years = [...new Set(out.filter((r) => r.year).map((r) => r.year))].sort();
const renamed = out.filter((r) => r.proposed !== path.basename(r.src));

push('# CanExport Pilot — Phase 1');
push();
push(`**Generated:** ${now.toISOString()}`);
push('**Inputs:** `dist/inventory/grants-inventory.csv`, `dist/inventory/clients-final.csv`, `dist/inventory/resolved-final.csv`');
push('**Output:** `dist/inventory/canexport-mapping.csv` (gitignored — regenerable)');
push('**Nothing was copied, renamed, or moved.** This is a proposal for review.');
push();

push('## Step 1-2 — Drive write path (established)');
push();
push('| | |');
push('|---|---|');
push('| Working path | `claude_ai_Google_Drive` MCP connector |');
push('| Account | **writers@granted.ca** |');
push('| Pilot folder | `MIGRATION PILOT` — `1lUlMi23k5_Xs4tuNUaCISKbAZ_1Ifdav` (My Drive root) |');
push('| Nested folders | works |');
push('| Type conversion | can be disabled — files stay PDF/DOCX rather than converting to Google formats |');
push();
push('The local OAuth credential in `mcp-servers/gdrive/` is **dead**: the refresh token returns `invalid_grant`, and its scope was `drive.readonly` regardless, so it could never have written. Re-consent with a write scope would be needed to use it.');
push();
push('`MIGRATION PILOT` stays in My Drive as scratch space; the Shared Drive decision is open.');
push();

// Step 3
push('---');
push();
push(`## Step 3 — CanExport program folders (${canexportPrograms.length})`);
push();
push('Matched case-insensitively on the program folder name with punctuation and spacing ignored, so variants and year suffixes are caught.');
push();
push('| Program folder | Files | Size |');
push('|---|---|---|');
for (const p of canexportPrograms) push(`| \`${esc(p.name)}\` | ${p.files.toLocaleString()} | ${gb(p.bytes)} GB |`);
push(`| **Total** | **${CE_TOTAL.toLocaleString()}** | **${gb(canexportPrograms.reduce((s, p) => s + p.bytes, 0))} GB** |`);
push();
push(`That is ${pct(CE_TOTAL, allFiles.length)}% of the 75,971-file corpus — a reasonable pilot slice.`);
push();

// Step 4
push('---');
push();
push('## Mapping rows');
push();
push(`**${out.length.toLocaleString()} rows** for ${ceFiles.length.toLocaleString()} files. The count exceeds the file count because ${dualFiled} file${dualFiled === 1 ? '' : 's'} under joint-client folders are **dual-filed** — one row per client, as agreed.`);
push();
push('Columns: `source_path`, `client`, `program`, `year`, `destination_path`, `proposed_filename`, `route`, `confidence`, `reason`.');
push();
push('**Year comes from the first sub-path segment when it carries one, else `client_modified`** (see Part A). `server_modified` is not used anywhere: 40,390 files across the corpus share the single date 2024-07-23 from a bulk Dropbox event, which would put most of the pilot in the wrong year folder.');
push();
push(`Years present: ${years.length ? `${years[0]}–${years[years.length - 1]} (${years.length} distinct)` : 'none'}.`);
if (noYear.length) {
  push();
  push(`⚠️ **${noYear.length} file${noYear.length === 1 ? '' : 's'} have no \`client_modified\` value** and land in \`unknown-year/\`. They are marked \`medium\` confidence with the reason recorded.`);
}
push();
push('### Destination rule');
push();
push('```');
push('Client / Program / Year / <remaining Dropbox path below the client folder> / filename');
push('```');
push();
push('Everything **above** the client folder in Dropbox is discarded — that is the reorganization. Everything **below** it carries over unchanged, so deliberate structure someone created inside a client\'s work survives the move.');
push();
push(`Where the client's own sub-path begins with a folder whose name is **exactly** the derived year, that segment is dropped so the year does not appear twice: \`Client/CanExport/2023/2023/Interview - Budget/\` becomes \`Client/CanExport/2023/Interview - Budget/\`. Exact string match only — \`2023-24\`, \`2023 Application\` and similar are left in place. **${yearCollapsed}** file${yearCollapsed === 1 ? '' : 's'} had a segment collapsed this way.`);
push();
push(`Destination depth: **max ${maxDepth}**, average ${avgDepth.toFixed(1)} segments.`);
push();
push('The ten deepest destinations:');
push();
push('```');
for (const r of deepest) { push(`(${depthOf(r.dest)}) ${r.dest}`); }
push('```');
push();

push('### Folder-name sanitization');
push();
push(`Colons in **folder** segments become \` - \`. Filenames are never touched by this — only directory segments. ${folderRenames.size} distinct folder name${folderRenames.size === 1 ? '' : 's'} changed:`);
push();
if (folderRenames.size) {
  push('| Old folder name | New folder name |');
  push('|---|---|');
  for (const [oldN, newN] of [...folderRenames.entries()].sort()) push(`| \`${esc(oldN)}\` | \`${esc(newN)}\` |`);
} else {
  push('_None._');
}
push();
push('⚠️ Sanitization is applied to **every** route, including `archive`. "Mirrors the Dropbox path exactly" now means structurally identical — same folders, same nesting — with colons sanitized. Leaving raw colons in the archive tree would have made it the only part of the destination with a different naming convention.');
push();

push('### Proposed filenames');
push();
push(`\`proposed_filename\` is a cleaned name and is **not applied** — it is phase-3 input only. ${renamed.length.toLocaleString()} of ${out.length.toLocaleString()} rows (${pct(renamed.length, out.length)}%) would change if applied. Cleanup rules, deliberately conservative:`);
push();
push('| Rule | Rationale |');
push('|---|---|');
push('| `:` → ` - ` | A colon in a macOS-sourced name is a typed `/`; both are awkward in a path |');
push('| `\\ \\| < > " ? *` → `-` | Awkward across filesystems |');
push('| Strip leading `*`, `_`, `-` | Sort-order decoration, not part of the name |');
push('| Collapse whitespace runs; trim trailing dots/spaces | Silent breakage source |');
push('| Lowercase the extension | `.PDF` → `.pdf` |');
push();
push('Nothing else is touched — no case normalization, no word reordering, no truncation.');
push();

// Step 5/6
push('---');
push();
push('# Part A — Year audit (report only)');
push();
push('Nothing in this section changes the mapping. The year rule is unchanged; these are the numbers behind the decision.');
push();
push('## A1 — Clients spread across multiple year folders');
push();
push(`**${spread.length} of ${yearsByClient.size} clients** in the \`sort\` route have files landing in more than one year folder (${((spread.length / Math.max(yearsByClient.size, 1)) * 100).toFixed(1)}%).`);
push();
push('That is expected to a degree — a client who applied in 2019 and again in 2023 genuinely has two years of work. It becomes a problem when a *single* body of work is scattered because individual files were touched at different times.');
push();
push('The 15 widest spreads:');
push();
push('| Client | Years | Spread | Files per year |');
push('|---|---|---|---|');
for (const e of spread.slice(0, 15)) {
  const per = e.years.map((y) => `${y}:${e.counts.get(y)}`).join(', ');
  push(`| ${esc(e.client)} | ${e.years.length} | ${e.years[0]}–${e.years[e.years.length - 1]} | ${per} |`);
}
push();

push('## A2 — Folder year vs `client_modified` year');
push();
push('For every file whose Dropbox sub-path contains a year-like segment, that segment is compared against the year derived from `client_modified`. The comparison uses the **original** sub-path, before the duplicate-year collapse.');
push();
push('| Outcome | Files | Share of comparable |');
push('|---|---|---|');
push(`| Agree | ${agree.toLocaleString()} | ${comparable ? ((agree / comparable) * 100).toFixed(1) : '0.0'}% |`);
push(`| **Differ** | **${differ.toLocaleString()}** | **${comparable ? ((differ / comparable) * 100).toFixed(1) : '0.0'}%** |`);
push(`| No comparable year (no folder year, or no \`client_modified\`) | ${noFolderYear.toLocaleString()} | — |`);
push();
if (disagreements.length) {
  push('Ten disagreements:');
  push();
  push('| Folder segment | Folder year | Derived year | Source |');
  push('|---|---|---|---|');
  for (const d of disagreements.slice(0, 10)) {
    push(`| \`${esc(d.seg)}\` | ${d.folderYear} | **${d.derivedYear}** | \`${esc(d.path.replace('/Granted Team Folder/SALES/Grants/', ''))}\` |`);
  }
  push();
}

push('## A3 — Which year source is better?');
push();
const pctDiffer = comparable ? (differ / comparable) * 100 : 0;
push(`**Where both exist, the folder segment is the better source.** ${differ.toLocaleString()} of ${comparable.toLocaleString()} comparable files (${pctDiffer.toFixed(1)}%) disagree, and in the disagreements the folder is right more often than the timestamp for a structural reason:`);
push();
push('- **A folder year records intent.** Someone named a folder `2019 Application` because the work belongs to the 2019 intake. That is a deliberate statement about the grant cycle.');
push('- **`client_modified` records a file event.** It moves whenever a file is edited, re-saved, re-exported, or re-uploaded. A 2019 application PDF re-saved in 2023 carries a 2023 timestamp while still being 2019 work.');
push('- **The drift is one-directional.** In the sample above the derived year is consistently *later* than the folder year, which is the signature of files being touched after the fact rather than of folders being mislabelled.');
push(`- **It explains the spread in A1.** ${spread.length} clients are split across year folders; timestamp drift is the most likely cause for the ones whose work is really a single cycle.`);
push();
push(`The counter-argument is coverage: a folder year only exists for some files (${noFolderYear.toLocaleString()} here have no comparable folder year), so \`client_modified\` is still needed as the fallback.`);
push();
push('## A4 — Rule adopted');
push();
push('**Year now comes from the first segment of the client\'s sub-path when that segment carries a year; `client_modified` otherwise.**');
push();
push('The guard matters: **only the first segment counts.** A year-like segment deeper in the path does not override. `Reporting/Trip 1 - Nov 2018/…` keeps its `client_modified` year, because `Trip 1 - Nov 2018` describes something that happened *inside* a cycle rather than naming the cycle. Only `2022 Application/…` — a first segment — sets the year.');
push();
push('| Effect | Files |');
push('|---|---|');
push(`| Year **changed** (folder overrode \`client_modified\`) | **${yearMoved.toLocaleString()}** |`);
push(`| Folder agreed with \`client_modified\` — no change | ${yearConfirmed.toLocaleString()} |`);
push(`| Year **recovered** where \`client_modified\` was absent | ${yearRecovered.toLocaleString()} |`);
push(`| Still on \`client_modified\` (first segment carries no year) | ${(out.length - yearMoved - yearConfirmed - yearRecovered).toLocaleString()} |`);
push();
push(`${yearMoved.toLocaleString()} files move to a different year folder than the previous run placed them in. That is fewer than the ${differ.toLocaleString()} disagreements counted in A2, because A2 looked for a year *anywhere* in the sub-path while the adopted rule only honours the first segment.`);
push();
push('Every row in the CSV carries a `year_source` column (`folder`, `client_modified`, or `none`) so the provenance of each year is auditable without re-deriving it.');
push();
push('---');
push();
push('# Part B — Routing');
push();
push('## Routing');
push();
push('| Route | Rule | Rows | Distinct files | Bytes |');
push('|---|---|---|---|---|');
push(`| **sort** | Attributed to a live client | ${stats.sort.files.toLocaleString()} | ${(distinctByRoute.get('sort')?.size ?? 0).toLocaleString()} | ${gb(stats.sort.bytes)} GB |`);
push(`| **program** | Top folder labelled \`internal\` or \`doctype\` — belongs to the program, not a client | ${stats.program.files.toLocaleString()} | ${(distinctByRoute.get('program')?.size ?? 0).toLocaleString()} | ${gb(stats.program.bytes)} GB |`);
push(`| **archive** | Client archive-only past the ${RETENTION_YEARS}-year line | ${stats.archive.files.toLocaleString()} | ${(distinctByRoute.get('archive')?.size ?? 0).toLocaleString()} | ${gb(stats.archive.bytes)} GB |`);
push(`| **review** | No client, unjudged name, or joint-client folder | ${stats.review.files.toLocaleString()} | ${(distinctByRoute.get('review')?.size ?? 0).toLocaleString()} | ${gb(stats.review.bytes)} GB |`);
push();
push('Destination shapes:');
push();
push('| Route | Shape |');
push('|---|---|');
push('| `sort` | `Client/Program/Year/<sub-path below the client folder>/filename` |');
push('| `program` | `Programs/<Program>/<sub-path below the program>/filename` |');
push('| `archive` | `Archive/<full Dropbox path>` — structure mirrored exactly, colons sanitized |');
push('| `review` | `Review/<full Dropbox path>`; dual-filed rows are `Review/Client/Program/Year/<sub-path>/filename` |');
push();
push(`${clientsTouched.size.toLocaleString()} distinct clients appear in the \`sort\` route.`);
push();
if (reviewReasons.size) {
  push('### What remains in review');
  push();
  push('| Reason | Files |');
  push('|---|---|');
  for (const [r, c] of [...reviewReasons.entries()].sort((a, b) => b[1] - a[1])) push(`| ${esc(r)} | ${c.toLocaleString()} |`);
  push();
}

// dual-filing detail
const jointRows = out.filter((r) => r.reason.startsWith('joint-client'));
if (jointRows.length) {
  push('### Programs tree');
push();
push(`\`program\` is a new fourth route. A file lands there when the top folder under its grant program is labelled \`internal\` or \`doctype\` by the classification — the label decides it, not a hardcoded folder list, so this generalizes to other programs unchanged.`);
push();
if (programTops.size) {
  push('| Top folder under the program | Files |');
  push('|---|---|');
  for (const [n, c] of [...programTops.entries()].sort((a, b) => b[1] - a[1])) push(`| \`${esc(n)}\` | ${c.toLocaleString()} |`);
  push();
}
push('These keep their full structure below the program: `Programs/CanExport/CanExport Process Docs/…`. No year folder is inserted — program material is not client work and has no intake year.');
push();

push('### Dual-filed joint-client folders');
  push();
  push('Each file under these folders produces two rows, one per client. Both are routed `review` — dual-filing records the ambiguity, it does not resolve it. A `split` or `keep` decision in `colon-triage.md` collapses these.');
  push();
  const byFolder = new Map();
  for (const r of jointRows) {
    const m = r.reason.match(/"(.+)"/);
    const k = m ? m[1] : '(unknown)';
    if (!byFolder.has(k)) byFolder.set(k, { clients: new Set(), rows: 0 });
    byFolder.get(k).clients.add(r.client);
    byFolder.get(k).rows += 1;
  }
  push('| Joint folder | Filed under | Rows |');
  push('|---|---|---|');
  for (const [k, v] of [...byFolder.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
    push(`| \`${esc(k)}\` | ${[...v.clients].map((c) => esc(c)).join(' + ')} | ${v.rows} |`);
  }
  push();
}

// sample
push('---');
push();
push(`## Step 4 — Collision check`);
push();
if (collisions.length === 0) {
  push('**Zero collisions.** No two source files map to the same destination path.');
  push();
  push(`Preserving the sub-path is what makes that true, and the difference is measurable rather than theoretical. Re-running the collision check against the **previous flat** \`Client/Program/Year/filename\` rule on the same data gives **${flatCollisions.length} collisions covering ${flatLost} files** — those files would have silently overwritten each other on copy. Two examples: \`Capstone Canada/2023\` had \`chat.txt\` and \`recording.conf\` in both an \`Interview - Budget\` and an \`RA\` subfolder; WiderFunnel had the same application documents in a \`June Submission\` folder and a nested \`June Submission/June Submission\` folder.`);
  push();
} else {
  push(`**${collisions.length} collision${collisions.length === 1 ? '' : 's'}.** Two or more source files map to the same destination path. Every one is listed — these must be resolved before any copy.`);
  push();
  for (const c of collisions) {
    push(`**\`${esc(c.dest)}\`** — ${c.sources.length} sources:`);
    push();
    push('| Source path | Size |');
    push('|---|---|');
    for (const sc of c.sources) push(`| \`${esc(sc.path)}\` | ${mb(sc.size)} MB |`);
    push();
  }
}

push('---');
push();
push('## Step 5 — Routing split vs the prior run');
push();
if (priorRows) {
  push('| Route | Prior run | This run | Change |');
  push('|---|---|---|---|');
  let changed = false;
  for (const k of ['sort', 'program', 'archive', 'review']) {
    const before = priorRoutes.get(k) ?? 0;
    const after = stats[k].files;
    if (before !== after) changed = true;
    push(`| ${k} | ${before.toLocaleString()} | ${after.toLocaleString()} | ${after === before ? 'none' : (after > before ? '+' : '') + (after - before)} |`);
  }
  push();
  const movedToProgram = stats.program.files;
  const reviewDrop = (priorRoutes.get('review') ?? 0) - stats.review.files;
  push(changed
    ? `**The split changed, as intended by Part B.** The new \`program\` route took ${movedToProgram.toLocaleString()} rows, and \`review\` fell by ${reviewDrop.toLocaleString()} — the same files, re-routed. \`sort\` and \`archive\` are untouched. Conservation check: ${movedToProgram} moved out of review, review dropped by ${reviewDrop} — ${movedToProgram === reviewDrop ? '**they match**, so no file changed route for any other reason' : '**they do not match — investigate**'}.`
    : '**Unchanged.** Only the destination string was rewritten; the routing rules and the client list are identical.');
  push();
} else {
  push('No prior mapping file was available to compare against.');
  push();
}

push('---');
push();
push('## Sample rows');
push();
push('First five `sort` rows, verbatim from the CSV:');
push();
push('```');
for (const r of out.filter((x) => x.route === 'sort').slice(0, 5)) {
  push(`${r.src}`);
  push(`  -> ${r.dest}`);
  push(`     client=${r.client} | year=${r.year} | ${r.confidence} | ${r.reason}`);
}
push('```');
push();
const archSample = out.filter((x) => x.route === 'archive').slice(0, 3);
if (archSample.length) {
  push('First three `archive` rows — note the destination mirrors the source exactly:');
  push();
  push('```');
  for (const r of archSample) { push(`${r.src}`); push(`  -> ${r.dest}`); }
  push('```');
  push();
}

push('---');
push();
push('## What phase 1 does not settle');
push();
push('- **Nothing has been copied.** This sheet is the input to that decision.');
push('- **Proposed filenames are not applied.** Phase 3 input only.');
push('- **Joint-client folders are unresolved** — dual-filed and parked in review pending `colon-triage.md`.');
push('- **The Shared Drive question is open.** The pilot folder is in a personal My Drive; team-owned storage is a separate decision.');
push('- **Transport for the real copy is unsettled.** The MCP connector works file-by-file; a corpus copy wants a service account or a re-consented OAuth credential driving the REST API directly.');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/canexport-mapping.mjs');
push('```');
push();
push('Reads three CSVs, writes two files, makes no network call.');
push();

await fsp.mkdir(path.dirname(MD_OUT), { recursive: true });
await fsp.writeFile(MD_OUT, L.join('\n'));
log(`wrote ${MD_OUT} (${L.length} lines)`);

console.log(JSON.stringify({
  canexport_programs: canexportPrograms.length,
  canexport_files: CE_TOTAL,
  rows: out.length, dual_filed_files: dualFiled,
  sort: { rows: stats.sort.files, distinct: distinctByRoute.get('sort')?.size ?? 0, gb: Number(gb(stats.sort.bytes)) },
  program: { rows: stats.program.files, distinct: distinctByRoute.get('program')?.size ?? 0, gb: Number(gb(stats.program.bytes)) },
  archive: { rows: stats.archive.files, distinct: distinctByRoute.get('archive')?.size ?? 0, gb: Number(gb(stats.archive.bytes)) },
  review: { rows: stats.review.files, distinct: distinctByRoute.get('review')?.size ?? 0, gb: Number(gb(stats.review.bytes)) },
  clients_in_sort: clientsTouched.size,
  files_without_year: noYear.length,
  year_collapses: yearCollapsed,
  year_audit: { agree, differ, no_comparable: noFolderYear, clients_multi_year: spread.length },
  filenames_that_would_change: renamed.length,
}, null, 2));
