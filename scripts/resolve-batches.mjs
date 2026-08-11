/**
 * resolve-batches.mjs — mechanical re-resolution using the model's batch labels
 * as a skip list. Reuses existing judgements; makes none.
 *
 * NO network of any kind: no Anthropic, no Dropbox, no Drive, no HubSpot.
 * Imports are node builtins plus the local grants-lib.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  loadRows, parseCsv, classifyCached, isBatchName, normalizeName, MODEL_BATCH_NAMES,
} from './grants-lib.mjs';

const INVENTORY = 'dist/inventory/grants-inventory.csv';
const CLASSIFIED = 'dist/inventory/classified-clients.csv';
const CSV_OUT = 'dist/inventory/resolved-clients.csv';
const MD_OUT = 'docs/inventory/batch-resolution.md';
const MAX_SKIP = 8;

const log = (...a) => console.error(...a);

log('reading inventory...');
const rows = loadRows(await fsp.readFile(INVENTORY, 'utf8'));
const files = rows.filter((r) => r.isFile);
log(`  ${rows.length} rows, ${files.length} files`);

// ---------------------------------------------------------------- prior classifications
const prior = new Map(); // normalized key -> record
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CLASSIFIED, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[1]) continue;
    prior.set(r[1], {
      name: r[0], key: r[1], label: r[2], canonical: r[3] || null,
      confidence: r[4], retention: r[13] || '',
    });
  }
}
log(`  ${prior.size} prior classifications (${[...prior.values()].filter((p) => p.label === 'batch').length} batch)`);

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

/**
 * Walk down from a program, descending through every folder the predicate
 * calls a batch, and emit the first non-batch folder on each branch.
 */
function resolve(programKey, isBatch) {
  const out = [];
  const stack = (childrenByParent.get(programKey) ?? []).map((c) => ({ ...c, skips: 0, via: [] }));
  while (stack.length) {
    const node = stack.pop();
    if (isBatch(node.name) && node.skips < MAX_SKIP) {
      for (const c of childrenByParent.get(node.key) ?? []) {
        stack.push({ ...c, skips: node.skips + 1, via: [...node.via, node.name] });
      }
    } else {
      out.push({ name: node.name, key: node.key, via: node.via });
    }
  }
  return out;
}

function buildAttribution(isBatch) {
  const nodes = new Map(); // folder key -> {name, program}
  for (const p of programs) {
    for (const n of resolve(p.key, isBatch)) {
      nodes.set(n.key, { name: n.name, program: p.name, via: n.via });
    }
  }
  const byFile = new Map(); // file path -> node
  for (const f of files) {
    const folderSegs = f.segs.slice(0, -1);
    for (let k = 1; k <= folderSegs.length; k++) {
      const prefix = folderSegs.slice(0, k).join('/');
      const hit = nodes.get(prefix);
      if (hit) { byFile.set(f.path, hit); break; }
    }
  }
  return { nodes, byFile };
}

// ---------------------------------------------------------------- Step 2
log('resolving (old skip list: regex only)...');
const before = buildAttribution((n) => classifyCached(n) === 'batch');
log('resolving (new skip list: regex + model labels)...');
const after = buildAttribution(isBatchName);

const nameSet = (att) => {
  const m = new Map();
  for (const [, node] of att.nodes) {
    const k = normalizeName(node.name);
    if (!m.has(k)) m.set(k, { key: k, display: node.name.trim(), programs: new Set(), files: 0, bytes: 0, cmin: null, cmax: null });
    m.get(k).programs.add(node.program);
  }
  return m;
};

const afterNames = nameSet(after);
for (const f of files) {
  const node = after.byFile.get(f.path);
  if (!node) continue;
  const e = afterNames.get(normalizeName(node.name));
  e.files += 1;
  e.bytes += f.size;
  if (f.cm) {
    if (!e.cmin || f.cm < e.cmin) e.cmin = f.cm;
    if (!e.cmax || f.cm > e.cmax) e.cmax = f.cm;
  }
}

const beforeNames = nameSet(before);
const coverageBefore = before.byFile.size;
const coverageAfter = after.byFile.size;

// ---------------------------------------------------------------- Step 3
// Files whose attribution moved OFF a batch-labelled name.
let movedFiles = 0;
const releasedBy = new Map(); // batch folder name -> {files, targets:Set}
for (const f of files) {
  const b = before.byFile.get(f.path);
  const a = after.byFile.get(f.path);
  if (!b) continue;
  const bWasBatch = isBatchName(b.name);
  if (!bWasBatch) continue;
  if (a && normalizeName(a.name) === normalizeName(b.name)) continue; // unchanged
  movedFiles += 1;
  const k = b.name.trim();
  if (!releasedBy.has(k)) releasedBy.set(k, { name: k, files: 0, targets: new Set() });
  const rec = releasedBy.get(k);
  rec.files += 1;
  if (a) rec.targets.add(a.name.trim());
}
const topReleased = [...releasedBy.values()].sort((a, b) => b.files - a.files).slice(0, 10);

// Orphans: attributed before, unattributed after. These are loose files sitting
// DIRECTLY inside a batch folder — once we descend through it, nothing above
// them qualifies as client depth any more.
const orphans = [];
const orphanBy = new Map();
for (const f of files) {
  if (!before.byFile.has(f.path) || after.byFile.has(f.path)) continue;
  const b = before.byFile.get(f.path);
  orphans.push(f);
  const k = b.name.trim();
  orphanBy.set(k, (orphanBy.get(k) ?? 0) + 1);
}
const topOrphan = [...orphanBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

// ---------------------------------------------------------------- Step 4
const newNames = [...afterNames.values()].filter((e) => !prior.has(e.key));
const knownNames = [...afterNames.values()].filter((e) => prior.has(e.key));
const unclassified = newNames.sort((a, b) => b.files - a.files);

// ---------------------------------------------------------------- Step 5: CSV
const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const sorted = [...afterNames.values()].sort((a, b) => b.files - a.files || a.key.localeCompare(b.key));
const lines = ['name,normalized_key,label,canonical_name,confidence,retention,classification_status,programs,files,bytes,client_first,client_last'];
for (const e of sorted) {
  const p = prior.get(e.key);
  lines.push([
    csv(e.display), csv(e.key), csv(p?.label ?? ''), csv(p?.canonical ?? ''),
    csv(p?.confidence ?? ''), csv(p?.retention ?? ''),
    p ? 'classified' : 'UNCLASSIFIED',
    e.programs.size, e.files, e.bytes, csv(e.cmin), csv(e.cmax),
  ].join(','));
}
await fsp.mkdir(path.dirname(CSV_OUT), { recursive: true });
await fsp.writeFile(CSV_OUT, lines.join('\n') + '\n');
log(`wrote ${CSV_OUT} (${sorted.length} rows)`);

// ---------------------------------------------------------------- Step 5: MD
const pct = (n, d) => ((n / d) * 100).toFixed(1);
const L = [];
const push = (s = '') => L.push(s);

const labelCounts = new Map();
for (const e of sorted) {
  const l = prior.get(e.key)?.label ?? 'UNCLASSIFIED';
  labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
}
const clientNames = sorted.filter((e) => prior.get(e.key)?.label === 'client');
const stillBatch = sorted.filter((e) => prior.get(e.key)?.label === 'batch');

push('# Batch Re-Resolution — Applying the Model\'s Batch Labels');
push();
push(`**Generated:** ${new Date().toISOString()}`);
push('**Inputs:** `dist/inventory/grants-inventory.csv` (unmodified), `dist/inventory/classified-clients.csv`');
push('**Output:** `dist/inventory/resolved-clients.csv` (gitignored — regenerable)');
push('**Method:** mechanical only. No API call of any kind — no Anthropic, Dropbox, Drive, or HubSpot. No new judgements were made; the existing classifications are reused as data.');
push();

push('## What changed');
push();
push('`docs/inventory/client-classification.md` flagged that the string classifier caught only 16 batch folders while the model found 83 more. Those 83 names are now an explicit skip list in the shared library, so per-branch depth resolution descends through them too.');
push();
push('The list is **data, not regex**, deliberately. The pattern missed these for reasons no regex generalizes cleanly:');
push();
push('| Failure mode | Examples |');
push('|---|---|');
push('| Year with a trailing letter — no word boundary after the digits | `ETG-BC Applications 2021x`, `CJG-BC Applications 2018xx` |');
push('| Says "Clients", not "Client Files" — outside the hint vocabulary | `2016:2017 Clients`, `Clients 2017:18` |');
push('| Program-stream grouping with no date token at all | `Clean Tech Stream`, `Impact Stream`, `DS4Y - Digital Tech Stream` |');
push('| Bare grant-program acronym | `CAJG`, `BCMJG`, `CJG Manitoba` |');
push('| Ordinal intake | `Second Intake`, `Third Intake` |');
push();
push('Widening the regex to catch these would over-match real client names. An explicit list cannot.');
push();

push('---');
push();
push('## Step 2 — Re-resolution with the widened skip list');
push();
push('| Measure | Before | After | Δ |');
push('|---|---|---|---|');
push(`| Distinct candidate names | ${beforeNames.size.toLocaleString()} | **${afterNames.size.toLocaleString()}** | ${afterNames.size - beforeNames.size >= 0 ? '+' : ''}${(afterNames.size - beforeNames.size).toLocaleString()} |`);
push(`| Files attributed to a name | ${coverageBefore.toLocaleString()} | ${coverageAfter.toLocaleString()} | ${coverageAfter - coverageBefore >= 0 ? '+' : ''}${(coverageAfter - coverageBefore).toLocaleString()} |`);
push(`| File coverage | ${pct(coverageBefore, files.length)}% | **${pct(coverageAfter, files.length)}%** | |`);
push();
if (orphans.length) {
  push(`### ⚠️ Coverage went **down**, not up — ${orphans.length} files were orphaned`);
  push();
  push(`Attributed file count fell by ${(coverageBefore - coverageAfter).toLocaleString()}. This is a real side effect of the skip list, not a counting error.`);
  push();
  push(`Skipping *through* a batch folder means the folder itself is no longer a client-depth node. Any file sitting **loose directly inside** that batch folder — not in a subfolder — therefore loses its attribution: there is nothing beneath it to descend to, and the folder above it no longer qualifies. ${orphans.length} files are in that position.`);
  push();
  push('| Batch folder | Loose files orphaned |');
  push('|---|---|');
  for (const [n, c] of topOrphan) push(`| \`${n.replace(/\|/g, '\\|')}\` | ${c.toLocaleString()} |`);
  push();
  push(`This is the correct trade: ${movedFiles.toLocaleString()} files gained a real client attribution and ${orphans.length} lost a false one (a fiscal-year folder was never a client). But those ${orphans.length} files now belong to no name and would be missed by any client-keyed process.`);
  push();
}
push('Of the resulting names:');
push();
push('| Status | Names |');
push('|---|---|');
for (const [l, c] of [...labelCounts.entries()].sort((a, b) => b[1] - a[1])) {
  push(`| ${l === 'UNCLASSIFIED' ? '**UNCLASSIFIED** (new — never judged)' : `\`${l}\``} | ${c.toLocaleString()} |`);
}
push();
push(`**${knownNames.length.toLocaleString()} names already carry a classification; ${newNames.length.toLocaleString()} are new and unjudged.**`);
push();
if (stillBatch.length) {
  push(`⚠️ ${stillBatch.length} names still labelled \`batch\` remain in the output. These are batch folders with **no deeper folder structure** — files sit directly inside them, so there is nothing beneath to descend to. They hold ${stillBatch.reduce((s, e) => s + e.files, 0).toLocaleString()} files that no path rule can attribute to a client.`);
  push();
}

push('---');
push();
push('## Step 3 — Files released from batch attribution');
push();
push(`**${movedFiles.toLocaleString()} files** moved from a batch-folder attribution to a deeper (client-depth) attribution — ${pct(movedFiles, files.length)}% of all files in the tree.`);
push();
push('The 10 batch folders that released the most files:');
push();
push('| Batch folder | Files released | Distinct names beneath |');
push('|---|---|---|');
for (const r of topReleased) {
  push(`| \`${r.name.replace(/\|/g, '\\|')}\` | ${r.files.toLocaleString()} | ${r.targets.size} |`);
}
push();
if (releasedBy.size > topReleased.length) {
  push(`${releasedBy.size} batch folders released files in total; the ${topReleased.length} above account for ${pct(topReleased.reduce((s, r) => s + r.files, 0), movedFiles)}% of the movement.`);
  push();
}

push('---');
push();
push('## Step 4 — Newly surfaced names needing classification');
push();
push(`**${unclassified.length.toLocaleString()} names are new and have never been judged.** They hold ${unclassified.reduce((s, e) => s + e.files, 0).toLocaleString()} files. Classifying them requires a follow-up AI pass, which is **not** part of this task — they are counted and listed here only.`);
push();
if (unclassified.length) {
  const shown = unclassified.slice(0, 120);
  push(`| Name | Programs | Files | First seen | Last modified |`);
  push('|---|---|---|---|---|');
  for (const e of shown) {
    push(`| \`${e.display.replace(/\|/g, '\\|')}\` | ${e.programs.size} | ${e.files.toLocaleString()} | ${(e.cmin ?? '').slice(0, 10)} | ${(e.cmax ?? '').slice(0, 10)} |`);
  }
  if (unclassified.length > shown.length) {
    push(`| _…and ${unclassified.length - shown.length} more — full list in the CSV, \`classification_status = UNCLASSIFIED\`_ | | | | |`);
  }
  push();
  const estBatches = Math.ceil(unclassified.length / 50);
  push(`Sizing the follow-up: ~${estBatches} batch${estBatches === 1 ? '' : 'es'} of 50 at the previous pass's rate (~$0.0009 per name) ≈ **$${(unclassified.length * 0.0009).toFixed(2)}**.`);
  push();
}

push('---');
push();
push('## Current state of the client list');
push();
push('| Measure | Value |');
push('|---|---|');
push(`| Names carrying \`client\` | ${clientNames.length.toLocaleString()} |`);
push(`| Files under those names | ${clientNames.reduce((s, e) => s + e.files, 0).toLocaleString()} |`);
push(`| Names unjudged | ${unclassified.length.toLocaleString()} |`);
push(`| Files under unjudged names | ${unclassified.reduce((s, e) => s + e.files, 0).toLocaleString()} |`);
push(`| Files under no name at all | ${(files.length - coverageAfter).toLocaleString()} |`);
push(`| — of which newly orphaned by this pass | ${orphans.length.toLocaleString()} |`);
push();
push('`dist/inventory/resolved-clients.csv` carries every name with its `classification_status` (`classified` / `UNCLASSIFIED`), plus the label, canonical name, confidence, and retention carried over from the AI pass where one exists.');
push();

push('---');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/resolve-batches.mjs');
push('```');
push();
push('Reads two CSVs, writes two files, makes no network call. The skip list lives in `grants-lib.mjs` as `MODEL_BATCH_NAMES`.');
push();

await fsp.mkdir(path.dirname(MD_OUT), { recursive: true });
await fsp.writeFile(MD_OUT, L.join('\n'));
log(`wrote ${MD_OUT} (${L.length} lines)`);

console.log(JSON.stringify({
  skip_list_size: MODEL_BATCH_NAMES.size,
  names_before: beforeNames.size, names_after: afterNames.size,
  coverage_before: coverageBefore, coverage_after: coverageAfter,
  total_files: files.length,
  moved_files: movedFiles,
  batch_folders_that_released: releasedBy.size,
  already_classified: knownNames.length, unclassified: newNames.length,
  still_batch: stillBatch.length,
}, null, 2));
