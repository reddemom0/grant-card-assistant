/**
 * resolve-final.mjs — final mechanical re-resolution round.
 *
 * Applies the 6 batch names from the follow-up classification pass and
 * re-resolves per branch. Reuses existing judgements; makes none.
 *
 * NO network of any kind: no Anthropic, no Dropbox, no Drive, no HubSpot.
 * Imports are node builtins plus scripts/grants-lib.mjs.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  loadRows, parseCsv, classifyCached, isBatchName, normalizeName,
  MODEL_BATCH_NAMES, PASS2_BATCH_NAMES,
} from './grants-lib.mjs';

const INVENTORY = 'dist/inventory/grants-inventory.csv';
const FINAL = 'dist/inventory/final-clients.csv';
const CSV_OUT = 'dist/inventory/resolved-final.csv';
const MD_OUT = 'docs/inventory/final-resolution.md';
const MAX_SKIP = 8;
const RETENTION_YEARS = 6;

const now = new Date();
const cutoff = new Date(now);
cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
const CUTOFF_ISO = cutoff.toISOString();

const log = (...a) => console.error(...a);

log('reading inventory...');
const rows = loadRows(await fsp.readFile(INVENTORY, 'utf8'));
const files = rows.filter((r) => r.isFile);
log(`  ${rows.length} rows, ${files.length} files`);

// Prior judgements from both classification passes.
const prior = new Map();
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(FINAL, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[1]) continue;
    prior.set(r[1], {
      name: r[0], key: r[1], label: r[2], canonical: r[3] || null,
      confidence: r[4] || null, retention: r[5] || null, pass: r[6] || '',
      files: Number(r[8] || 0),
    });
  }
}
log(`  ${prior.size} prior judgements`);

// ---------------------------------------------------------------- tree
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

function resolve(programKey, isBatch) {
  const out = [];
  const stack = (childrenByParent.get(programKey) ?? []).map((c) => ({ ...c, skips: 0 }));
  while (stack.length) {
    const node = stack.pop();
    if (isBatch(node.name) && node.skips < MAX_SKIP) {
      for (const c of childrenByParent.get(node.key) ?? []) {
        stack.push({ ...c, skips: node.skips + 1 });
      }
    } else {
      out.push({ name: node.name, key: node.key });
    }
  }
  return out;
}

function buildAttribution(isBatch) {
  const nodes = new Map();
  for (const p of programs) {
    for (const n of resolve(p.key, isBatch)) nodes.set(n.key, { name: n.name, program: p.name });
  }
  const byFile = new Map();
  for (const f of files) {
    const folderSegs = f.segs.slice(0, -1);
    for (let k = 1; k <= folderSegs.length; k++) {
      const hit = nodes.get(folderSegs.slice(0, k).join('/'));
      if (hit) { byFile.set(f.path, hit); break; }
    }
  }
  return { nodes, byFile };
}

// "Before" = the pass-1 skip list (everything except the 6 pass-2 additions).
const isBatchBefore = (n) =>
  classifyCached(n) === 'batch' ||
  (MODEL_BATCH_NAMES.has(normalizeName(n)) && !PASS2_BATCH_NAMES.has(normalizeName(n)));

log('resolving (before: 83-name skip list)...');
const before = buildAttribution(isBatchBefore);
log('resolving (after: 89-name skip list)...');
const after = buildAttribution(isBatchName);

// ---------------------------------------------------------------- aggregate
const agg = new Map();
for (const [, node] of after.nodes) {
  const k = normalizeName(node.name);
  if (!agg.has(k)) {
    agg.set(k, { key: k, display: node.name.trim(), programs: new Set(), files: 0, bytes: 0, cmin: null, cmax: null });
  }
  agg.get(k).programs.add(node.program);
}
for (const f of files) {
  const node = after.byFile.get(f.path);
  if (!node) continue;
  const e = agg.get(normalizeName(node.name));
  e.files += 1;
  e.bytes += f.size;
  if (f.cm) {
    if (!e.cmin || f.cm < e.cmin) e.cmin = f.cm;
    if (!e.cmax || f.cm > e.cmax) e.cmax = f.cm;
  }
}
const names = [...agg.values()];
const classified = names.filter((e) => prior.has(e.key));
const unjudged = names.filter((e) => !prior.has(e.key)).sort((a, b) => b.files - a.files);

const beforeNameCount = new Set([...before.nodes.values()].map((n) => normalizeName(n.name))).size;
const coverageBefore = before.byFile.size;
const coverageAfter = after.byFile.size;

// ---------------------------------------------------------------- Step 3
let moved = 0;
const releasedBy = new Map();
const orphans = [];
const orphanBy = new Map();
for (const f of files) {
  const b = before.byFile.get(f.path);
  const a = after.byFile.get(f.path);
  if (b && !a) {
    orphans.push(f);
    orphanBy.set(b.name.trim(), (orphanBy.get(b.name.trim()) ?? 0) + 1);
    continue;
  }
  if (!b || !a) continue;
  if (normalizeName(a.name) === normalizeName(b.name)) continue;
  if (!PASS2_BATCH_NAMES.has(normalizeName(b.name))) continue;
  moved += 1;
  const k = b.name.trim();
  if (!releasedBy.has(k)) releasedBy.set(k, { name: k, files: 0, targets: new Set() });
  releasedBy.get(k).files += 1;
  releasedBy.get(k).targets.add(a.name.trim());
}
const released = [...releasedBy.values()].sort((a, b) => b.files - a.files);
const topOrphan = [...orphanBy.entries()].sort((a, b) => b[1] - a[1]);

// ---------------------------------------------------------------- Step 4
// Does anything newly surfaced look batch-shaped by the mechanical classifier?
const suspects = unjudged.filter((e) => classifyCached(e.display) === 'batch');
// Heuristic tell-tales the regex misses, for an honest convergence statement.
const GROUPING_HINT = /\b(clients?|intake|applications?|forms?|q[1-4]|quarter|stream|cohort|batch|waitlist|prospects?)\b/i;
const softSuspects = unjudged.filter((e) => !suspects.includes(e) && GROUPING_HINT.test(e.display));

// ---------------------------------------------------------------- Step 5: CSV
const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
let liveNames = 0, liveFiles = 0, archNames = 0, archFiles = 0, undated = 0;
for (const e of names) {
  const p = prior.get(e.key);
  if (!p || p.label !== 'client') { e.retention = 'n/a'; continue; }
  if (!e.cmax) { e.retention = 'no_dated_files'; undated += 1; continue; }
  if (e.cmax < CUTOFF_ISO) { e.retention = 'archive_only'; archNames += 1; archFiles += e.files; }
  else { e.retention = 'live'; liveNames += 1; liveFiles += e.files; }
}

const sorted = [...names].sort((a, b) => b.files - a.files || a.key.localeCompare(b.key));
const lines = ['name,normalized_key,label,canonical_name,confidence,retention,classification_status,pass,programs,files,bytes,client_first,client_last'];
for (const e of sorted) {
  const p = prior.get(e.key);
  lines.push([
    csv(e.display), csv(e.key), csv(p?.label ?? ''), csv(p?.canonical ?? ''),
    csv(p?.confidence ?? ''), csv(e.retention), p ? 'classified' : 'UNCLASSIFIED',
    csv(p?.pass ?? ''), e.programs.size, e.files, e.bytes, csv(e.cmin), csv(e.cmax),
  ].join(','));
}
await fsp.mkdir(path.dirname(CSV_OUT), { recursive: true });
await fsp.writeFile(CSV_OUT, lines.join('\n') + '\n');
log(`wrote ${CSV_OUT} (${sorted.length} rows)`);

// ---------------------------------------------------------------- Step 5: MD
const pct = (n, d) => ((n / d) * 100).toFixed(1);
const esc = (s) => String(s).replace(/\|/g, '\\|');
const L = [];
const push = (s = '') => L.push(s);

const labelCounts = new Map();
for (const e of sorted) {
  const l = prior.get(e.key)?.label ?? 'UNCLASSIFIED';
  labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
}
const clientNames = sorted.filter((e) => prior.get(e.key)?.label === 'client');
const canon = new Set();
for (const e of clientNames) {
  const p = prior.get(e.key);
  canon.add(((p.canonical || e.display).trim()).toLowerCase());
}

push('# Final Batch Re-Resolution');
push();
push(`**Generated:** ${now.toISOString()}`);
push('**Inputs:** `dist/inventory/grants-inventory.csv` (unmodified), `dist/inventory/final-clients.csv`, `scripts/grants-lib.mjs`');
push('**Output:** `dist/inventory/resolved-final.csv` (gitignored — regenerable)');
push('**Method:** mechanical only. No API call of any kind. No new judgements — existing labels are reused as data.');
push();

push('## Step 1 — Skip list extended to 89 names');
push();
push('The 6 names the follow-up pass labelled `batch` are now in `MODEL_BATCH_NAMES` in `scripts/grants-lib.mjs`, and are also exported separately as `PASS2_BATCH_NAMES` so a run can diff against the pass-1 state (which is how the before/after below is computed).');
push();
push('| Name added | Files it held before this round |');
push('|---|---|');
for (const k of [...PASS2_BATCH_NAMES].sort((a, b) => (prior.get(b)?.files ?? 0) - (prior.get(a)?.files ?? 0))) {
  const p = prior.get(k);
  push(`| \`${esc(p?.name ?? k)}\` | ${(p?.files ?? 0).toLocaleString()} |`);
}
push(`| **Total** | **${[...PASS2_BATCH_NAMES].reduce((s, k) => s + (prior.get(k)?.files ?? 0), 0).toLocaleString()}** |`);
push();
push('Same failure modes as the earlier additions: "Clients" used as a grouping word, a quarter label with no year, a program acronym, a parenthesised status suffix.');
push();

push('---');
push();
push('## Step 2 — Re-resolution');
push();
push('| Measure | Before (83-name list) | After (89-name list) | Δ |');
push('|---|---|---|---|');
push(`| Distinct candidate names | ${beforeNameCount.toLocaleString()} | **${names.length.toLocaleString()}** | ${names.length - beforeNameCount >= 0 ? '+' : ''}${(names.length - beforeNameCount).toLocaleString()} |`);
push(`| Files attributed | ${coverageBefore.toLocaleString()} | ${coverageAfter.toLocaleString()} | ${coverageAfter - coverageBefore >= 0 ? '+' : ''}${(coverageAfter - coverageBefore).toLocaleString()} |`);
push(`| File coverage | ${pct(coverageBefore, files.length)}% | **${pct(coverageAfter, files.length)}%** | |`);
push();
push('| Status | Names |');
push('|---|---|');
push(`| Already classified (pass 1 or 2) | ${classified.length.toLocaleString()} |`);
push(`| **New and unjudged** | **${unjudged.length.toLocaleString()}** |`);
push();
push('Breakdown by carried-over label:');
push();
push('| Label | Names |');
push('|---|---|');
for (const [l, c] of [...labelCounts.entries()].sort((a, b) => b[1] - a[1])) {
  push(`| ${l === 'UNCLASSIFIED' ? '**UNCLASSIFIED**' : `\`${l}\``} | ${c.toLocaleString()} |`);
}
push();

push('---');
push();
push('## Step 3 — What moved');
push();
push(`**${moved.toLocaleString()} files** moved from one of the 6 batch folders to a deeper client-depth attribution.`);
push();
if (released.length) {
  push('| Batch folder descended | Files released | Distinct names beneath |');
  push('|---|---|---|');
  for (const r of released) push(`| \`${esc(r.name)}\` | ${r.files.toLocaleString()} | ${r.targets.size} |`);
  push();
}
if (orphans.length) {
  push(`### Newly orphaned: ${orphans.length} files`);
  push();
  push('Loose files sitting directly inside a descended batch folder. Once the folder is skipped through, nothing above them qualifies as client depth, so they lose attribution entirely.');
  push();
  push('| Batch folder | Loose files orphaned |');
  push('|---|---|');
  for (const [n, c] of topOrphan) push(`| \`${esc(n)}\` | ${c.toLocaleString()} |`);
  push();
} else {
  push('### Newly orphaned: none');
  push();
  push('Every file under the 6 descended folders sat inside a subfolder, so none lost attribution this round.');
  push();
}
push('### Running total of unattributed files');
push();
push('| | Files |');
push('|---|---|');
push(`| Total files in the tree | ${files.length.toLocaleString()} |`);
push(`| Attributed to a name | ${coverageAfter.toLocaleString()} (${pct(coverageAfter, files.length)}%) |`);
push(`| **Unattributed** | **${(files.length - coverageAfter).toLocaleString()}** (${pct(files.length - coverageAfter, files.length)}%) |`);
push(`| — orphaned by this round | ${orphans.length.toLocaleString()} |`);
push();
push('The unattributed set is out of scope here — it goes to the review sheet.');
push();

push('---');
push();
push('## Step 4 — Has the batch pattern converged?');
push();
push(`Skip-list growth across rounds: **16 → 83 → 6 → ${suspects.length + softSuspects.length === 0 ? '0' : `${suspects.length} certain / ${softSuspects.length} suspected`}**.`);
push();
if (suspects.length === 0 && softSuspects.length === 0) {
  push(`**Converged.** None of the ${unjudged.length} newly surfaced names is batch-shaped by the mechanical classifier, and none carries a grouping tell-tale (\`clients\`, \`intake\`, \`applications\`, \`forms\`, \`Q1-Q4\`, \`stream\`, \`cohort\`, \`waitlist\`, \`prospects\`). No further re-resolution round is indicated.`);
  push();
} else {
  push(`**Not fully converged.** Of the ${unjudged.length} newly surfaced names:`);
  push();
  push(`- **${suspects.length}** are batch-shaped by the mechanical classifier and could be skipped without any AI call.`);
  push(`- **${softSuspects.length}** carry a grouping tell-tale (\`clients\`, \`intake\`, \`applications\`, \`forms\`, \`Q1-Q4\`, \`stream\`, \`cohort\`, \`waitlist\`, \`prospects\`) that the regex does not catch — these are the ones only a classification pass can settle.`);
  push();
  if (suspects.length) {
    push('Certain (regex-detected):');
    push();
    push('| Name | Files |');
    push('|---|---|');
    for (const e of suspects.slice(0, 25)) push(`| \`${esc(e.display)}\` | ${e.files.toLocaleString()} |`);
    push();
  }
  if (softSuspects.length) {
    push('Suspected (grouping tell-tale, needs judgement):');
    push();
    push('| Name | Files | Programs |');
    push('|---|---|---|');
    for (const e of softSuspects.slice(0, 40)) push(`| \`${esc(e.display)}\` | ${e.files.toLocaleString()} | ${e.programs.size} |`);
    if (softSuspects.length > 40) push(`| _…and ${softSuspects.length - 40} more_ | | |`);
    push();
  }
}
const estBatches = Math.ceil(unjudged.length / 50);
push(`**Cost of one more classification pass** over all ${unjudged.length.toLocaleString()} newly surfaced names: ~${estBatches} batch${estBatches === 1 ? '' : 'es'} of 50 at the observed rate (~$0.0009/name) ≈ **$${(unjudged.length * 0.0009).toFixed(2)}**. **Not run** — reported only, per scope.`);
push();

push('---');
push();
push('## Current state');
push();
push('| Measure | Value |');
push('|---|---|');
push(`| Distinct names | ${names.length.toLocaleString()} |`);
push(`| Names labelled \`client\` | ${clientNames.length.toLocaleString()} |`);
push(`| Distinct canonical companies | ${canon.size.toLocaleString()} |`);
push(`| Files under client names | ${clientNames.reduce((s, e) => s + e.files, 0).toLocaleString()} |`);
push(`| Names unjudged | ${unjudged.length.toLocaleString()} (${unjudged.reduce((s, e) => s + e.files, 0).toLocaleString()} files) |`);
push(`| Files unattributed | ${(files.length - coverageAfter).toLocaleString()} |`);
push();
push(`### Retention (client names, \`client_modified\`, ${CUTOFF_ISO.slice(0, 10)} cutoff)`);
push();
push('`server_modified` is not used — 40,390 files share 2024-07-23 from a bulk Dropbox event.');
push();
push('| Group | Names | Files |');
push('|---|---|---|');
push(`| **Live** (a file within ${RETENTION_YEARS} years) | ${liveNames.toLocaleString()} | ${liveFiles.toLocaleString()} |`);
push(`| **Archive-only** | ${archNames.toLocaleString()} | ${archFiles.toLocaleString()} |`);
push(`| No dated files | ${undated.toLocaleString()} | 0 |`);
push();
push('⚠️ Canonical-company and retention counts above cover only the names already judged. The unjudged names are excluded, so these are a floor, not a final figure.');
push();

push('---');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/resolve-final.mjs');
push('```');
push();
push('Reads two CSVs, writes two files, makes no network call. Skip list: `MODEL_BATCH_NAMES` in `scripts/grants-lib.mjs` (89 names; the last 6 also exported as `PASS2_BATCH_NAMES`).');
push();

await fsp.mkdir(path.dirname(MD_OUT), { recursive: true });
await fsp.writeFile(MD_OUT, L.join('\n'));
log(`wrote ${MD_OUT} (${L.length} lines)`);

console.log(JSON.stringify({
  skip_list: MODEL_BATCH_NAMES.size,
  names_before: beforeNameCount, names_after: names.length,
  coverage_before: coverageBefore, coverage_after: coverageAfter,
  total_files: files.length, unattributed: files.length - coverageAfter,
  moved, orphaned: orphans.length,
  classified: classified.length, unjudged: unjudged.length,
  regex_batch_suspects: suspects.length, soft_suspects: softSuspects.length,
  canonical_companies: canon.size,
}, null, 2));
