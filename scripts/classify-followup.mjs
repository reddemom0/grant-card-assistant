/**
 * classify-followup.mjs — Steps 2-6 of the follow-up classification pass.
 *
 * Classifies the names surfaced by batch re-resolution that have never been
 * judged, merges them into the canonical client list built by the first pass,
 * and writes the final review artifacts.
 *
 * The SYSTEM prompt and tool schema below are byte-identical to the first pass
 * (classify-clients.mjs) on purpose — same judgement criteria, same output
 * shape, so results from the two passes are directly comparable.
 *
 * Names only. No Dropbox, no Drive, no HubSpot. Anthropic API only.
 */

import 'dotenv/config';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { parseCsv } from './grants-lib.mjs';

const RESOLVED = 'dist/inventory/resolved-clients.csv';
const CLASSIFIED = 'dist/inventory/classified-clients.csv';
const INVENTORY = 'dist/inventory/grants-inventory.csv';
const CSV_OUT = 'dist/inventory/final-clients.csv';
const MD_OUT = 'docs/inventory/final-classification.md';
const STATE_OUT = path.join(process.env.CLASSIFY_STATE_DIR || '.', 'followup-state.json');

const MODEL = 'claude-sonnet-4-6';
const BATCH_SIZE = 50;
const CONCURRENCY = 4;
const RETENTION_YEARS = 6;
const PRICE_IN = 3.0;
const PRICE_OUT = 15.0;

const now = new Date();
const cutoff = new Date(now);
cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
const CUTOFF_ISO = cutoff.toISOString();

const log = (...a) => console.error(...a);

// ---------------------------------------------------------------- load
function readCsv(text) {
  const out = [];
  let header = null;
  for (const r of parseCsv(text)) {
    if (!header) { header = r; continue; }
    if (!r[0] && !r[1]) continue;
    out.push(r);
  }
  return out;
}

const resolved = readCsv(await fsp.readFile(RESOLVED, 'utf8')).map((r) => ({
  name: r[0], key: r[1], label: r[2] || null, canonical: r[3] || null,
  confidence: r[4] || null, retention: r[5] || null, status: r[6],
  programs: Number(r[7] || 0), files: Number(r[8] || 0), bytes: Number(r[9] || 0),
  cmin: r[10] || null, cmax: r[11] || null,
}));
log(`resolved universe: ${resolved.length} names`);

// First-pass judgements, for variant groups spanning BOTH passes.
const firstPass = new Map();
for (const r of readCsv(await fsp.readFile(CLASSIFIED, 'utf8'))) {
  firstPass.set(r[1], { name: r[0], label: r[2], canonical: r[3] || null, confidence: r[4] });
}

const unjudged = resolved.filter((r) => r.status === 'UNCLASSIFIED');
const judged = resolved.filter((r) => r.status !== 'UNCLASSIFIED');
log(`  ${judged.length} already judged, ${unjudged.length} to judge now`);

// Total file count for the coverage denominator — cheap scan, no full parse.
let totalFiles = 0;
{
  const t = await fsp.readFile(INVENTORY, 'utf8');
  const re = /,file,/g;
  while (re.exec(t) !== null) totalFiles += 1;
}
log(`  ${totalFiles} files in the inventory`);

// ---------------------------------------------------------------- Step 2
const SYSTEM = `You classify folder names from a grant consultancy's Dropbox file system.

Context: Granted Consulting helps Canadian companies apply for government grant programs. The file tree is organized as Grants/<grant program>/<...>/. At the level you are seeing, each folder usually holds one CLIENT COMPANY's documents for one grant program. But the level is not clean — it also contains document-type folders, fiscal-year batches, dates, and internal administrative folders.

Your job: for each name, decide what it is.

Labels:
- client: a real company, organization, or sole proprietor that would be a client. Includes abbreviations and misspellings of company names.
- doctype: a document or artifact category (Applications, Budget, Receipts, Payroll, Approval Docs, Final Claim, ...).
- batch: a fiscal-year or intake grouping (Client Files - 2021, 2016:2017 Clients, Applications 2020 and prior, ...).
- date: a bare date or month.
- internal: Granted Consulting's own internal material — templates, training, staff names used as owners, process folders, test folders, "Granted" itself.
- unclear: genuinely cannot tell.

For canonical_name: if and only if label is "client", give the properly-spelled company name (fix casing and obvious typos, expand an abbreviation only when you are confident). Otherwise null. Use the SAME canonical_name string for names that refer to the same company, so variants group together.

Confidence: high = certain; medium = probable; low = a guess.
Reason: one short line, under 12 words.

Names may be abbreviations, may carry legal suffixes (Inc, Ltd, Society), and may contain typos. A personal name is usually a client (sole proprietor) unless it clearly reads as a Granted staff owner. When torn between client and unclear, prefer the honest label over a guess.`;

const TOOL = {
  name: 'submit_classifications',
  description: 'Return one classification per input name, in the same order.',
  input_schema: {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The input name, echoed verbatim.' },
            label: { type: 'string', enum: ['client', 'doctype', 'batch', 'date', 'internal', 'unclear'] },
            canonical_name: { type: ['string', 'null'], description: 'Properly-spelled company name, or null if not a client.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            reason: { type: 'string' },
          },
          required: ['name', 'label', 'canonical_name', 'confidence', 'reason'],
        },
      },
    },
    required: ['classifications'],
  },
};

const normKey = (s) => s.trim().replace(/[\s.,;:_\-*]+$/u, '').replace(/\s+/g, ' ').toLowerCase();

const client = new Anthropic({ maxRetries: 5 });
const usage = { calls: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, failed: 0 };

async function classifyBatch(batch, idx) {
  const listing = batch
    .map((e, i) => `${i + 1}. ${e.name}   [in ${e.programs} program folder(s), ${e.files} files]`)
    .join('\n');

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_classifications' },
    messages: [{
      role: 'user',
      content: `Classify all ${batch.length} folder names below. Return exactly ${batch.length} classifications, in the same order.\n\n${listing}`,
    }],
  });

  usage.calls += 1;
  usage.input += res.usage.input_tokens ?? 0;
  usage.output += res.usage.output_tokens ?? 0;
  usage.cache_read += res.usage.cache_read_input_tokens ?? 0;
  usage.cache_write += res.usage.cache_creation_input_tokens ?? 0;

  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error(`batch ${idx}: no tool_use block`);
  const out = block.input.classifications ?? [];
  const byName = new Map(out.map((c) => [String(c.name).trim().toLowerCase(), c]));
  return batch.map((e, i) => {
    const c = out[i] && normKey(String(out[i].name)) === e.key
      ? out[i]
      : byName.get(e.name.toLowerCase()) ?? out[i] ?? null;
    return { entry: e, result: c };
  });
}

const batches = [];
for (let i = 0; i < unjudged.length; i += BATCH_SIZE) batches.push(unjudged.slice(i, i + BATCH_SIZE));
log(`\nSTEP 2 — ${batches.length} batches to ${MODEL}`);

let cursor = 0;
async function worker(id) {
  while (cursor < batches.length) {
    const idx = cursor++;
    try {
      for (const { entry, result } of await classifyBatch(batches[idx], idx)) {
        entry.label = result?.label ?? 'unclear';
        entry.canonical = result?.canonical_name ?? null;
        entry.confidence = result?.confidence ?? 'low';
        entry.reason = result?.reason ?? 'classification call failed';
        entry.newlyJudged = true;
      }
      log(`  batch ${idx + 1}/${batches.length} ok (worker ${id})`);
    } catch (err) {
      usage.failed += 1;
      log(`  batch ${idx + 1}/${batches.length} FAILED: ${err.message}`);
      for (const e of batches[idx]) {
        e.label = 'unclear'; e.canonical = null; e.confidence = 'low';
        e.reason = 'classification call failed'; e.newlyJudged = true;
      }
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

// ---------------------------------------------------------------- Step 3: merge
const canonOf = (e) => (e.label === 'client' ? (e.canonical || e.name).trim() : null);

// Canonical companies as they stood after pass 1.
const existingCanon = new Map(); // lc -> canonical display
for (const e of judged) {
  const c = canonOf(e);
  if (c && !existingCanon.has(c.toLowerCase())) existingCanon.set(c.toLowerCase(), c);
}

const newlyClient = unjudged.filter((e) => e.label === 'client');
const mergedInto = [];
const newCanonical = new Map(); // lc -> {canonical, members:[]}
for (const e of newlyClient) {
  const c = canonOf(e);
  const lc = c.toLowerCase();
  if (existingCanon.has(lc)) {
    mergedInto.push({ name: e.name, canonical: existingCanon.get(lc), files: e.files, programs: e.programs, confidence: e.confidence });
  } else {
    if (!newCanonical.has(lc)) newCanonical.set(lc, { canonical: c, members: [] });
    newCanonical.get(lc).members.push(e);
  }
}
const nonClientNew = unjudged.filter((e) => e.label !== 'client');

// Full canonical grouping across BOTH passes.
const groups = new Map();
for (const e of resolved) {
  const c = canonOf(e);
  if (!c) continue;
  const lc = c.toLowerCase();
  if (!groups.has(lc)) groups.set(lc, { canonical: c, members: [] });
  groups.get(lc).members.push(e);
}
const multiGroups = [...groups.values()]
  .filter((g) => g.members.length > 1)
  .map((g) => ({
    canonical: g.canonical,
    files: g.members.reduce((s, m) => s + m.files, 0),
    programs: Math.max(...g.members.map((m) => m.programs)),
    members: g.members
      .map((m) => ({ name: m.name, files: m.files, pass: m.newlyJudged ? 2 : 1, confidence: m.confidence }))
      .sort((a, b) => b.files - a.files),
  }))
  .sort((a, b) => b.files - a.files);

// ---------------------------------------------------------------- Step 4
const newBatch = unjudged.filter((e) => e.label === 'batch').sort((a, b) => b.files - a.files);
const newBatchFiles = newBatch.reduce((s, e) => s + e.files, 0);

// ---------------------------------------------------------------- Step 5
let liveNames = 0, liveFiles = 0, archNames = 0, archFiles = 0, undated = 0;
for (const e of resolved) {
  if (e.label !== 'client') { e.retentionFinal = 'n/a'; continue; }
  if (!e.cmax) { e.retentionFinal = 'no_dated_files'; undated += 1; continue; }
  if (e.cmax < CUTOFF_ISO) { e.retentionFinal = 'archive_only'; archNames += 1; archFiles += e.files; }
  else { e.retentionFinal = 'live'; liveNames += 1; liveFiles += e.files; }
}
const attributed = resolved.reduce((s, e) => s + e.files, 0);
const unattributed = totalFiles - attributed;
const clientNames = resolved.filter((e) => e.label === 'client');
const clientFiles = clientNames.reduce((s, e) => s + e.files, 0);

// ---------------------------------------------------------------- Step 6: CSV
const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const sorted = [...resolved].sort((a, b) => b.files - a.files || a.key.localeCompare(b.key));
const lines = ['name,normalized_key,label,canonical_name,confidence,retention,pass,programs,files,bytes,client_first,client_last'];
for (const e of sorted) {
  lines.push([
    csv(e.name), csv(e.key), csv(e.label), csv(canonOf(e)), csv(e.confidence),
    csv(e.retentionFinal), e.newlyJudged ? 2 : 1,
    e.programs, e.files, e.bytes, csv(e.cmin), csv(e.cmax),
  ].join(','));
}
await fsp.mkdir(path.dirname(CSV_OUT), { recursive: true });
await fsp.writeFile(CSV_OUT, lines.join('\n') + '\n');
log(`\nwrote ${CSV_OUT} (${sorted.length} rows)`);

const cost = (usage.input / 1e6) * PRICE_IN + (usage.output / 1e6) * PRICE_OUT;
const labelCounts = new Map();
for (const e of resolved) labelCounts.set(e.label ?? 'unlabelled', (labelCounts.get(e.label ?? 'unlabelled') ?? 0) + 1);
const newLabelCounts = new Map();
for (const e of unjudged) newLabelCounts.set(e.label, (newLabelCounts.get(e.label) ?? 0) + 1);

// ---------------------------------------------------------------- Step 6: MD
const pct = (n, d) => ((n / d) * 100).toFixed(1);
const L = [];
const push = (s = '') => L.push(s);
const esc = (s) => String(s).replace(/\|/g, '\\|');

push('# Final Client Classification');
push();
push(`**Generated:** ${now.toISOString()}`);
push(`**Model:** \`${MODEL}\` (follow-up pass, batches of ${BATCH_SIZE}, same prompt and schema as pass 1)`);
push('**Full results:** `dist/inventory/final-clients.csv` (gitignored — regenerable)');
push('**Scope:** folder names only. No Dropbox, Drive, or HubSpot call.');
push();
push('This is the review document. **Section “Variant groups” is the list to check by hand** — every canonical company that more than one raw folder name maps onto, across both classification passes.');
push();

push('## Headline');
push();
push('| | |');
push('|---|---|');
push(`| Names in the resolved universe | ${resolved.length.toLocaleString()} |`);
push(`| — judged in pass 1 | ${judged.length.toLocaleString()} |`);
push(`| — judged in this follow-up pass | ${unjudged.length.toLocaleString()} |`);
push(`| **Distinct canonical companies** | **${groups.size.toLocaleString()}** |`);
push(`| — new companies from this pass | ${newCanonical.size.toLocaleString()} |`);
push(`| — names that merged into an existing company | ${mergedInto.length.toLocaleString()} |`);
push(`| Variant groups needing review (>1 raw name) | **${multiGroups.length.toLocaleString()}** |`);
push(`| File coverage | ${attributed.toLocaleString()} / ${totalFiles.toLocaleString()} (${pct(attributed, totalFiles)}%) |`);
push(`| Follow-up API cost | $${cost.toFixed(2)} |`);
push();

// Step 1
push('---');
push();
push('## Step 1 — Library moved into the repo');
push();
push('`grants-lib.mjs` now lives at **`scripts/grants-lib.mjs`** and is version-controlled. It encodes every batch-detection decision in this project:');
push();
push('- the segment classifier (`classify`) with its year / date / doctype / corporate-suffix rules');
push('- `MODEL_BATCH_NAMES` — 83 batch folder names identified by the model, which the regex provably cannot catch');
push('- `isBatchName()` — the regex-OR-list predicate that drives branch descent');
push('- `loadRows` / `parseCsv` / `normalizeName` — the shared parsing and identity rules');
push();
push('The 83-name list is not reproducible without re-running the AI pass, which is why the file had to be tracked rather than left in a scratch directory. All three prior scripts were re-run against the moved path and reproduce their previous numbers exactly (1,635 names / 2,097 rows / 996 deduped).');
push();

// Step 2
push('---');
push();
push('## Step 2 — Classifying the previously unjudged names');
push();
push(`${unjudged.length} names in ${usage.calls} batched calls. ${usage.failed === 0 ? 'No call failed.' : `**${usage.failed} call(s) failed** — affected names recorded as \`unclear\`.`}`);
push();
push('| Label | Names |');
push('|---|---|');
for (const [k, v] of [...newLabelCounts.entries()].sort((a, b) => b[1] - a[1])) push(`| \`${k}\` | ${v.toLocaleString()} |`);
push();

// Step 3
push('---');
push();
push('## Step 3 — Merge into the canonical list');
push();
push('| Outcome | Names |');
push('|---|---|');
push(`| Formed a **new** canonical company | ${newCanonical.size.toLocaleString()} companies from ${[...newCanonical.values()].reduce((s, g) => s + g.members.length, 0).toLocaleString()} names |`);
push(`| **Merged into an existing** canonical company | ${mergedInto.length.toLocaleString()} |`);
push(`| Not a client (\`batch\`/\`doctype\`/\`internal\`/\`unclear\`/\`date\`) | ${nonClientNew.length.toLocaleString()} |`);
push();

push(`### Merged into existing companies (${mergedInto.length}) — every one`);
push();
if (mergedInto.length === 0) push('_None._');
else {
  push('These raw names were judged to be the same company as something already in the list. **Each is a merge that changes an existing group — review before anything moves.**');
  push();
  push('| Raw name (new) | Joined existing company | Files | Programs | Confidence |');
  push('|---|---|---|---|---|');
  for (const m of mergedInto.sort((a, b) => b.files - a.files)) {
    push(`| \`${esc(m.name)}\` | **${esc(m.canonical)}** | ${m.files.toLocaleString()} | ${m.programs} | ${m.confidence} |`);
  }
}
push();

push(`### Non-client labels from this pass (${nonClientNew.length})`);
push();
if (nonClientNew.length === 0) push('_None._');
else {
  push('| Name | Label | Files | Reason |');
  push('|---|---|---|---|');
  for (const e of nonClientNew.sort((a, b) => b.files - a.files)) {
    push(`| \`${esc(e.name)}\` | ${e.label} | ${e.files.toLocaleString()} | ${esc(e.reason ?? '')} |`);
  }
}
push();

// Step 4
push('---');
push();
push('## Step 4 — Is another re-resolution round needed?');
push();
if (newBatch.length === 0) {
  push('**No.** This pass labelled zero names `batch`, so `MODEL_BATCH_NAMES` is unchanged and no further re-resolution round is required. The batch skip list has converged.');
  push();
} else {
  push(`**Yes.** ${newBatch.length} name${newBatch.length === 1 ? '' : 's'} came back \`batch\` and would need adding to \`MODEL_BATCH_NAMES\`, followed by one more re-resolution round.`);
  push();
  push(`Those folders currently hold **${newBatchFiles.toLocaleString()} files** (${pct(newBatchFiles, totalFiles)}% of the tree). Re-resolving would push those files down to whatever sits beneath, surfacing a further tranche of unjudged names — and, as in the last round, orphaning any files sitting loose directly inside them.`);
  push();
  push('**Not run** — reported only, per scope.');
  push();
  push('| Name to add to the skip list | Files | Programs |');
  push('|---|---|---|');
  for (const e of newBatch) push(`| \`${esc(e.name)}\` | ${e.files.toLocaleString()} | ${e.programs} |`);
  push();
}

// Step 5
push('---');
push();
push('## Step 5 — Updated totals');
push();
push('| Measure | Value |');
push('|---|---|');
push(`| Distinct canonical companies | **${groups.size.toLocaleString()}** |`);
push(`| Names labelled \`client\` | ${clientNames.length.toLocaleString()} |`);
push(`| Files under client names | ${clientFiles.toLocaleString()} (${pct(clientFiles, totalFiles)}% of tree) |`);
push(`| Files attributed to any name | ${attributed.toLocaleString()} / ${totalFiles.toLocaleString()} (**${pct(attributed, totalFiles)}%**) |`);
push(`| Files still unattributed | ${unattributed.toLocaleString()} (${pct(unattributed, totalFiles)}%) |`);
push();
push('All labels across the resolved universe:');
push();
push('| Label | Names |');
push('|---|---|');
for (const [k, v] of [...labelCounts.entries()].sort((a, b) => b[1] - a[1])) push(`| \`${k}\` | ${v.toLocaleString()} |`);
push();
push(`### Retention (client names, \`client_modified\`, ${CUTOFF_ISO.slice(0, 10)} cutoff)`);
push();
push('`server_modified` is **not** used: 40,390 files share the single date 2024-07-23 from a bulk Dropbox event, which reports nearly everything as recent regardless of real content age.');
push();
push('| Group | Names | % | Files |');
push('|---|---|---|---|');
const rTot = liveNames + archNames + undated;
push(`| **Live** (a file within ${RETENTION_YEARS} years) | ${liveNames.toLocaleString()} | ${pct(liveNames, rTot)}% | ${liveFiles.toLocaleString()} |`);
push(`| **Archive-only** | ${archNames.toLocaleString()} | ${pct(archNames, rTot)}% | ${archFiles.toLocaleString()} |`);
push(`| No dated files | ${undated.toLocaleString()} | ${pct(undated, rTot)}% | 0 |`);
push();

// Variant groups — the review list
push('---');
push();
push(`## Variant groups — the hand-review list (${multiGroups.length})`);
push();
push('**Every canonical company that more than one raw folder name maps onto, across both passes.** Nothing here was merged silently; the raw names are untouched on disk. `pass` shows which classification round produced each name.');
push();
push('| Canonical company | Raw folder names (files, pass) | Programs | Total files |');
push('|---|---|---|---|');
for (const g of multiGroups) {
  const members = g.members.map((m) => `\`${esc(m.name)}\` (${m.files}, p${m.pass})`).join('<br>');
  push(`| **${esc(g.canonical)}** | ${members} | ${g.programs} | ${g.files.toLocaleString()} |`);
}
push();

// cost
push('---');
push();
push('## Cost and tokens (this pass)');
push();
push('| Metric | Value |');
push('|---|---|');
push(`| Model | \`${MODEL}\` |`);
push(`| API calls | ${usage.calls} (${usage.failed} failed) |`);
push(`| Input tokens | ${usage.input.toLocaleString()} |`);
push(`| Output tokens | ${usage.output.toLocaleString()} |`);
push(`| **Cost** | **$${cost.toFixed(4)}** |`);
push();
push(`At list rates $${PRICE_IN.toFixed(2)}/M input and $${PRICE_OUT.toFixed(2)}/M output. Combined with pass 1 ($1.4753), total spend on classification is **$${(cost + 1.4753).toFixed(2)}**.`);
push();

push('---');
push();
push('## Reproducing');
push();
push('```bash');
push('node scripts/classify-followup.mjs   # this pass');
push('```');
push();
push('The shared library is now `scripts/grants-lib.mjs` and is version-controlled. Re-running incurs the API cost again.');
push();

await fsp.mkdir(path.dirname(MD_OUT), { recursive: true });
await fsp.writeFile(MD_OUT, L.join('\n'));
log(`wrote ${MD_OUT} (${L.length} lines)`);

await fsp.writeFile(STATE_OUT, JSON.stringify({
  usage, cost, newCanonical: newCanonical.size, mergedInto: mergedInto.length,
  nonClientNew: nonClientNew.length, newBatch: newBatch.length, newBatchFiles,
  groups: groups.size, multiGroups: multiGroups.length,
  attributed, unattributed, totalFiles,
  retention: { liveNames, liveFiles, archNames, archFiles, undated },
}, null, 2));

console.log(JSON.stringify({
  judged_now: unjudged.length,
  labels: Object.fromEntries(newLabelCounts),
  new_canonical: newCanonical.size,
  merged_into_existing: mergedInto.length,
  total_canonical: groups.size,
  variant_groups: multiGroups.length,
  further_round_needed: newBatch.length > 0,
  new_batch_names: newBatch.length,
  new_batch_files: newBatchFiles,
  coverage: `${attributed}/${totalFiles}`,
  cost_usd: Number(cost.toFixed(4)),
  tokens: { in: usage.input, out: usage.output },
}, null, 2));
