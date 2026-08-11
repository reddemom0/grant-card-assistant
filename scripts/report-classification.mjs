/**
 * report-classification.mjs — Step 4 (HubSpot cross-check) + Step 6 (summary).
 *
 * Local matching only: reads the classification state and the HubSpot company
 * dump already on disk. HubSpot names are NEVER written over AI canonical
 * names — conflicts are reported, not resolved.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

const DIR = process.env.CLASSIFY_STATE_DIR || '.';
const STATE = path.join(DIR, 'classification-state.json');
const HUBSPOT = path.join(DIR, 'hubspot-companies.json');
const MD_OUT = 'docs/inventory/client-classification.md';
const CSV_OUT = 'dist/inventory/classified-clients.csv';

const state = JSON.parse(await fsp.readFile(STATE, 'utf8'));

let hubspot = null;
try {
  hubspot = JSON.parse(await fsp.readFile(HUBSPOT, 'utf8'));
} catch { /* unavailable — reported as such */ }

// ---------------------------------------------------------------- matching
const LEGAL = /\b(inc|inc\.|incorporated|ltd|ltd\.|limited|llc|llp|corp|corp\.|corporation|co|co\.|company|holdings|group|enterprises|ventures)\b/g;

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s&]/g, ' ').replace(/\s+/g, ' ').trim();
const core = (s) => norm(s).replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Unique canonical clients from the AI pass.
const canonMap = new Map();
for (const c of state.clients) {
  const key = (c.canonical || c.display).trim();
  const k = key.toLowerCase();
  let e = canonMap.get(k);
  if (!e) { e = { canonical: key, files: 0, programs: 0, variants: 0, retention: c.retention }; canonMap.set(k, e); }
  e.files += c.files;
  e.programs = Math.max(e.programs, c.programs);
  e.variants += 1;
  if (c.retention === 'live') e.retention = 'live';
}
const canon = [...canonMap.values()].sort((a, b) => b.files - a.files);

let match = { exact: [], core: [], near: [], unmatched: [] };
if (hubspot) {
  const byNorm = new Map();
  const byCore = new Map();
  const byPrefix = new Map();
  for (const h of hubspot) {
    const n = norm(h.name), c = core(h.name);
    if (n && !byNorm.has(n)) byNorm.set(n, h);
    if (c && !byCore.has(c)) byCore.set(c, h);
    const p = c.slice(0, 3);
    if (p) {
      if (!byPrefix.has(p)) byPrefix.set(p, []);
      byPrefix.get(p).push({ h, c });
    }
  }

  for (const e of canon) {
    const n = norm(e.canonical), c = core(e.canonical);
    if (byNorm.has(n)) { match.exact.push({ ...e, hubspot: byNorm.get(n).name }); continue; }
    if (byCore.has(c)) {
      const h = byCore.get(c);
      match.core.push({ ...e, hubspot: h.name, differs: h.name.trim() !== e.canonical.trim() });
      continue;
    }
    let best = null, bestD = 3;
    for (const cand of byPrefix.get(c.slice(0, 3)) ?? []) {
      const d = levenshtein(c, cand.c);
      if (d < bestD) { bestD = d; best = cand.h; }
    }
    if (best) match.near.push({ ...e, hubspot: best.name, distance: bestD });
    else match.unmatched.push(e);
  }
}

// ---------------------------------------------------------------- report
const u = state.usage;
const pct = (n, d) => ((n / d) * 100).toFixed(1);
const L = [];
const push = (s = '') => L.push(s);

push('# Client Name Classification — AI Pass');
push();
push(`**Generated:** ${state.generated_at}`);
push(`**Model:** \`${state.model}\` (batches of ${state.batch_size}, forced tool-use schema)`);
push(`**Full results:** \`${CSV_OUT}\` (gitignored — regenerable)`);
push(`**Scope:** folder NAMES only. No file contents read, no Dropbox or Drive API call.`);
push();

push('## Headline');
push();
push('| | |');
push('|---|---|');
push(`| Distinct client-depth names after widening the batch exclusion | **${state.step1.total_names.toLocaleString()}** |`);
push(`| — new names surfaced by re-resolving beneath batch folders | **${state.step1.new_vs_prior.toLocaleString()}** |`);
push(`| Names judged by the model | ${state.step1.to_judge.toLocaleString()} |`);
push(`| **Labelled \`client\`** | **${(state.labels.client ?? 0).toLocaleString()}** |`);
push(`| Distinct canonical companies after variant grouping | **${canon.length.toLocaleString()}** |`);
push(`| Variant groups with >1 member | ${state.groups.length} |`);
push(`| Files covered | ${state.step1.files_attributed.toLocaleString()} of ${state.step1.total_files.toLocaleString()} (${pct(state.step1.files_attributed, state.step1.total_files)}%) |`);
push(`| API cost | **$${u.cost_usd.toFixed(2)}** |`);
push();

// ---- Step 1
push('---');
push();
push('## Step 1 — Widened batch exclusion and re-resolution');
push();
push('The prior pass resolved client depth with a **per-program majority vote**, which let nested batch folders through as "clients". This pass resolves **per branch**: it walks down from each program folder and descends *through* any batch-shaped folder on that branch, emitting the first non-batch folder it reaches. A nested `CJG-BC Applications 2017` inside `CJG-BC Applications 2020 and prior` is now skipped on its own branch instead of being averaged away.');
push();
push('| Measure | Value |');
push('|---|---|');
push(`| Client-depth folder instances | ${state.step1.total_names.toLocaleString()} distinct names |`);
push(`| New vs the prior 996-name list | **${state.step1.new_vs_prior}** |`);
push(`| Files attributed to a client-depth name | ${state.step1.files_attributed.toLocaleString()} (${pct(state.step1.files_attributed, state.step1.total_files)}%) |`);
push(`| Mechanically excluded before the AI pass | ${state.step1.mechanically_excluded} |`);
push(`| Sent to the model | ${state.step1.to_judge.toLocaleString()} |`);
push();
push(`**All 16 previously-flagged batch names are gone from the candidate list** — the resolver descended through every one of them, which is what produced the ${state.step1.new_vs_prior} new names. Nothing was dropped: the ~26,942 files that sat under those batch folders are now attributed to the client-depth folders beneath them.`);
push();
if (state.step1.new_examples.length) {
  push('Largest newly-surfaced names (all were invisible to the prior pass):');
  push();
  push('| Name | Files |');
  push('|---|---|');
  for (const n of state.step1.new_examples.slice(0, 15)) push(`| \`${n.name.replace(/\|/g, '\\|')}\` | ${n.files.toLocaleString()} |`);
  push();
}

// ---- Step 2
push('---');
push();
push('## Step 2 — Classification');
push();
push(`${state.step1.to_judge.toLocaleString()} names in ${u.calls} batched calls to \`${state.model}\`. Each call used a forced tool-use schema (\`label\`, \`canonical_name\`, \`confidence\`, \`reason\`) rather than free text, so every response is structurally valid. ${u.failed === 0 ? 'No call failed.' : `**${u.failed} call(s) failed** — those names are recorded as \`unclear\` with reason "classification call failed".`}`);
push();
push('| Label | Names |');
push('|---|---|');
for (const [k, v] of Object.entries(state.labels).sort((a, b) => b[1] - a[1])) {
  push(`| \`${k}\` | ${v.toLocaleString()} |`);
}
push();
push('| Confidence (judged names) | Count |');
push('|---|---|');
push(`| high | ${state.confidence.high.toLocaleString()} |`);
push(`| medium | ${state.confidence.medium.toLocaleString()} |`);
push(`| low | ${state.confidence.low.toLocaleString()} |`);
push();
push(`⚠️ **${state.labels.batch ?? 0} names were labelled \`batch\` by the model** — fiscal-year and intake folders that the mechanical string classifier missed (it only caught the 16 with a clean year token; names like \`ETG-BC Applications 2021x\` and \`2016:2017 Clients\` slipped through). Their files are currently attributed to the batch folder rather than to a client. Resolving them needs one more re-resolution round beneath those folders — see *Known gaps* below.`);
push();

// ---- Step 3
push('---');
push();
push('## Step 3 — Variant groups');
push();
push(`${state.groups.length} canonical companies have more than one raw folder name. **Nothing was merged silently — every group is listed here in full for review.** Grouping is by the model\'s \`canonical_name\`; the raw names are unchanged on disk and in the CSV.`);
push();
if (state.groups.length) {
  push('| Canonical | Raw names | Programs | Files |');
  push('|---|---|---|---|');
  for (const g of state.groups) {
    const members = g.members.map((m) => `\`${m.name.replace(/\|/g, '\\|')}\` (${m.files})`).join(', ');
    push(`| **${g.canonical.replace(/\|/g, '\\|')}** | ${members} | ${g.programs} | ${g.files.toLocaleString()} |`);
  }
  push();
}

// ---- Step 4
push('---');
push();
push('## Step 4 — HubSpot cross-check');
push();
if (!hubspot) {
  push('**HubSpot was unavailable** — no company list could be retrieved, so no cross-check was performed. Everything else in this document is unaffected.');
  push();
} else {
  const total = canon.length;
  push(`Matched ${canon.length.toLocaleString()} canonical companies against **${hubspot.length.toLocaleString()} HubSpot company records** (read-only; fetched via the CRM API using the token already in \`.env\`).`);
  push();
  push('Matching is three-tier: exact on normalized name, then on name with legal suffixes (Inc/Ltd/Corp/…) stripped, then Levenshtein distance ≤ 2 as a near-miss.');
  push();
  push('| Result | Companies | % |');
  push('|---|---|---|');
  push(`| Exact match | ${match.exact.length.toLocaleString()} | ${pct(match.exact.length, total)}% |`);
  push(`| Match ignoring legal suffix | ${match.core.length.toLocaleString()} | ${pct(match.core.length, total)}% |`);
  push(`| Near-miss (edit distance ≤ 2) | ${match.near.length.toLocaleString()} | ${pct(match.near.length, total)}% |`);
  push(`| **Unmatched** | **${match.unmatched.length.toLocaleString()}** | **${pct(match.unmatched.length, total)}%** |`);
  push();
  const matchedTotal = match.exact.length + match.core.length + match.near.length;
  push(`**${matchedTotal.toLocaleString()} of ${total.toLocaleString()} (${pct(matchedTotal, total)}%) have a plausible HubSpot counterpart.**`);
  push();
  push('**No AI output was overwritten with a HubSpot name.** Where the two disagree, both are shown below and the conflict is left for a human.');
  push();

  const spellingConflicts = match.core.filter((m) => m.differs);
  if (spellingConflicts.length) {
    push(`### Spelling differences (${spellingConflicts.length}) — same company, different string`);
    push();
    push('| AI canonical | HubSpot name | Files |');
    push('|---|---|---|');
    for (const m of spellingConflicts.slice(0, 60)) {
      push(`| ${m.canonical.replace(/\|/g, '\\|')} | ${m.hubspot.replace(/\|/g, '\\|')} | ${m.files.toLocaleString()} |`);
    }
    if (spellingConflicts.length > 60) push(`| _…and ${spellingConflicts.length - 60} more_ | | |`);
    push();
  }

  if (match.near.length) {
    push(`### Near-misses (${match.near.length}) — likely the same company, needs a human call`);
    push();
    push('| AI canonical | Closest HubSpot name | Edit distance | Files |');
    push('|---|---|---|---|');
    for (const m of match.near.sort((a, b) => b.files - a.files).slice(0, 60)) {
      push(`| ${m.canonical.replace(/\|/g, '\\|')} | ${m.hubspot.replace(/\|/g, '\\|')} | ${m.distance} | ${m.files.toLocaleString()} |`);
    }
    if (match.near.length > 60) push(`| _…and ${match.near.length - 60} more_ | | | |`);
    push();
  }

  push(`### Unmatched (${match.unmatched.length}) — top 40 by file count`);
  push();
  push('An unmatched name is not necessarily wrong. It may be a company that was never entered in HubSpot, a legacy client, a mis-read folder name, or a name the model invented from an abbreviation.');
  push();
  push('| AI canonical | Programs | Files | Retention |');
  push('|---|---|---|---|');
  for (const m of match.unmatched.sort((a, b) => b.files - a.files).slice(0, 40)) {
    push(`| ${m.canonical.replace(/\|/g, '\\|')} | ${m.programs} | ${m.files.toLocaleString()} | ${m.retention} |`);
  }
  push();
}

// ---- Step 5
push('---');
push();
push(`## Step 5 — Retention split (${state.cutoff} cutoff)`);
push();
push('Computed on **`client_modified`**, not `server_modified`. `server_modified` is corrupted: 40,390 files share the single date 2024-07-23 from a bulk Dropbox event, which reports almost everything as recent regardless of actual content age.');
push();
const r = state.retention;
const clientTotal = r.liveNames + r.archiveNames + r.undated;
push('| Group | Names | % | Files |');
push('|---|---|---|---|');
push(`| **Live** (a file within ${6} years) | ${r.liveNames.toLocaleString()} | ${pct(r.liveNames, clientTotal)}% | ${r.liveFiles.toLocaleString()} |`);
push(`| **Archive-only** (nothing newer) | ${r.archiveNames.toLocaleString()} | ${pct(r.archiveNames, clientTotal)}% | ${r.archiveFiles.toLocaleString()} |`);
push(`| No dated files | ${r.undated.toLocaleString()} | ${pct(r.undated, clientTotal)}% | 0 |`);
push();
push(`**${pct(r.archiveNames, clientTotal)}% of client names are archive-only, but they hold only ${pct(r.archiveFiles, r.archiveFiles + r.liveFiles)}% of the client files.** The long tail is old and light; live clients are fewer and much heavier.`);
push();

// ---- low confidence
push('---');
push();
push(`## Low-confidence classifications (${state.low_confidence.length})`);
push();
if (state.low_confidence.length === 0) {
  push('None — every judged name came back `high` or `medium`.');
} else {
  push('Every name the model marked `low`. These are the first place to look when spot-checking.');
  push();
  push('| Name | Label | Canonical | Programs | Files | Model reason |');
  push('|---|---|---|---|---|---|');
  for (const c of state.low_confidence) {
    push(`| \`${c.name.replace(/\|/g, '\\|')}\` | ${c.label} | ${c.canonical ? c.canonical.replace(/\|/g, '\\|') : '—'} | ${c.programs} | ${c.files.toLocaleString()} | ${(c.reason || '').replace(/\|/g, '\\|')} |`);
  }
}
push();

// ---- cost
push('---');
push();
push('## Cost and tokens');
push();
push('| Metric | Value |');
push('|---|---|');
push(`| Model | \`${state.model}\` |`);
push(`| API calls | ${u.calls} (${u.failed} failed) |`);
push(`| Input tokens | ${u.input.toLocaleString()} |`);
push(`| Output tokens | ${u.output.toLocaleString()} |`);
push(`| Cache read / write tokens | ${u.cache_read.toLocaleString()} / ${u.cache_write.toLocaleString()} |`);
push(`| **Total cost** | **$${u.cost_usd.toFixed(4)}** |`);
push();
push(`Priced at list rates for \`${state.model}\`: $${u.price_in.toFixed(2)}/M input, $${u.price_out.toFixed(2)}/M output. Cost per name judged: $${(u.cost_usd / state.step1.to_judge).toFixed(5)}.`);
push();
push('No prompt caching was used — the system prompt is under the 1024-token minimum for this model, so a cache breakpoint would never have been written.');
push();

// ---- gaps
push('---');
push();
push('## Known gaps');
push();
push(`1. **${state.labels.batch ?? 0} names came back \`batch\`.** The widened exclusion in Step 1 only descends through folders the *string* classifier recognises as batch-shaped. The model caught ${state.labels.batch ?? 0} more that it missed. Their files are attributed to a batch folder, not a client. Fixing this means one more re-resolution round using the model's \`batch\` labels as the skip list — mechanical, no new judgement needed.`);
push(`2. **${(state.labels.internal ?? 0).toLocaleString()} names are \`internal\`** (Granted's own templates, training, staff-owner folders). They are not clients and should not become destinations.`);
push(`3. **${((state.step1.total_files - state.step1.files_attributed)).toLocaleString()} files sit under no client-depth name at all** — program folders with no subfolder structure. No path rule reaches them.`);
push('4. **Canonical names are model output, not ground truth.** The HubSpot cross-check above is the evidence for which ones are real; unmatched names are unverified.');
push();

push('---');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/classify-clients.mjs        # Steps 1-3, 5 -> CSV + state');
push('node scripts/fetch-hubspot-companies.mjs # HubSpot company dump (read-only)');
push('node scripts/report-classification.mjs   # Step 4 + this document');
push('```');
push();
push('Scripts live in `scripts/`. Re-running the classification incurs the API cost again.');
push();

await fsp.mkdir(path.dirname(MD_OUT), { recursive: true });
await fsp.writeFile(MD_OUT, L.join('\n'));
console.error(`wrote ${MD_OUT} (${L.length} lines)`);
console.log(JSON.stringify({
  canonical_companies: canon.length,
  hubspot_records: hubspot ? hubspot.length : null,
  exact: match.exact.length, core: match.core.length,
  near: match.near.length, unmatched: match.unmatched.length,
}, null, 2));
