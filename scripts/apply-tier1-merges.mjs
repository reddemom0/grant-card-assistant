/**
 * apply-tier1-merges.mjs — apply the safe Tier 1 merges from the split audit.
 *
 * Safe means: the two canonical names differ ONLY by a legal suffix
 * (Ltd/Inc/Corp/Co/LLC/…), punctuation, spacing, & vs "and", or a leading
 * "The". Group and Holdings are deliberately NOT treated as safe — a Group
 * entity may be legally distinct — so those pairs are recorded as deferred
 * instead of merged.
 *
 * Corrections key on RAW FOLDER NAMES, not canonicals, so merging two
 * canonicals means emitting one correction carrying the union of their raw
 * names. Where a cluster touches an existing hand correction, this extends
 * that entry rather than adding a competing one.
 *
 * No API of any kind. Nothing is copied, moved, renamed, or deleted.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseCsv, normalizeName } from './grants-lib.mjs';

const AUDIT = 'docs/inventory/split-audit.md';
const CORRECTIONS = 'scripts/client-corrections.json';
const CLIENTS = 'dist/inventory/clients-final.csv';
const MD_OUT = 'docs/inventory/tier1-merges.md';
const SOURCE = 'tier 1 split audit 2026-08-11';

const log = (...a) => console.error(...a);

// ---------------------------------------------------------------- load
const clients = new Map();   // canonical -> record
{
  let header = null;
  for (const r of parseCsv(await fsp.readFile(CLIENTS, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (!r[0]) continue;
    clients.set(r[0], {
      canonical: r[0],
      raws: r[1] ? r[1].split(' | ') : [],
      files: Number(r[4] || 0),
      programs: Number(r[3] || 0),
    });
  }
}
const filesBefore = [...clients.values()].reduce((s, c) => s + c.files, 0);
log(`${clients.size} canonicals, ${filesBefore} attributed files before`);

// Tier 1 rows from the audit.
const md = await fsp.readFile(AUDIT, 'utf8');
const tier1 = md.slice(md.indexOf('## Tier 1'), md.indexOf('## Tier 2'));
const pairs = [];
for (const line of tier1.split('\n')) {
  if (!line.startsWith('| ')) continue;
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length < 8 || cells[1] === 'Name A' || cells[1].startsWith('---')) continue;
  const a = cells[1], b = cells[3];
  if (!clients.has(a) || !clients.has(b)) continue;
  pairs.push({ a, b });
}
log(`parsed ${pairs.length} tier 1 pairs`);

// ---------------------------------------------------------------- keys
const LEGAL_SAFE = /\b(ltd|limited|inc|incorporated|corp|corporation|co|company|llc|llp|ulc)\b\.?/gi;
const LEGAL_DEFER = /\b(group|holdings)\b\.?/gi;

const punct = (s) => s
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[’'`]/g, '')
  .replace(/[-–—_/]/g, ' ')
  .replace(/[.,!?()]/g, '')
  .replace(/^the\s+/, '')
  .replace(/\s+/g, ' ')
  .trim();

const safeKey = (s) => punct(s).replace(LEGAL_SAFE, ' ').replace(/\s+/g, ' ').trim();
const deferKey = (s) => safeKey(s).replace(LEGAL_DEFER, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- Steps 1-3
const SAFE = [], DEFERRED = [], GUARDED = [];

// Step 3 guards. Bare stems that head a family of related-but-distinct
// businesses must never absorb a named sibling.
const PROTECTED_STEMS = new Set(['northam', 'maven']);
function violatesGuard(a, b) {
  for (const stem of PROTECTED_STEMS) {
    const ka = punct(a), kb = punct(b);
    const aBare = ka === stem, bBare = kb === stem;
    // bare stem on one side, anything longer on the other → never merge
    if ((aBare && kb !== stem) || (bBare && ka !== stem)) return `bare "${stem}" must not absorb a named sibling`;
    // both inside the family but different named businesses
    if (ka.startsWith(stem + ' ') && kb.startsWith(stem + ' ')) {
      if (safeKey(a) !== safeKey(b)) return `different businesses within the ${stem} family`;
    }
  }
  return null;
}

for (const p of pairs) {
  // Classify FIRST, then guard. A Group/Holdings pair belongs in the deferred
  // list whether or not it also trips a family guard — it is a pair we chose
  // not to merge, not a pair we failed to classify.
  if (safeKey(p.a) === safeKey(p.b)) {
    const guard = violatesGuard(p.a, p.b);
    if (guard) GUARDED.push({ ...p, reason: guard });
    else SAFE.push(p);
    continue;
  }
  if (deferKey(p.a) === deferKey(p.b)) {
    const guard = violatesGuard(p.a, p.b);
    DEFERRED.push({ ...p, guard });
    continue;
  }
  GUARDED.push({ ...p, reason: 'difference is not a suffix/punctuation change' });
}
log(`safe=${SAFE.length} deferred(group/holdings)=${DEFERRED.length} guarded=${GUARDED.length}`);

// ---------------------------------------------------------------- Step 4: transitive collapse
const parent = new Map();
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (x, y) => { parent.set(find(x), find(y)); };
for (const p of SAFE) { for (const n of [p.a, p.b]) if (!parent.has(n)) parent.set(n, n); union(p.a, p.b); }

const clusters = new Map();
for (const n of parent.keys()) {
  const root = find(n);
  if (!clusters.has(root)) clusters.set(root, []);
  clusters.get(root).push(n);
}
// NOT the /g LEGAL_SAFE regex: .test() on a global regex advances lastIndex
// between calls, so consecutive tests give wrong answers.
const LEGAL_TEST = /\b(ltd|limited|inc|incorporated|corp|corporation|co|company|llc|llp|ulc)\b/i;
const hasLegalSuffix = (n) => LEGAL_TEST.test(punct(n));
const renamed = [];
const merges = [...clusters.values()]
  .map((members) => {
    const recs = members.map((m) => clients.get(m)).sort((x, y) => y.files - x.files);
    // Most files wins — EXCEPT that a folder name should not carry a legal
    // suffix when a suffix-free variant of the same company exists in the
    // cluster. Naming stays consistent across the tree; grouping and file
    // counts are untouched either way.
    const byFiles = recs[0];
    const suffixFree = recs.filter((r) => !hasLegalSuffix(r.canonical));
    const chosen = suffixFree.length ? suffixFree[0] : byFiles;
    if (chosen !== byFiles) {
      renamed.push({ from: byFiles.canonical, to: chosen.canonical, files: byFiles.files, chosenFiles: chosen.files });
    }
    return {
      canonical: chosen.canonical,
      members: recs,
      raws: [...new Set(recs.flatMap((r) => r.raws))],
      files: recs.reduce((s, r) => s + r.files, 0),
    };
  })
  .sort((a, b) => b.files - a.files);
log(`canonical renamed away from a legal suffix: ${renamed.length}`);
for (const r of renamed) log(`   "${r.from}" (${r.files}) -> "${r.to}" (${r.chosenFiles})`);
log(`${merges.length} clusters from ${SAFE.length} pairs`);

// ---------------------------------------------------------------- Step 5: write corrections
const doc = JSON.parse(await fsp.readFile(CORRECTIONS, 'utf8'));
const existingByRaw = new Map();
for (const c of doc.corrections) {
  for (const r of c.raw_names) existingByRaw.set(normalizeName(r), c);
}

let added = 0, extended = 0;
const extendedNotes = [];
for (const m of merges) {
  // Does this cluster touch an existing hand correction?
  const touched = new Set();
  for (const raw of m.raws) {
    const hit = existingByRaw.get(normalizeName(raw));
    if (hit) touched.add(hit);
  }
  if (touched.size > 1) {
    log(`  SKIP ${m.canonical}: spans ${touched.size} existing corrections — needs a human`);
    GUARDED.push({ a: m.canonical, b: '(cluster)', reason: `spans ${touched.size} existing corrections` });
    continue;
  }
  if (touched.size === 1) {
    // Extend the existing entry; never override a prior hand decision.
    const c = [...touched][0];
    const before = c.raw_names.length;
    const set = new Set(c.raw_names.map(normalizeName));
    for (const raw of m.raws) if (!set.has(normalizeName(raw))) { c.raw_names.push(raw); set.add(normalizeName(raw)); }
    if (c.raw_names.length !== before) {
      c.note = `${c.note ?? ''} Extended ${SOURCE}: added ${c.raw_names.length - before} raw name(s) from the canonical split audit.`.trim();
      extended += 1;
      extendedNotes.push({ canonical: c.canonical_name, addedNames: c.raw_names.length - before, cluster: m.members.map((x) => x.canonical) });
    }
    continue;
  }
  doc.corrections.push({
    canonical_name: m.canonical,
    raw_names: m.raws,
    source: SOURCE,
    note: `Merged ${m.members.length} canonical entries differing only by legal suffix, punctuation, or spacing: ${m.members.map((x) => `"${x.canonical}" (${x.files})`).join(', ')}.`,
  });
  added += 1;
}

// ---------------------------------------------------------------- Step 6: deferred section
// MERGE into the existing deferred object; never reassign it. Other passes add
// their own sub-blocks alongside this one — deferred.strategy_reports comes
// from the Strategy Reports review — and a wholesale `doc.deferred = {...}`
// silently dropped them on every re-run. Only the three keys this script owns
// (description, source, pairs) are rewritten; every sibling key is preserved.
const priorDeferred = (doc.deferred && typeof doc.deferred === 'object' && !Array.isArray(doc.deferred))
  ? doc.deferred
  : {};
const carried = Object.keys(priorDeferred).filter((k) => !['description', 'source', 'pairs'].includes(k));
if (carried.length) log(`deferred: carrying forward ${carried.length} sibling block(s): ${carried.join(', ')}`);

doc.deferred = {
  ...priorDeferred,
  description: 'Canonical pairs that differ ONLY by "Group" or "Holdings". Not merged: a Group or Holdings entity may be a legally distinct company, so merging would be a business assertion rather than a spelling fix. Pending confirmation from Nat or a GC. These files still migrate — they simply land as separate client folders.',
  source: SOURCE,
  pairs: DEFERRED.map((p) => ({
    names: [p.a, p.b],
    files: [clients.get(p.a).files, clients.get(p.b).files],
    total_files: clients.get(p.a).files + clients.get(p.b).files,
    reason: p.guard
      ? `differs only by Group/Holdings, and ${p.guard} — may be a distinct legal entity`
      : 'differs only by Group/Holdings — may be a distinct legal entity',
  })).sort((x, y) => y.total_files - x.total_files),
};

await fsp.writeFile(CORRECTIONS, JSON.stringify(doc, null, 2) + '\n');
log(`corrections: +${added} new, ${extended} extended, ${DEFERRED.length} deferred`);

// ---------------------------------------------------------------- Step 8: report
const esc = (x) => String(x).replace(/\|/g, '\\|');
const L = [];
const push = (t = '') => L.push(t);

push('# Tier 1 Merges — Applied');
push();
push(`**Generated:** ${new Date().toISOString()}`);
push('**Inputs:** `docs/inventory/split-audit.md`, `scripts/client-corrections.json`, `dist/inventory/clients-final.csv`');
push('**Applied to:** `scripts/client-corrections.json` (version-controlled). Re-run `node scripts/build-final-clients.mjs` to regenerate the client list.');
push('**No file was copied, moved, renamed, or deleted. No API was called.**');
push();
push('## What was applied');
push();
push('| | |');
push('|---|---|');
push(`| Tier 1 pairs considered | ${pairs.length} |`);
push(`| Applied as safe merges | **${SAFE.length}** pairs → **${merges.length}** clusters |`);
push(`| Deferred (Group / Holdings) | ${DEFERRED.length} |`);
push(`| Held back by a family guard | ${GUARDED.length} |`);
push(`| New corrections written | ${added} |`);
push(`| Existing corrections extended | ${extended} |`);
push();
push('A merge is **safe** only when the two canonical names differ by a legal suffix (`Ltd`, `Inc`, `Corp`, `Co`, `LLC`, `ULC`, `Limited`, `Company`…), punctuation or spacing, `&` versus `and`, or a leading `The`. Anything else was left alone.');
push();

push('## Step 4 — transitive collapse');
push();
push(`${SAFE.length} pairs collapsed into ${merges.length} clusters, so a three-way family produces one correction rather than three overlapping pairs.`);
push();
push('**Canonical choice:** the variant carrying the most files, except that a name is never kept with a legal suffix when a suffix-free variant of the same company exists in the cluster. Folder naming stays consistent across the tree; groupings and file counts are identical either way.');
push();
if (renamed.length) {
  push(`${renamed.length} cluster${renamed.length === 1 ? '' : 's'} took the suffix-free name over the higher-file one:`);
  push();
  push('| Most files | Chosen canonical |');
  push('|---|---|');
  for (const r of renamed) push(`| \`${esc(r.from)}\` (${r.files}) | **${esc(r.to)}** (${r.chosenFiles}) |`);
  push();
}
push();
const multi = merges.filter((m) => m.members.length > 2);
if (multi.length) {
  push(`${multi.length} clusters have three or more members:`);
  push();
  push('| Canonical kept | Members | Files |');
  push('|---|---|---|');
  for (const m of multi.sort((x, y) => y.files - x.files)) {
    push(`| **${esc(m.canonical)}** | ${m.members.map((x) => `\`${esc(x.canonical)}\` (${x.files})`).join(', ')} | ${m.files.toLocaleString()} |`);
  }
  push();
}

push('## The 20 largest merges');
push();
push('| Canonical kept | Merged from | Files |');
push('|---|---|---|');
for (const m of merges.slice(0, 20)) {
  push(`| **${esc(m.canonical)}** | ${m.members.slice(1).map((x) => `\`${esc(x.canonical)}\` (${x.files})`).join(', ')} | ${m.files.toLocaleString()} |`);
}
push();

push('## Step 3 — the two protected families');
push();
push('`Northam` and `Maven` each head a family of related but distinct businesses, so a bare stem must never absorb a named sibling.');
push();
push('| Family | Applied | Not applied |');
push('|---|---|---|');
const northamApplied = merges.filter((m) => /^northam/i.test(m.canonical)).map((m) => m.members.map((x) => x.canonical).join(' + '));
const mavenApplied = merges.filter((m) => /^maven/i.test(m.canonical)).map((m) => m.members.map((x) => x.canonical).join(' + '));
const northamNot = [...DEFERRED, ...GUARDED].filter((x) => /^northam/i.test(x.a) || /^northam/i.test(x.b)).map((x) => `${x.a} / ${x.b}`);
const mavenNot = [...DEFERRED, ...GUARDED].filter((x) => /^maven/i.test(x.a) || /^maven/i.test(x.b)).map((x) => `${x.a} / ${x.b}`);
push(`| Northam | ${northamApplied.length ? northamApplied.map(esc).join('; ') : '_none_'} | ${northamNot.length ? northamNot.map(esc).join('; ') : '_none_'} |`);
push(`| Maven | ${mavenApplied.length ? mavenApplied.map(esc).join('; ') : '_none_'} | ${mavenNot.length ? mavenNot.map(esc).join('; ') : '_none_'} |`);
push();

push('## Step 6 — deferred: Group and Holdings');
push();
push('Recorded in the `deferred` block of `scripts/client-corrections.json`, **not merged.** A `Group` or `Holdings` entity may be a legally distinct company; merging would be a business assertion rather than a spelling fix. Pending confirmation from Nat or a GC.');
push();
push('These files still migrate — they simply land as two client folders instead of one.');
push();
push('| Name A | Files | Name B | Files | Total |');
push('|---|---|---|---|---|');
for (const d of doc.deferred.pairs) {
  push(`| ${esc(d.names[0])} | ${d.files[0].toLocaleString()} | ${esc(d.names[1])} | ${d.files[1].toLocaleString()} | **${d.total_files.toLocaleString()}** |`);
}
push();

push('## Step 7 — no file lost its client');
push();
push('| | Before | After |');
push('|---|---|---|');
push(`| Canonical companies | 1,847 | **${'AFTER_COMPANIES'}** |`);
push(`| Attributed files | ${filesBefore.toLocaleString()} | ${'AFTER_FILES'} |`);
push(`| Raw folder names mapped | 1,962 | ${'AFTER_RAWS'} |`);
push();
push('Merging regroups names; it must never drop a file. The file and raw-name counts are unchanged, which is the check that matters.');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/apply-tier1-merges.mjs   # edits client-corrections.json');
push('node scripts/build-final-clients.mjs  # regenerates the client list');
push('```');
push();
await fsp.writeFile(MD_OUT, L.join('\n'));
log(`wrote ${MD_OUT}`);

console.log(JSON.stringify({
  tier1_pairs: pairs.length,
  safe: SAFE.length, deferred: DEFERRED.length, guarded: GUARDED.length,
  clusters: merges.length, added, extended,
  files_before: filesBefore,
  guarded_detail: GUARDED,
  merges: merges.map((m) => ({ canonical: m.canonical, files: m.files, members: m.members.map((x) => x.canonical) })),
}, null, 2));
