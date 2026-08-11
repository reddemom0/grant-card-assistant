/**
 * extract-client-names.mjs — LOCAL, READ-ONLY extraction of candidate client names.
 *
 * Sizes the eventual AI classification pass: how many distinct folder names sit
 * at candidate-client depth, which are confidently NOT clients, and which are
 * archive-only vs live.
 *
 * Reuses batch detection and segment classification from grants-lib.mjs, which
 * is a verbatim lift of the logic behind docs/inventory/path-profile.md.
 * No network, no API, no LLM. Does not modify the input CSV.
 */

import fsp from 'node:fs/promises';
import { loadRows, levelLabel, classifyCached } from './grants-lib.mjs';

const CSV_IN = 'dist/inventory/grants-inventory.csv';
const CSV_OUT = 'dist/inventory/candidate-clients.csv';
const MD_OUT = 'docs/inventory/client-extraction.md';

const RETENTION_YEARS = 6;
const now = new Date();
const cutoff = new Date(now);
cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
const CUTOFF_ISO = cutoff.toISOString();

console.error('reading CSV...');
const rows = loadRows(await fsp.readFile(CSV_IN, 'utf8'));
const files = rows.filter((r) => r.isFile);
console.error(`parsed ${rows.length} rows, ${files.length} files`);

// ---------------------------------------------------------------- Step 1
// Client depth per program. Skip consecutive batch levels first: path-profile
// showed nested batches (batch/batch/client, e.g. "CJG-BC Applications 2020 and
// prior" -> "CJG-BC Applications 2017" -> "Herschel"), so a fixed depth of 2 for
// the program/batch/client shape would return the inner batch folder, not a client.
const programNames = [];
for (const r of rows) if (!r.isFile && r.segs.length === 1) programNames.push(r.name);

const MAX_SKIP = 4;
const depthByProgram = new Map();
const resolution = { resolved: 0, unresolved: 0, byDepth: new Map(), byReason: new Map() };
const programFiles = new Map();

for (const r of rows) {
  if (r.segs.length < 2 || !r.isFile) continue;
  programFiles.set(r.program, (programFiles.get(r.program) ?? 0) + 1);
}

for (const prog of programNames) {
  let d = 1;
  let label = levelLabel(rows, prog, d);
  while (label === 'batch' && d <= MAX_SKIP) {
    d += 1;
    label = levelLabel(rows, prog, d);
  }
  if (label === 'client') {
    depthByProgram.set(prog, d);
    resolution.resolved += 1;
    resolution.byDepth.set(d, (resolution.byDepth.get(d) ?? 0) + 1);
  } else {
    resolution.unresolved += 1;
    resolution.byReason.set(label, (resolution.byReason.get(label) ?? 0) + 1);
  }
}

const resolvedFiles = [...depthByProgram.keys()].reduce((s, p) => s + (programFiles.get(p) ?? 0), 0);
const unresolvedFiles = files.length - resolvedFiles;

console.error(`resolved ${resolution.resolved}/${programNames.length} programs`);

// ---------------------------------------------------------------- Step 2
// Every distinct folder name at the resolved client depth.
const rawOccurrences = new Map(); // exact name -> {programs:Set, files, bytes, min, max}
let rawInstances = 0;

function touch(map, key) {
  let e = map.get(key);
  if (!e) {
    e = { programs: new Set(), files: 0, bytes: 0, min: null, max: null, cmin: null, cmax: null };
    map.set(key, e);
  }
  return e;
}

// --- server_modified is NOT a usable recency signal in this corpus ------------
// A bulk Dropbox event rewrote it for over half the files on a single day.
// Quantify it here so the report can state it as measured fact.
const smDayCounts = new Map();
for (const f of files) {
  if (!f.sm) continue;
  const day = f.sm.slice(0, 10);
  smDayCounts.set(day, (smDayCounts.get(day) ?? 0) + 1);
}
const [bulkDay, bulkCount] = [...smDayCounts.entries()].sort((a, b) => b[1] - a[1])[0];

// Folder instances at client depth (counts each program/name pairing once).
const seenInstance = new Set();
for (const r of rows) {
  if (r.isFile) continue;
  const d = depthByProgram.get(r.program);
  if (!d) continue;
  const rel = r.segs.slice(1);
  if (rel.length !== d) continue;
  const nm = rel[d - 1];
  const key = `${r.program}\u0000${nm}`;
  if (!seenInstance.has(key)) { seenInstance.add(key); rawInstances += 1; }
  const e = touch(rawOccurrences, nm);
  e.programs.add(r.program);
}

// Attribute files (and dates) to the client-depth segment above them.
for (const f of files) {
  const d = depthByProgram.get(f.program);
  if (!d) continue;
  const rel = f.segs.slice(1);
  const folderSegs = rel.slice(0, -1);
  if (folderSegs.length < d) continue;
  const nm = folderSegs[d - 1];
  const e = touch(rawOccurrences, nm);
  e.programs.add(f.program);
  e.files += 1;
  e.bytes += f.size;
  if (f.sm) {
    if (!e.min || f.sm < e.min) e.min = f.sm;
    if (!e.max || f.sm > e.max) e.max = f.sm;
  }
  if (f.cm) {
    if (!e.cmin || f.cm < e.cmin) e.cmin = f.cm;
    if (!e.cmax || f.cm > e.cmax) e.cmax = f.cm;
  }
}

const rawDistinct = rawOccurrences.size;
console.error(`raw distinct names: ${rawDistinct}`);

// ---------------------------------------------------------------- Step 3
// Case-insensitive dedupe, trimming whitespace and trailing punctuation.
const normalizeKey = (s) =>
  s.trim()
    .replace(/[\s.,;:_\-*]+$/u, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();

const deduped = new Map(); // key -> {display, variants:Set, programs:Set, files, bytes, min, max}
for (const [name, e] of rawOccurrences) {
  const key = normalizeKey(name);
  if (!key) continue;
  let d = deduped.get(key);
  if (!d) {
    d = { key, display: name.trim(), variants: new Set(), programs: new Set(), files: 0, bytes: 0, min: null, max: null, cmin: null, cmax: null };
    deduped.set(key, d);
  }
  d.variants.add(name);
  // Prefer the variant with the most files as the display form.
  if (e.files > (d._bestFiles ?? -1)) { d.display = name.trim(); d._bestFiles = e.files; }
  for (const p of e.programs) d.programs.add(p);
  d.files += e.files;
  d.bytes += e.bytes;
  if (e.min && (!d.min || e.min < d.min)) d.min = e.min;
  if (e.max && (!d.max || e.max > d.max)) d.max = e.max;
  if (e.cmin && (!d.cmin || e.cmin < d.cmin)) d.cmin = e.cmin;
  if (e.cmax && (!d.cmax || e.cmax > d.cmax)) d.cmax = e.cmax;
}

const dedupedCount = deduped.size;
const collapsed = rawDistinct - dedupedCount;
console.error(`deduped: ${dedupedCount} (collapsed ${collapsed})`);

// ---------------------------------------------------------------- Step 5
// Retention split. A name is archive-only when its NEWEST file predates cutoff.
//
// Computed on client_modified, NOT server_modified. The bulk event quantified
// above rewrote server_modified for most of the corpus, so it reports almost
// everything as recent regardless of actual content age. Both are recorded so
// the difference is visible rather than hidden.
let archiveNames = 0, archiveFiles = 0, liveNames = 0, liveFiles = 0, undatedNames = 0, undatedFiles = 0;
let smArchiveNames = 0, smLiveNames = 0;
for (const d of deduped.values()) {
  if (d.max) {
    if (d.max < CUTOFF_ISO) smArchiveNames += 1; else smLiveNames += 1;
  }
  if (!d.cmax) { undatedNames += 1; undatedFiles += d.files; d.retention = 'no_dated_files'; continue; }
  if (d.cmax < CUTOFF_ISO) { archiveNames += 1; archiveFiles += d.files; d.retention = 'archive_only'; }
  else { liveNames += 1; liveFiles += d.files; d.retention = 'live'; }
}

// Label breakdown of what actually landed at client depth — exposes how much
// batch/doctype material the depth rule let through.
const labelBreakdown = new Map();
for (const d of deduped.values()) {
  const l = classifyCached(d.display);
  let s = labelBreakdown.get(l);
  if (!s) { s = { label: l, names: 0, files: 0 }; labelBreakdown.set(l, s); }
  s.names += 1;
  s.files += d.files;
}

// ---------------------------------------------------------------- Step 6
// Conservative exclusions ONLY. Anything ambiguous stays unresolved on purpose —
// judging it is the AI pass's job, not this one's.
const EXCLUDE_TERMS = [
  'claim', 'claims', 'reimbursement', 'reimbursements',
  'paystub', 'paystubs', 'pay stub', 'pay stubs',
  'invoice', 'invoices', 'invoicing',
  'template', 'templates',
];
const BARE_YEAR = /^(19|20)\d{2}(\s*[-–:/]\s*(19|20)?\d{2})?$/;

function exclusionReason(key) {
  if (BARE_YEAR.test(key)) return 'bare year';
  const words = key.split(/[^a-z0-9]+/u).filter(Boolean);
  const wordSet = new Set(words);
  for (const t of EXCLUDE_TERMS) {
    if (key === t) return `exact: ${t}`;
    if (!t.includes(' ') && wordSet.has(t)) return `keyword: ${t}`;
    if (t.includes(' ') && key.includes(t)) return `keyword: ${t}`;
  }
  return null;
}

let excluded = 0, unresolvedNames = 0;
const excludedByReason = new Map();
for (const d of deduped.values()) {
  const reason = exclusionReason(d.key);
  d.excluded = Boolean(reason);
  d.exclusion_reason = reason ?? '';
  if (reason) {
    excluded += 1;
    const bucket = reason.split(':')[0].trim();
    excludedByReason.set(bucket, (excludedByReason.get(bucket) ?? 0) + 1);
  } else unresolvedNames += 1;
}
const excludedFiles = [...deduped.values()].filter((d) => d.excluded).reduce((s, d) => s + d.files, 0);
const unresolvedFilesCount = [...deduped.values()].filter((d) => !d.excluded).reduce((s, d) => s + d.files, 0);

// ---------------------------------------------------------------- Step 7: CSV
const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const sorted = [...deduped.values()].sort((a, b) => b.files - a.files || a.key.localeCompare(b.key));

const lines = ['name,normalized_key,variant_count,programs,files,bytes,server_first,server_last,client_first,client_last,retention,excluded,exclusion_reason,segment_label'];
for (const d of sorted) {
  lines.push([
    csv(d.display), csv(d.key), d.variants.size, d.programs.size, d.files, d.bytes,
    csv(d.min), csv(d.max), csv(d.cmin), csv(d.cmax),
    csv(d.retention), d.excluded ? 'yes' : 'no', csv(d.exclusion_reason),
    csv(classifyCached(d.display)),
  ].join(','));
}
await fsp.writeFile(CSV_OUT, lines.join('\n') + '\n');
console.error(`wrote ${CSV_OUT} (${sorted.length} rows)`);

// ---------------------------------------------------------------- Step 7: MD
const pctFiles = (n) => ((n / files.length) * 100).toFixed(1);
const pctNames = (n) => ((n / dedupedCount) * 100).toFixed(1);
const L = [];
const push = (s = '') => L.push(s);

push('# Candidate Client Names — Extraction');
push();
push(`**Generated:** ${now.toISOString()}`);
push(`**Input:** \`${CSV_IN}\` (unmodified — opened read-only)`);
push(`**Full list:** \`${CSV_OUT}\` (gitignored — regenerable)`);
push(`**Method:** local string analysis. No network, no API, no LLM. Batch detection and segment classification are reused verbatim from the logic behind \`docs/inventory/path-profile.md\`.`);
push();
push('## Purpose');
push();
push(`Size the AI classification pass. This document says how many distinct names it would have to judge, which ones can be ruled out mechanically first, and how many are archive-only and might not need judging at all.`);
push();
push('## Headline');
push();
push(`| | |`);
push(`|---|---|`);
push(`| Distinct names at candidate-client depth (raw) | **${rawDistinct.toLocaleString()}** |`);
push(`| After case/punctuation dedupe | **${dedupedCount.toLocaleString()}** |`);
push(`| Confidently excluded (keyword / bare year) | **${excluded.toLocaleString()}** |`);
push(`| **Left for the AI pass to judge** | **${unresolvedNames.toLocaleString()}** |`);
push(`| — of those, archive-only (no file newer than ${RETENTION_YEARS}y) | ${[...deduped.values()].filter((d) => !d.excluded && d.retention === 'archive_only').length.toLocaleString()} |`);
push(`| — of those, live | ${[...deduped.values()].filter((d) => !d.excluded && d.retention === 'live').length.toLocaleString()} |`);
push();

// ---- Step 1
push('---');
push();
push('## Step 1 — Client depth per program folder');
push();
push('Depth is resolved per program by walking down from level 1 and **skipping consecutive `batch` levels**, then requiring the next level to be `client`.');
push();
push('A fixed depth of 2 for the `program/batch/client` shape would have been wrong: `path-profile.md` showed nested batches — `ETG (Employer Training Grant)/CJG-BC Applications 2020 and prior/CJG-BC Applications 2017/Herschel/` is `batch/batch/client`, so depth 2 returns an inner batch folder, not a client.');
push();
push(`**${resolution.resolved} of ${programNames.length} program folders resolve to a confident client depth** (${resolvedFiles.toLocaleString()} files, ${pctFiles(resolvedFiles)}% of all files).`);
push();
push('| Resolved client depth | Programs |');
push('|---|---|');
for (const [d, n] of [...resolution.byDepth.entries()].sort((a, b) => a[0] - b[0])) {
  push(`| ${d}${d === 1 ? ' (`program/client`)' : d === 2 ? ' (`program/batch/client`)' : ' (deeper — nested batches)'} | ${n} |`);
}
push();
push(`**${resolution.unresolved} do not resolve** (${unresolvedFiles.toLocaleString()} files, ${pctFiles(unresolvedFiles)}%), broken down by what sits at the first non-batch level:`);
push();
push('| Level label found | Programs | Meaning |');
push('|---|---|---|');
const reasonMeaning = {
  none: 'program folder has no subfolders — files sit directly inside',
  doctype: 'first level is document types, not names',
  mixed: 'no majority label at that level',
  unclear: 'generic or unparseable folder names',
  date: 'first level is dates',
  batch: 'still batch after skipping ' + MAX_SKIP + ' levels',
};
for (const [label, n] of [...resolution.byReason.entries()].sort((a, b) => b[1] - a[1])) {
  push(`| \`${label}\` | ${n} | ${reasonMeaning[label] ?? ''} |`);
}
push();
push('⚠️ The `none` group is large in program count but tiny in file count — these are small program folders holding a handful of loose files. They carry no client folder at all, so no name can be extracted for them by any path rule.');
push();

// ---- Steps 2 & 3
push('---');
push();
push('## Steps 2 & 3 — Extraction and dedupe');
push();
push(`| Measure | Count |`);
push(`|---|---|`);
push(`| Folder instances at client depth (program + name pairs) | ${rawInstances.toLocaleString()} |`);
push(`| Distinct raw names (exact string) | ${rawDistinct.toLocaleString()} |`);
push(`| Distinct after dedupe | ${dedupedCount.toLocaleString()} |`);
push(`| Collapsed by dedupe | ${collapsed.toLocaleString()} (${((collapsed / rawDistinct) * 100).toFixed(1)}%) |`);
push();
push('Dedupe rule: trim surrounding whitespace, strip trailing `.,;:_-*` and whitespace, collapse internal runs of whitespace, compare case-insensitively. The display name kept for each group is the variant with the most files beneath it.');
push();
const multiVariant = [...deduped.values()].filter((d) => d.variants.size > 1).sort((a, b) => b.variants.size - a.variants.size);
push(`${multiVariant.length.toLocaleString()} names had more than one spelling variant. The 15 with the most variants:`);
push();
push('| Name | Variants | Programs | Files |');
push('|---|---|---|---|');
for (const d of multiVariant.slice(0, 15)) {
  const vs = [...d.variants].map((v) => `\`${v.replace(/\|/g, '\\|')}\``).join(', ');
  push(`| ${d.display.replace(/\|/g, '\\|')} | ${d.variants.size} — ${vs} | ${d.programs.size} | ${d.files.toLocaleString()} |`);
}
push();

// ---- Step 4
push('---');
push();
push('## Step 4 — Per-name detail');
push();
push(`Full table is in \`${CSV_OUT}\` — one row per distinct name with: \`name\`, \`normalized_key\`, \`variant_count\`, \`programs\`, \`files\`, \`bytes\`, \`server_first\`, \`server_last\`, \`client_first\`, \`client_last\`, \`retention\`, \`excluded\`, \`exclusion_reason\`, \`segment_label\`.`);
push();
push('Top 40 by file count:');
push();
push('Date columns show `server_modified` as specified in the brief, plus `client_modified` alongside — see the warning below for why the server dates cannot be read as recency.');
push();
push('| Name | Programs | Files | server first→last | client first→last | Retention | Excluded |');
push('|---|---|---|---|---|---|---|');
for (const d of sorted.slice(0, 40)) {
  push(`| \`${d.display.replace(/\|/g, '\\|')}\` | ${d.programs.size} | ${d.files.toLocaleString()} | ${(d.min ?? '').slice(0, 10)} → ${(d.max ?? '').slice(0, 10)} | ${(d.cmin ?? '').slice(0, 10)} → ${(d.cmax ?? '').slice(0, 10)} | ${d.retention} | ${d.excluded ? '**yes** — ' + d.exclusion_reason : 'no'} |`);
}
push();
push('### What actually landed at client depth');
push();
push('Running the segment classifier back over the extracted names shows how much non-client material the depth rule let through:');
push();
push('| Segment label | Names | Files |');
push('|---|---|---|');
for (const s of [...labelBreakdown.values()].sort((a, b) => b.names - a.names)) {
  push(`| \`${s.label}\` | ${s.names.toLocaleString()} | ${s.files.toLocaleString()} |`);
}
push();
push('`batch`-labelled entries here are the depth rule\'s known failure mode: where batch folders nest more deeply than the per-program majority vote detects, level *d* lands on an inner batch folder rather than a client. Those names survive into the list because Step 6\'s exclusion vocabulary is deliberately narrow.');
push();

// ---- Step 5
push('---');
push();
push(`## Step 5 — Retention split (${RETENTION_YEARS}-year line)`);
push();
push(`Cutoff: **${CUTOFF_ISO.slice(0, 10)}**. A name is *archive-only* when its newest file predates that date.`);
push();
push(`### ⚠️ This split uses \`client_modified\`, not \`server_modified\``);
push();
push(`**${bulkCount.toLocaleString()} files — ${((bulkCount / files.length) * 100).toFixed(0)}% of the entire corpus — share a single \`server_modified\` date: ${bulkDay}.**`);
push();
push(`That is the same date carried by the \`Granted Team Folder (view-only conflicts ${bulkDay})\` folder found during the access probe. A bulk Dropbox event that day (restructure, conflict resolution, or mass re-sync) rewrote the server timestamp on over half the files, regardless of how old their content is.`);
push();
push(`\`server_modified\` therefore measures *when Dropbox last wrote the file*, not when anyone last worked on it. Using it for retention classifies **${smLiveNames.toLocaleString()} of ${dedupedCount.toLocaleString()} names as "live"** — a meaningless result.`);
push();
push(`\`client_modified\` preserves the originating file's own timestamp and survives moves. Across the corpus it spans 2008–${new Date().getFullYear()} with a natural distribution, so it is the field used below. Both are kept in the CSV.`);
push();
push('| Group | Distinct names | % of names | Files | % of resolved files |');
push('|---|---|---|---|---|');
push(`| **Archive-only** (all files older than ${RETENTION_YEARS}y) | ${archiveNames.toLocaleString()} | ${pctNames(archiveNames)}% | ${archiveFiles.toLocaleString()} | ${((archiveFiles / resolvedFiles) * 100).toFixed(1)}% |`);
push(`| **Live** (any file within ${RETENTION_YEARS}y) | ${liveNames.toLocaleString()} | ${pctNames(liveNames)}% | ${liveFiles.toLocaleString()} | ${((liveFiles / resolvedFiles) * 100).toFixed(1)}% |`);
push(`| No dated files (folder rows only) | ${undatedNames.toLocaleString()} | ${pctNames(undatedNames)}% | ${undatedFiles.toLocaleString()} | ${((undatedFiles / resolvedFiles) * 100).toFixed(1)}% |`);
push();
push('For contrast, the same split computed on the corrupted field:');
push();
push('| Field used | Archive-only names | Live names |');
push('|---|---|---|');
push(`| \`client_modified\` (used above) | ${archiveNames.toLocaleString()} | ${liveNames.toLocaleString()} |`);
push(`| \`server_modified\` (misleading) | ${smArchiveNames.toLocaleString()} | ${smLiveNames.toLocaleString()} |`);
push();

// ---- Step 6
push('---');
push();
push('## Step 6 — Conservative exclusions');
push();
push('Only unambiguous non-clients are flagged. Anything debatable is deliberately left unresolved — judging it is the AI pass\'s job, not this one\'s.');
push();
push('Rules: whole-word match on `claim(s)`, `reimbursement(s)`, `paystub(s)` / `pay stub(s)`, `invoice(s)` / `invoicing`, `template(s)`; or the whole name is a bare year / year range.');
push();
push('| Outcome | Distinct names | Files |');
push('|---|---|---|');
push(`| Confidently excluded | ${excluded.toLocaleString()} (${pctNames(excluded)}%) | ${excludedFiles.toLocaleString()} |`);
push(`| **Unresolved — for the AI pass** | ${unresolvedNames.toLocaleString()} (${pctNames(unresolvedNames)}%) | ${unresolvedFilesCount.toLocaleString()} |`);
push();
push('Exclusions by rule:');
push();
push('| Rule | Names |');
push('|---|---|');
for (const [b, n] of [...excludedByReason.entries()].sort((a, b) => b[1] - a[1])) {
  push(`| ${b} | ${n.toLocaleString()} |`);
}
push();

// ---- sizing
push('---');
push();
push('## What this means for the AI pass');
push();
push(`**${unresolvedNames.toLocaleString()} distinct names** need judging. Two facts shape the cost:`);
push();
const liveUnresolved = [...deduped.values()].filter((d) => !d.excluded && d.retention === 'live');
const archUnresolved = [...deduped.values()].filter((d) => !d.excluded && d.retention === 'archive_only');
push(`1. **Only ${liveUnresolved.length.toLocaleString()} of them are live** (${archUnresolved.length.toLocaleString()} are archive-only). If archive-only names can be deferred or handled in bulk, the pass shrinks by ${((archUnresolved.length / unresolvedNames) * 100).toFixed(0)}%.`);
push(`2. **They are names, not documents.** Each judgement is a short string, so they batch densely — this is not a per-file classification problem. ${unresolvedNames.toLocaleString()} names covers ${unresolvedFilesCount.toLocaleString()} files, roughly ${(unresolvedFilesCount / Math.max(unresolvedNames, 1)).toFixed(0)} files resolved per judgement.`);
push();
push(`Not covered by any name: the ${unresolvedFiles.toLocaleString()} files under the ${resolution.unresolved} unresolved program folders. Those need a different approach entirely — no path rule yields a client for them.`);
push();
push('---');
push();
push('## Reproducing');
push();
push('Extraction script and shared library live in `scripts/`. They read the inventory CSV read-only and write only the two outputs named above.');
push();

await fsp.writeFile(MD_OUT, L.join('\n'));
console.error(`wrote ${MD_OUT} (${L.length} lines)`);

console.log(JSON.stringify({
  programs: programNames.length,
  resolved: resolution.resolved,
  unresolved: resolution.unresolved,
  by_depth: Object.fromEntries(resolution.byDepth),
  by_reason: Object.fromEntries(resolution.byReason),
  raw_instances: rawInstances,
  raw_distinct: rawDistinct,
  deduped: dedupedCount,
  collapsed,
  archive_names: archiveNames, archive_files: archiveFiles,
  live_names: liveNames, live_files: liveFiles,
  undated_names: undatedNames,
  excluded, unresolved_names: unresolvedNames,
  cutoff: CUTOFF_ISO.slice(0, 10),
}, null, 2));
