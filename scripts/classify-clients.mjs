/**
 * classify-clients.mjs — Steps 1-3 & 5 of the client-name classification pass.
 *
 * Step 1 widens the batch exclusion and re-resolves client depth PER BRANCH
 * (the prior pass used a per-program majority vote, which let nested batch
 * folders through as "clients"). Steps 2-3 send the surviving names to Claude
 * in batches for classification and variant grouping. Step 5 splits by
 * retention using client_modified.
 *
 * Reads folder NAMES only. No Dropbox or Drive API call, no file contents.
 * Writes dist/inventory/classified-clients.csv and a state file in the
 * state file for the reporting step.
 */

import 'dotenv/config';
import fsp from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { loadRows, classifyCached, parseCsv } from './grants-lib.mjs';

const CSV_IN = 'dist/inventory/grants-inventory.csv';
const PRIOR_CSV = 'dist/inventory/candidate-clients.csv';
const CSV_OUT = 'dist/inventory/classified-clients.csv';
const STATE_OUT = path.join(
  process.env.CLASSIFY_STATE_DIR || '.',
  'classification-state.json'
);

const MODEL = 'claude-sonnet-4-6';
const BATCH_SIZE = 50;
const CONCURRENCY = 4;
const MAX_SKIP = 6;
const RETENTION_YEARS = 6;

// Sonnet 4.6 list pricing, USD per million tokens.
const PRICE_IN = 3.0;
const PRICE_OUT = 15.0;

const now = new Date();
const cutoff = new Date(now);
cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
const CUTOFF_ISO = cutoff.toISOString();

const log = (...a) => console.error(...a);

log('reading inventory...');
const rows = loadRows(await fsp.readFile(CSV_IN, 'utf8'));
const files = rows.filter((r) => r.isFile);
log(`  ${rows.length} rows, ${files.length} files`);

// ============================================================ Step 1
// Per-branch client-depth resolution.
const childrenByParent = new Map();
const programs = [];

for (const r of rows) {
  if (r.isFile) continue;
  const key = r.segs.join('/');
  if (r.segs.length === 1) {
    programs.push({ name: r.name, key });
    continue;
  }
  const parent = r.segs.slice(0, -1).join('/');
  if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
  childrenByParent.get(parent).push({ name: r.name, key });
}

/**
 * Walk down from a program, descending THROUGH any folder whose name is
 * batch-shaped, and emit the first non-batch folder on each branch as the
 * client-depth node. This is what fixes the prior pass's failure: a nested
 * "CJG-BC Applications 2017" inside "…2020 and prior" is skipped on its own
 * branch rather than being averaged away by a whole-program vote.
 */
function resolveClientNodes(programKey) {
  const out = [];
  const stack = (childrenByParent.get(programKey) ?? []).map((c) => ({ ...c, skips: 0 }));
  while (stack.length) {
    const node = stack.pop();
    if (classifyCached(node.name) === 'batch' && node.skips < MAX_SKIP) {
      for (const c of childrenByParent.get(node.key) ?? []) {
        stack.push({ ...c, skips: node.skips + 1 });
      }
    } else {
      out.push({ name: node.name, key: node.key, batchLevels: node.skips });
    }
  }
  return out;
}

const clientNodes = new Map(); // key -> {name, program, batchLevels}
let programsWithNodes = 0;
for (const p of programs) {
  const nodes = resolveClientNodes(p.key);
  if (nodes.length) programsWithNodes += 1;
  for (const n of nodes) {
    clientNodes.set(n.key, { name: n.name, program: p.name, batchLevels: n.batchLevels });
  }
}
log(`  ${clientNodes.size} client-depth folder instances across ${programsWithNodes} programs`);

// Attribute each file to the nearest client-depth ancestor.
const agg = new Map(); // normKey -> record
const normalizeKey = (s) =>
  s.trim().replace(/[\s.,;:_\-*]+$/u, '').replace(/\s+/g, ' ').toLowerCase();

function touch(name) {
  const key = normalizeKey(name);
  let e = agg.get(key);
  if (!e) {
    e = {
      key, display: name.trim(), variants: new Set(), programs: new Set(),
      files: 0, bytes: 0, cmin: null, cmax: null, smin: null, smax: null,
      batchLevels: new Set(), _best: -1,
    };
    agg.set(key, e);
  }
  e.variants.add(name.trim());
  return e;
}

for (const [, node] of clientNodes) {
  const e = touch(node.name);
  e.programs.add(node.program);
  e.batchLevels.add(node.batchLevels);
}

let attributed = 0;
for (const f of files) {
  const folderSegs = f.segs.slice(0, -1);
  let hit = null;
  for (let k = 1; k <= folderSegs.length; k++) {
    const prefix = folderSegs.slice(0, k).join('/');
    if (clientNodes.has(prefix)) { hit = clientNodes.get(prefix); break; }
  }
  if (!hit) continue;
  attributed += 1;
  const e = touch(hit.name);
  e.programs.add(hit.program);
  e.files += 1;
  e.bytes += f.size;
  if (f.cm) {
    if (!e.cmin || f.cm < e.cmin) e.cmin = f.cm;
    if (!e.cmax || f.cm > e.cmax) e.cmax = f.cm;
  }
  if (f.sm) {
    if (!e.smin || f.sm < e.smin) e.smin = f.sm;
    if (!e.smax || f.sm > e.smax) e.smax = f.sm;
  }
}
// Pick the highest-file variant as the display form.
for (const e of agg.values()) {
  let best = null, bestN = -1;
  for (const v of e.variants) if (v.length > bestN) { best = v; bestN = v.length; }
  e.display = best ?? e.display;
}
log(`  attributed ${attributed} files to ${agg.size} distinct names`);

// What the prior pass produced, so we can report what's new.
const priorNames = new Set();
try {
  let header = null;
  for (const r of parseCsv(await fsp.readFile(PRIOR_CSV, 'utf8'))) {
    if (!header) { header = r; continue; }
    if (r[1]) priorNames.add(r[1]);
  }
} catch { /* prior file absent — treat everything as new */ }

const allNames = [...agg.values()];
const newNames = allNames.filter((e) => !priorNames.has(e.key));

// Widened exclusion: batch-shaped names are now dropped outright, alongside the
// prior conservative keyword/bare-year list.
const EXCLUDE_TERMS = [
  'claim', 'claims', 'reimbursement', 'reimbursements',
  'paystub', 'paystubs', 'pay stub', 'pay stubs',
  'invoice', 'invoices', 'invoicing', 'template', 'templates',
];
const BARE_YEAR = /^(19|20)\d{2}(\s*[-–:/]\s*(19|20)?\d{2})?$/;

function mechanicalExclusion(e) {
  if (classifyCached(e.display) === 'batch') return 'batch-shaped';
  if (BARE_YEAR.test(e.key)) return 'bare year';
  const words = new Set(e.key.split(/[^a-z0-9]+/u).filter(Boolean));
  for (const t of EXCLUDE_TERMS) {
    if (e.key === t) return `exact: ${t}`;
    if (!t.includes(' ') && words.has(t)) return `keyword: ${t}`;
    if (t.includes(' ') && e.key.includes(t)) return `keyword: ${t}`;
  }
  return null;
}

for (const e of allNames) e.mechanical = mechanicalExclusion(e);
const excludedMech = allNames.filter((e) => e.mechanical);
const toJudge = allNames.filter((e) => !e.mechanical);

log(`\nSTEP 1 RESULT`);
log(`  distinct client-depth names now: ${allNames.length}`);
log(`  new vs prior pass: ${newNames.length}`);
log(`  mechanically excluded: ${excludedMech.length} (${excludedMech.filter((e) => e.mechanical === 'batch-shaped').length} batch-shaped)`);
log(`  going to the AI pass: ${toJudge.length}`);

// ============================================================ Step 2
if (process.env.CLASSIFY_DRY_RUN) {
  const est = Math.ceil(toJudge.length / BATCH_SIZE);
  log(`\nDRY RUN — ${est} batches would be sent. Stopping before any API call.`);
  log(`  sample of names to judge:`);
  for (const e of toJudge.sort((a, b) => b.files - a.files).slice(0, 25)) {
    log(`    ${String(e.files).padStart(6)}  ${e.display}`);
  }
  process.exit(0);
}

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

const client = new Anthropic({ maxRetries: 5 });
const usage = { calls: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, failed: 0 };

async function classifyBatch(batch, idx) {
  const listing = batch
    .map((e, i) => `${i + 1}. ${e.display}   [in ${e.programs.size} program folder(s), ${e.files} files]`)
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

  // Match by position; fall back to name match if the model reordered.
  const byName = new Map(out.map((c) => [String(c.name).trim().toLowerCase(), c]));
  return batch.map((e, i) => {
    const c = out[i] && normalizeKey(String(out[i].name)) === e.key
      ? out[i]
      : byName.get(e.display.toLowerCase()) ?? out[i] ?? null;
    return { entry: e, result: c };
  });
}

const batches = [];
for (let i = 0; i < toJudge.length; i += BATCH_SIZE) batches.push(toJudge.slice(i, i + BATCH_SIZE));
log(`\nSTEP 2 — ${batches.length} batches of up to ${BATCH_SIZE} to ${MODEL}`);

const results = [];
let cursor = 0;
async function worker(id) {
  while (cursor < batches.length) {
    const idx = cursor++;
    try {
      const r = await classifyBatch(batches[idx], idx);
      results.push(...r);
      log(`  batch ${idx + 1}/${batches.length} ok (worker ${id})`);
    } catch (err) {
      usage.failed += 1;
      log(`  batch ${idx + 1}/${batches.length} FAILED: ${err.message}`);
      for (const e of batches[idx]) results.push({ entry: e, result: null });
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

for (const { entry, result } of results) {
  entry.label = result?.label ?? 'unclear';
  entry.canonical = result?.canonical_name ?? null;
  entry.confidence = result?.confidence ?? 'low';
  entry.reason = result?.reason ?? (result ? '' : 'classification call failed');
  entry.judged = Boolean(result);
}
for (const e of excludedMech) {
  e.label = classifyCached(e.display) === 'batch' ? 'batch' : 'doctype';
  e.canonical = null;
  e.confidence = 'high';
  e.reason = `mechanically excluded (${e.mechanical})`;
  e.judged = false;
}

// ============================================================ Step 3
const groups = new Map();
for (const e of allNames) {
  if (e.label !== 'client' || !e.canonical) continue;
  const gk = e.canonical.trim().toLowerCase();
  if (!groups.has(gk)) groups.set(gk, { canonical: e.canonical.trim(), members: [] });
  groups.get(gk).members.push(e);
}
const multiGroups = [...groups.values()]
  .filter((g) => g.members.length > 1)
  .map((g) => ({
    canonical: g.canonical,
    members: g.members.map((m) => ({
      name: m.display, files: m.files, programs: m.programs.size, confidence: m.confidence,
    })).sort((a, b) => b.files - a.files),
    files: g.members.reduce((s, m) => s + m.files, 0),
    programs: new Set(g.members.flatMap((m) => [...m.programs])).size,
  }))
  .sort((a, b) => b.files - a.files);

// ============================================================ Step 5
let archiveNames = 0, archiveFiles = 0, liveNames = 0, liveFiles = 0, undated = 0;
for (const e of allNames) {
  if (e.label !== 'client') { e.retention = 'n/a'; continue; }
  if (!e.cmax) { e.retention = 'no_dated_files'; undated += 1; continue; }
  if (e.cmax < CUTOFF_ISO) { e.retention = 'archive_only'; archiveNames += 1; archiveFiles += e.files; }
  else { e.retention = 'live'; liveNames += 1; liveFiles += e.files; }
}

// ============================================================ outputs
const csv = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const sorted = allNames.sort((a, b) => b.files - a.files || a.key.localeCompare(b.key));
const lines = ['name,normalized_key,label,canonical_name,confidence,reason,variant_count,programs,files,bytes,client_first,client_last,server_last,retention,judged_by,batch_levels_above'];
for (const e of sorted) {
  lines.push([
    csv(e.display), csv(e.key), csv(e.label), csv(e.canonical), csv(e.confidence), csv(e.reason),
    e.variants.size, e.programs.size, e.files, e.bytes,
    csv(e.cmin), csv(e.cmax), csv(e.smax), csv(e.retention),
    e.judged ? MODEL : 'mechanical-rule',
    csv([...e.batchLevels].sort().join('|')),
  ].join(','));
}
await fsp.mkdir(path.dirname(CSV_OUT), { recursive: true });
await fsp.writeFile(CSV_OUT, lines.join('\n') + '\n');
log(`\nwrote ${CSV_OUT} (${sorted.length} rows)`);

const byLabel = new Map();
for (const e of allNames) byLabel.set(e.label, (byLabel.get(e.label) ?? 0) + 1);

const cost = (usage.input / 1e6) * PRICE_IN + (usage.output / 1e6) * PRICE_OUT;

const state = {
  generated_at: now.toISOString(),
  model: MODEL,
  batch_size: BATCH_SIZE,
  cutoff: CUTOFF_ISO.slice(0, 10),
  step1: {
    total_names: allNames.length,
    new_vs_prior: newNames.length,
    new_examples: newNames.sort((a, b) => b.files - a.files).slice(0, 20).map((e) => ({ name: e.display, files: e.files })),
    mechanically_excluded: excludedMech.length,
    batch_shaped_excluded: excludedMech.filter((e) => e.mechanical === 'batch-shaped').length,
    batch_shaped_names: excludedMech.filter((e) => e.mechanical === 'batch-shaped')
      .sort((a, b) => b.files - a.files).map((e) => ({ name: e.display, files: e.files })),
    to_judge: toJudge.length,
    files_attributed: attributed,
    total_files: files.length,
  },
  labels: Object.fromEntries(byLabel),
  confidence: {
    high: allNames.filter((e) => e.judged && e.confidence === 'high').length,
    medium: allNames.filter((e) => e.judged && e.confidence === 'medium').length,
    low: allNames.filter((e) => e.judged && e.confidence === 'low').length,
  },
  low_confidence: allNames.filter((e) => e.judged && e.confidence === 'low')
    .sort((a, b) => b.files - a.files)
    .map((e) => ({ name: e.display, label: e.label, canonical: e.canonical, files: e.files, programs: e.programs.size, reason: e.reason })),
  groups: multiGroups,
  retention: { archiveNames, archiveFiles, liveNames, liveFiles, undated },
  clients: allNames.filter((e) => e.label === 'client')
    .map((e) => ({ canonical: e.canonical, display: e.display, files: e.files, programs: e.programs.size, retention: e.retention, confidence: e.confidence })),
  usage: { ...usage, cost_usd: Number(cost.toFixed(4)), price_in: PRICE_IN, price_out: PRICE_OUT },
};
await fsp.writeFile(STATE_OUT, JSON.stringify(state, null, 2));
log(`wrote ${STATE_OUT}`);

log(`\nlabels: ${JSON.stringify(Object.fromEntries(byLabel))}`);
log(`variant groups (>1 member): ${multiGroups.length}`);
log(`retention: ${liveNames} live / ${archiveNames} archive-only`);
log(`tokens: in=${usage.input} out=${usage.output} calls=${usage.calls} failed=${usage.failed}`);
log(`cost: $${cost.toFixed(4)}`);
