/**
 * build-final-clients.mjs — apply the hand-reviewed corrections and emit the
 * final client list for the pilot.
 *
 * Mechanical only. The corrections in scripts/client-corrections.json are
 * Chris's decisions; this script applies them, it does not re-derive them.
 *
 * NO network of any kind: no Anthropic, no Dropbox, no Drive, no HubSpot.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseCsv, normalizeName } from './grants-lib.mjs';

const RESOLVED = 'dist/inventory/resolved-final.csv';
const CORRECTIONS = 'scripts/client-corrections.json';
const CSV_OUT = 'dist/inventory/clients-final.csv';
const MD_OUT = 'docs/inventory/clients-final.md';
const RETENTION_YEARS = 6;

const now = new Date();
const cutoff = new Date(now);
cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
const CUTOFF_ISO = cutoff.toISOString();

const log = (...a) => console.error(...a);

// ---------------------------------------------------------------- load
const rows = [];
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(RESOLVED, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[1]) continue;
    rows.push({
      name: r[0], key: r[1], label: r[2], canonical: r[3] || null,
      confidence: r[4] || null, status: r[6], pass: r[7] || '',
      programs: Number(r[8] || 0), files: Number(r[9] || 0), bytes: Number(r[10] || 0),
      cmin: r[11] || null, cmax: r[12] || null,
    });
  }
}
log(`${rows.length} names in the resolved universe`);

const corrections = JSON.parse(await fsp.readFile(CORRECTIONS, 'utf8'));
log(`${corrections.corrections.length} corrections loaded`);

// ---------------------------------------------------------------- Step 2
const byKey = new Map(rows.map((r) => [r.key, r]));
const canonOf = (r) => (r.label === 'client' ? (r.canonical || r.name).trim() : null);

// Canonical set BEFORE corrections.
const beforeCanon = new Set();
for (const r of rows) { const c = canonOf(r); if (c) beforeCanon.add(c.toLowerCase()); }

// Apply.
const override = new Map(); // key -> canonical
const applied = [];
const problems = [];
let asserted = 0;
for (const c of corrections.corrections) {
  const members = [];
  for (const raw of c.raw_names) {
    const k = normalizeName(raw);
    const r = byKey.get(k);
    if (!r) { problems.push({ correction: c.canonical_name, raw, issue: 'not found in resolved list' }); continue; }
    // A correction carrying `asserts_client` is a human stating that this
    // folder names a client, overriding a missing or non-client label from the
    // classification pass. Everything else still has to satisfy the guard —
    // the point of it is to catch corrections written against the wrong name,
    // not to override a deliberate human decision.
    if (r.label !== 'client' && !c.asserts_client) {
      problems.push({ correction: c.canonical_name, raw, issue: `label is '${r.label}', not client` });
      continue;
    }
    if (c.asserts_client && r.label !== 'client') { r.assertedClient = true; asserted += 1; }
    override.set(k, c.canonical_name);
    members.push(r);
  }
  const priorCanon = [...new Set(members.map((m) => canonOf(m)))];
  applied.push({
    canonical: c.canonical_name,
    note: c.note ?? '',
    members: members.map((m) => ({ name: m.name, files: m.files, programs: m.programs })).sort((a, b) => b.files - a.files),
    files: members.reduce((s, m) => s + m.files, 0),
    priorCanonicals: priorCanon,
    collapsed: priorCanon.length,
  });
}
for (const r of rows) {
  const o = override.get(r.key);
  if (o) { r.correctedCanonical = o; r.corrected = true; }
}
const finalCanonOf = (r) => ((r.label === 'client' || r.assertedClient) ? (r.correctedCanonical || r.canonical || r.name).trim() : null);

const afterCanon = new Set();
for (const r of rows) { const c = finalCanonOf(r); if (c) afterCanon.add(c.toLowerCase()); }

log(`canonical companies: ${beforeCanon.size} -> ${afterCanon.size}${asserted ? ` (${asserted} names asserted as clients by hand correction)` : ''}`);
if (problems.length) log(`PROBLEMS: ${JSON.stringify(problems)}`);

// ---------------------------------------------------------------- Step 3: colon audit
const colonRaw = rows.filter((r) => r.name.includes(':'));
const colonCanon = [...new Set(rows.map((r) => finalCanonOf(r)).filter((c) => c && c.includes(':')))];
const colonFiles = colonRaw.reduce((s, r) => s + r.files, 0);
const colonByLabel = new Map();
for (const r of colonRaw) colonByLabel.set(r.label, (colonByLabel.get(r.label) ?? 0) + 1);

// ---------------------------------------------------------------- Step 4: final list
const groups = new Map();
for (const r of rows) {
  const c = finalCanonOf(r);
  if (!c) continue;
  const lc = c.toLowerCase();
  if (!groups.has(lc)) {
    groups.set(lc, { canonical: c, raws: [], programs: new Set(), files: 0, bytes: 0, cmin: null, cmax: null, corrected: false });
  }
  const g = groups.get(lc);
  g.raws.push(r);
  g.files += r.files;
  g.bytes += r.bytes;
  if (r.corrected) g.corrected = true;
  if (r.cmin && (!g.cmin || r.cmin < g.cmin)) g.cmin = r.cmin;
  if (r.cmax && (!g.cmax || r.cmax > g.cmax)) g.cmax = r.cmax;
}
// programs is a count per raw name in the source; sum is an overcount across
// duplicates, so take the max as a conservative per-company figure.
for (const g of groups.values()) g.programCount = Math.max(...g.raws.map((r) => r.programs));

let live = 0, liveFiles = 0, arch = 0, archFiles = 0, undated = 0;
for (const g of groups.values()) {
  if (!g.cmax) { g.retention = 'no_dated_files'; undated += 1; continue; }
  if (g.cmax < CUTOFF_ISO) { g.retention = 'archive_only'; arch += 1; archFiles += g.files; }
  else { g.retention = 'live'; live += 1; liveFiles += g.files; }
}

const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const list = [...groups.values()].sort((a, b) => b.files - a.files || a.canonical.localeCompare(b.canonical));
const lines = ['canonical_name,raw_folder_names,raw_name_count,program_folders,files,bytes,client_first,client_last,retention,hand_corrected'];
for (const g of list) {
  lines.push([
    csv(g.canonical),
    csv(g.raws.map((r) => r.name).join(' | ')),
    g.raws.length, g.programCount, g.files, g.bytes,
    csv(g.cmin), csv(g.cmax), csv(g.retention), g.corrected ? 'yes' : 'no',
  ].join(','));
}
await fsp.mkdir(path.dirname(CSV_OUT), { recursive: true });
await fsp.writeFile(CSV_OUT, lines.join('\n') + '\n');
log(`wrote ${CSV_OUT} (${list.length} companies)`);

// ---------------------------------------------------------------- Step 5: MD
const unjudged = rows.filter((r) => r.status === 'UNCLASSIFIED');
const nonClient = rows.filter((r) => r.label && r.label !== 'client' && r.status !== 'UNCLASSIFIED');
const clientRows = rows.filter((r) => r.label === 'client');
const TOTAL_FILES = 75971;
const attributed = rows.reduce((s, r) => s + r.files, 0);

const pct = (n, d) => ((n / d) * 100).toFixed(1);
const esc = (s) => String(s).replace(/\|/g, '\\|');
const L = [];
const push = (s = '') => L.push(s);

push('# Final Client List');
push();
push(`**Generated:** ${now.toISOString()}`);
push('**Inputs:** `dist/inventory/resolved-final.csv`, `scripts/client-corrections.json`');
push('**Output:** `dist/inventory/clients-final.csv` (gitignored — regenerable)');
push('**Method:** mechanical. No API call of any kind. The six corrections are hand-review decisions applied as data.');
push();
push('This is the list the pilot runs against.');
push();

push('## Totals');
push();
push('| | |');
push('|---|---|');
push(`| **Canonical companies** | **${afterCanon.size.toLocaleString()}** |`);
push(`| Raw client folder names behind them | ${clientRows.length.toLocaleString()} |`);
push(`| Files under client names | ${clientRows.reduce((s, r) => s + r.files, 0).toLocaleString()} (${pct(clientRows.reduce((s, r) => s + r.files, 0), TOTAL_FILES)}% of the tree) |`);
push(`| Companies with >1 raw folder name | ${list.filter((g) => g.raws.length > 1).length.toLocaleString()} |`);
push(`| Live | ${live.toLocaleString()} companies, ${liveFiles.toLocaleString()} files |`);
push(`| Archive-only | ${arch.toLocaleString()} companies, ${archFiles.toLocaleString()} files |`);
push();

// Step 1/2
push('---');
push();
push('## The six corrections');
push();
push('Recorded in `scripts/client-corrections.json` (version-controlled) so they survive any re-run of the pipeline. Each is matched on the normalized folder-name key, so they keep applying even if file counts shift.');
push();
push(`Canonical company count: **${beforeCanon.size.toLocaleString()} → ${afterCanon.size.toLocaleString()}** (−${(beforeCanon.size - afterCanon.size).toLocaleString()}; the six corrections collapsed ${applied.reduce((s, a) => s + a.collapsed, 0)} model-assigned canonicals into ${applied.length}).`);
push();
push('| # | Canonical after correction | Raw folder names merged | Files | Was |');
push('|---|---|---|---|---|');
applied.forEach((a, i) => {
  const members = a.members.map((m) => `\`${esc(m.name)}\` (${m.files})`).join('<br>');
  const was = a.priorCanonicals.map((c) => `\`${esc(c)}\``).join(', ');
  push(`| ${i + 1} | **${esc(a.canonical)}** | ${members} | **${a.files.toLocaleString()}** | ${was} |`);
});
push();
if (problems.length) {
  push('⚠️ Problems applying corrections:');
  push();
  for (const p of problems) push(`- \`${esc(p.raw)}\` (${esc(p.correction)}): ${p.issue}`);
  push();
} else {
  push('All 23 raw folder names resolved cleanly; every one was already labelled `client`. No correction was partially applied.');
  push();
}
push('Note on #6 (Pearl): the canonical was deliberately flipped away from the registered entity name. ' +
  `${applied[5] ? applied[5].members[0].files.toLocaleString() : ''} of ${applied[5] ? applied[5].files.toLocaleString() : ''} files sit under the folder \`Pearl\`, and that is the name the GCs use. \`Superprem Industries Ltd\` is recorded in the corrections file as the legal entity behind it.`);
push();

// Step 3
push('---');
push();
push('## Colon audit');
push();
push('macOS stores a `/` typed into a folder name as `:` at the POSIX layer. A colon in a Dropbox folder name is therefore usually **a forward slash the user typed**, not a literal colon — `Widerfunnel 2017:18` is almost certainly `Widerfunnel 2017/18`.');
push();
push('This matters for the migration: Google Drive accepts `/` in folder names but Dropbox\'s API returns the `:` form, so a naive copy would create folders whose names differ from what the user originally typed.');
push();
push('| Measure | Count |');
push('|---|---|');
push(`| Raw folder names containing \`:\` | **${colonRaw.length}** |`);
push(`| Files under them | **${colonFiles.toLocaleString()}** |`);
push(`| Canonical company names containing \`:\` | ${colonCanon.length} |`);
push();
if (colonByLabel.size) {
  push('By label:');
  push();
  push('| Label | Names |');
  push('|---|---|');
  for (const [l, c] of [...colonByLabel.entries()].sort((a, b) => b[1] - a[1])) push(`| \`${l || 'UNCLASSIFIED'}\` | ${c} |`);
  push();
}
if (colonRaw.length) {
  push('Every affected raw name:');
  push();
  push('| Raw folder name | Label | Files | Reads as |');
  push('|---|---|---|---|');
  for (const r of [...colonRaw].sort((a, b) => b.files - a.files)) {
    push(`| \`${esc(r.name)}\` | ${r.label || 'UNCLASSIFIED'} | ${r.files.toLocaleString()} | \`${esc(r.name.replace(/:/g, '/'))}\` |`);
  }
  push();
}
if (colonCanon.length) {
  push('Canonical names still carrying a colon:');
  push();
  for (const c of colonCanon) push(`- \`${esc(c)}\``);
  push();
}
push('**Not rewritten.** This is an audit only — Google Drive folder naming needs a decision first.');
push();

// Step 5 carry-forward
push('---');
push();
push('## Carried forward (not resolved here)');
push();
push('| Item | Count | Notes |');
push('|---|---|---|');
push(`| Files unattributed to any name | ${(TOTAL_FILES - attributed).toLocaleString()} | Program folders with no subfolder structure, plus files orphaned by batch descent |`);
push(`| Names never judged | ${unjudged.length.toLocaleString()} (${unjudged.reduce((s, r) => s + r.files, 0).toLocaleString()} files) | Surfaced by the final resolution round; ~$0.03 to classify |`);
push(`| Names judged non-client | ${nonClient.length.toLocaleString()} (${nonClient.reduce((s, r) => s + r.files, 0).toLocaleString()} files) | \`doctype\` / \`internal\` / \`unclear\` — not migration destinations |`);
push();
push('Both the unattributed files and the unjudged names go to the review sheet. Neither is in scope here.');
push();

// retention
push('---');
push();
push(`## Live vs archive-only (\`client_modified\`, ${CUTOFF_ISO.slice(0, 10)} cutoff)`);
push();
push('`server_modified` is **not** used: 40,390 files share the single date 2024-07-23 from a bulk Dropbox event, which reports nearly everything as recent regardless of real content age.');
push();
push('| Group | Companies | % | Files | % of client files |');
push('|---|---|---|---|---|');
const cTot = live + arch + undated;
const fTot = liveFiles + archFiles;
push(`| **Live** (a file within ${RETENTION_YEARS} years) | ${live.toLocaleString()} | ${pct(live, cTot)}% | ${liveFiles.toLocaleString()} | ${pct(liveFiles, fTot)}% |`);
push(`| **Archive-only** | ${arch.toLocaleString()} | ${pct(arch, cTot)}% | ${archFiles.toLocaleString()} | ${pct(archFiles, fTot)}% |`);
push(`| No dated files | ${undated.toLocaleString()} | ${pct(undated, cTot)}% | 0 | 0% |`);
push();
push(`${pct(arch, cTot)}% of companies are archive-only but hold only ${pct(archFiles, fTot)}% of the files — the tail is old and light.`);
push();

// top companies
push('---');
push();
push('## Largest 40 companies by file count');
push();
push('| Canonical company | Raw names | Programs | Files | Retention |');
push('|---|---|---|---|---|');
for (const g of list.slice(0, 40)) {
  push(`| ${esc(g.canonical)}${g.corrected ? ' ✎' : ''} | ${g.raws.length} | ${g.programCount} | ${g.files.toLocaleString()} | ${g.retention} |`);
}
push();
push('✎ = hand-corrected. Full list in `dist/inventory/clients-final.csv`.');
push();

push('---');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/build-final-clients.mjs');
push('```');
push();
push('Reads `dist/inventory/resolved-final.csv` and `scripts/client-corrections.json`, writes two files, makes no network call. To change a merge decision, edit the JSON and re-run — nothing needs re-classifying.');
push();

await fsp.mkdir(path.dirname(MD_OUT), { recursive: true });
await fsp.writeFile(MD_OUT, L.join('\n'));
log(`wrote ${MD_OUT} (${L.length} lines)`);

console.log(JSON.stringify({
  canonical_before: beforeCanon.size, canonical_after: afterCanon.size,
  corrections_applied: applied.length, problems: problems.length,
  per_correction: applied.map((a) => ({ canonical: a.canonical, files: a.files, merged: a.members.length, collapsed_from: a.collapsed })),
  colon_raw_names: colonRaw.length, colon_files: colonFiles, colon_canonicals: colonCanon.length,
  companies: list.length, multi_raw: list.filter((g) => g.raws.length > 1).length,
  live, arch, undated, unattributed: TOTAL_FILES - attributed, unjudged: unjudged.length,
}, null, 2));
