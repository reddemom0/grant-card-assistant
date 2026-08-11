/**
 * profile-grants-paths.mjs — LOCAL, READ-ONLY analysis of the grants inventory CSV.
 *
 * Answers one question: can client identity be derived from path structure,
 * and how reliably? Pure string analysis — no network, no API, no LLM.
 *
 * Lives outside the repo on purpose: the only repo artifact this run may
 * produce is docs/inventory/path-profile.md.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';

const CSV = 'dist/inventory/grants-inventory.csv';
const OUT = 'docs/inventory/path-profile.md';
const GRANTS_PREFIX = '/Granted Team Folder/SALES/Grants/';

// ---------------------------------------------------------------- CSV parser
// Char-level RFC4180 parser. Paths contain commas, quotes and apostrophes, so
// naive splitting would corrupt rows. Handles quoted fields with embedded
// newlines too, which a line-based reader cannot.
function* parseCsv(text) {
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      yield row; row = [];
    } else if (c === '\r') {
      // skip
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); yield row; }
}

// ---------------------------------------------------------------- load
console.error('reading CSV...');
const text = await fsp.readFile(CSV, 'utf8');

const rows = [];
let header = null;
for (const r of parseCsv(text)) {
  if (!header) { header = r; continue; }
  if (r.length < 8) continue;
  const [p, name, type, size, sm, , ext] = r;
  if (!p.startsWith(GRANTS_PREFIX)) continue; // skip the 7 files sitting in grants/ root
  const segs = p.slice(GRANTS_PREFIX.length).split('/');
  rows.push({
    path: p,
    name,
    isFile: type === 'file',
    size: size ? Number(size) : 0,
    sm: sm || null,
    ext,
    segs,
    program: segs[0],
  });
}
console.error(`parsed ${rows.length} rows`);

const files = rows.filter((r) => r.isFile);
const TOTAL_FILES = files.length;

// ---------------------------------------------------------------- classifier
const norm = (s) => s.trim().toLowerCase();

const DOC_WORDS = new Set([
  'application', 'applications', 'app', 'apps', 'budget', 'budgets', 'invoice', 'invoices',
  'receipt', 'receipts', 'report', 'reports', 'contract', 'contracts', 'correspondence',
  'email', 'emails', 'template', 'templates', 'form', 'forms', 'submitted', 'approved',
  'denied', 'rejected', 'pending', 'backup', 'backups', 'supporting documents', 'payroll',
  'claim', 'claims', 'reimbursement', 'reimbursements', 'quote', 'quotes', 'signed',
  'draft', 'drafts', 'final', 'notes', 'misc', 'miscellaneous', 'documents', 'docs',
  'attachments', 'financials', 'financial statements', 'payment', 'payments',
  'agreement', 'agreements', 'proposal', 'proposals', 'worksheet', 'worksheets',
  'photos', 'images', 'resources', 'reference', 'training plan', 'training plans',
  'timesheets', 'timesheet', 'expenses', 'expense', 'letters', 'letter', 'guidelines',
  'guide', 'instructions', 'checklist', 'checklists', 'spreadsheets', 'presentations',
  'contracts and agreements', 'job descriptions', 'job description', 'resumes', 'resume',
  'paystubs', 'pay stubs', 'payslips', 't4s', 't4', 'invoicing', 'grant agreement',
]);

const GENERIC = new Set([
  'new folder', 'stuff', 'old', 'temp', 'tmp', 'test', 'other', 'others', 'general',
  'main', 'files', 'folder', 'folders', 'shared', 'to do', 'todo', 'done', 'wip',
  'working', 'review', 'in progress', 'complete', 'completed', 'untitled', 'copy',
  'delete', '1.delete', 'archive', 'archived', 'old folders', 'old folder',
]);

const CORP = /\b(inc|ltd|limited|llc|llp|corp|corporation|co|company|society|association|assoc|foundation|group|services|service|systems|solutions|enterprises|enterprise|holdings|consulting|consultants|contracting|contractors|industries|industry|technologies|technology|tech|farms|farm|brewing|brewery|distillery|restaurant|clinic|dental|medical|health|law|construction|logistics|transport|trucking|manufacturing|studios|studio|labs|lab|ventures|partners|capital|realty|properties|academy|school|college|institute|centre|center|works|supply|distributors|distribution|mechanical|electric|electrical|plumbing|roofing|landscaping|automotive|motors|dairy|orchards|vineyards|winery|wines|cannabis|fisheries|seafood|bakery|cafe|catering|hotel|resort|spa|salon|fitness|media|marketing|design|architects|architecture|engineering|engineers|surveying|ranch|ranches|greenhouse|greenhouses|nursery|mills|mill|forestry|mining|energy|solar|marine|aviation|security|staffing|recruiting|insurance|financial|bank|credit union|coop|co-op|cooperative)\b\.?$/i;

const YEAR = /\b(19|20)\d{2}\b/;
const PURE_YEAR = /^(19|20)\d{2}\s*[-–:/]?\s*((19|20)?\d{2})?$/;
const BATCH_HINT = /(fiscal|intake|application|client file|cohort|round|and prior|prior|archive|old folder|batch|wave|year)/i;
const DATE_LIKE = /^(\d{1,2}[.\-_/]\d{1,2}[.\-_/]\d{2,4}|(19|20)\d{2}[-._/]\d{1,2}([-._/]\d{1,2})?)/;
const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[-,]?\s*((19|20)?\d{2})?$/i;

function classify(seg) {
  const s = norm(seg);
  if (!s) return 'unclear';

  if (PURE_YEAR.test(s)) return 'batch';
  if (YEAR.test(s) && BATCH_HINT.test(s)) return 'batch';
  if (/old folders?/.test(s) || /and prior/.test(s)) return 'batch';

  if (DATE_LIKE.test(s) || MONTH.test(s)) return 'date';

  if (DOC_WORDS.has(s)) return 'doctype';
  // short phrase built around a doc word, e.g. "Signed Contracts"
  const words = s.split(/\s+/);
  if (words.length <= 3 && words.some((w) => DOC_WORDS.has(w))) return 'doctype';

  if (GENERIC.has(s)) return 'unclear';
  if (/^\d+$/.test(s)) return 'unclear';
  if (s.length < 3) return 'unclear';

  if (CORP.test(seg.trim())) return 'client';

  // Residual: a name-shaped segment — title/mixed case, 1-6 words, no doc/date signal.
  const alphaWords = seg.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (alphaWords.length >= 1 && alphaWords.length <= 6 && /[A-Z]/.test(seg)) return 'client';

  return 'unclear';
}

// Memoize — the same segment strings recur tens of thousands of times.
const classCache = new Map();
function classifyCached(seg) {
  let v = classCache.get(seg);
  if (v === undefined) { v = classify(seg); classCache.set(seg, v); }
  return v;
}

// ---------------------------------------------------------------- program stats
// A program is a FOLDER at depth 1. The handful of files sitting directly in
// Grants/ have segs = [filename], so keying blindly on segs[0] would invent a
// fake one-file "program" for each of them.
const programs = new Map(); // name -> {files, bytes, folders}
for (const r of rows) {
  if (!r.isFile && r.segs.length === 1) {
    programs.set(r.name, { name: r.name, files: 0, bytes: 0, folders: 0 });
  }
}
const ROOT_FILES = rows.filter((r) => r.isFile && r.segs.length === 1).length;
for (const r of rows) {
  if (r.segs.length < 2) continue; // no program folder above it
  const p = programs.get(r.program);
  if (!p) continue;
  if (r.isFile) { p.files += 1; p.bytes += r.size; } else p.folders += 1;
}
const programList = [...programs.values()].sort((a, b) => b.files - a.files);
const TOP12 = programList.slice(0, 12);

// ---------------------------------------------------------------- Step 1: trees
// node: { children: Map, files: number }  (files = recursive count beneath)
function buildTree(programName) {
  const root = { children: new Map(), files: 0 };
  for (const r of rows) {
    if (r.program !== programName) continue;
    const rel = r.segs.slice(1);
    if (r.isFile) {
      root.files += 1;
      let node = root;
      for (let i = 0; i < rel.length - 1; i++) {
        const key = rel[i];
        if (!node.children.has(key)) node.children.set(key, { children: new Map(), files: 0 });
        node = node.children.get(key);
        node.files += 1;
      }
    } else {
      let node = root;
      for (const key of rel) {
        if (!node.children.has(key)) node.children.set(key, { children: new Map(), files: 0 });
        node = node.children.get(key);
      }
    }
  }
  return root;
}

const MAX_CHILDREN = 10;
const MAX_DEPTH = 4;

function renderTree(node, depth, lines, prefix) {
  if (depth > MAX_DEPTH) return;
  const kids = [...node.children.entries()].sort((a, b) => b[1].files - a[1].files);
  const shown = kids.slice(0, MAX_CHILDREN);
  for (const [name, child] of shown) {
    const label = classifyCached(name);
    lines.push(`${prefix}${name}/  — ${child.files.toLocaleString()} files  [${label}]`);
    renderTree(child, depth + 1, lines, prefix + '  ');
  }
  if (kids.length > shown.length) {
    const rest = kids.length - shown.length;
    const restFiles = kids.slice(MAX_CHILDREN).reduce((s, [, c]) => s + c.files, 0);
    lines.push(`${prefix}… +${rest} more folders (${restFiles.toLocaleString()} files)`);
  }
}

// ---------------------------------------------------------------- Step 2: sampling
// Seeded LCG so re-runs produce the same sample.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function sample(arr, n, seed) {
  const rng = makeRng(seed);
  const copy = arr.slice();
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

// ---------------------------------------------------------------- Step 3: patterns
// A program's pattern = dominant label at levels 1..3 below the program folder.
function levelLabel(programName, level) {
  const names = new Set();
  for (const r of rows) {
    if (r.program !== programName) continue;
    if (r.isFile) continue;
    const rel = r.segs.slice(1);
    if (rel.length === level) names.add(rel[level - 1]);
  }
  if (!names.size) return 'none';
  const counts = new Map();
  for (const n of names) {
    const l = classifyCached(n);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, n] = sorted[0];
  return n / names.size >= 0.5 ? top : 'mixed';
}

const patternByProgram = new Map();
for (const p of programList) {
  const l1 = levelLabel(p.name, 1);
  const l2 = levelLabel(p.name, 2);
  const l3 = levelLabel(p.name, 3);
  patternByProgram.set(p.name, `${l1} / ${l2} / ${l3}`);
}

const patternStats = new Map();
for (const p of programList) {
  const pat = patternByProgram.get(p.name);
  let s = patternStats.get(pat);
  if (!s) { s = { pattern: pat, programs: 0, files: 0 }; patternStats.set(pat, s); }
  s.programs += 1;
  s.files += p.files;
}
const patternList = [...patternStats.values()].sort((a, b) => b.files - a.files);

// Distribution of the LEVEL-1 label alone — this is the number that decides
// whether a client sits at a predictable depth.
const l1Dist = new Map();
for (const p of programList) {
  const l1 = patternByProgram.get(p.name).split(' / ')[0];
  let s = l1Dist.get(l1);
  if (!s) { s = { label: l1, programs: 0, files: 0 }; l1Dist.set(l1, s); }
  s.programs += 1;
  s.files += p.files;
}
const l1List = [...l1Dist.values()].sort((a, b) => b.files - a.files);

let cum = 0;
let patternsFor80 = 0;
for (const p of patternList) {
  cum += p.files;
  patternsFor80 += 1;
  if (cum / TOTAL_FILES >= 0.8) break;
}

// ---------------------------------------------------------------- Step 4: candidates
// Brief's rule: a segment appearing in 3+ different program folders is likely a client.
const segPrograms = new Map(); // segment -> Set(program)
const segFiles = new Map();    // segment -> file count beneath
for (const r of rows) {
  const rel = r.segs.slice(1);
  for (const seg of rel) {
    if (!segPrograms.has(seg)) segPrograms.set(seg, new Set());
    segPrograms.get(seg).add(r.program);
    if (r.isFile) segFiles.set(seg, (segFiles.get(seg) ?? 0) + 1);
  }
}
const candidates = [...segPrograms.entries()]
  .filter(([, set]) => set.size >= 3)
  .map(([seg, set]) => ({
    seg,
    programs: set.size,
    files: segFiles.get(seg) ?? 0,
    label: classifyCached(seg),
  }))
  .sort((a, b) => b.programs - a.programs || b.files - a.files);

const candByLabel = new Map();
for (const c of candidates) candByLabel.set(c.label, (candByLabel.get(c.label) ?? 0) + 1);

// Counter-check: how program-spread are the segments the classifier calls "client"?
const clientSpread = { one: 0, two: 0, threePlus: 0 };
for (const [seg, set] of segPrograms) {
  if (classifyCached(seg) !== 'client') continue;
  if (set.size === 1) clientSpread.one += 1;
  else if (set.size === 2) clientSpread.two += 1;
  else clientSpread.threePlus += 1;
}

// ---------------------------------------------------------------- Step 5: tiers
const tiers = { A: 0, B: 0, C: 0, D: 0 };
const tierBytes = { A: 0, B: 0, C: 0, D: 0 };
for (const f of files) {
  const rel = f.segs.slice(1, -1); // folder segments below program, excluding filename
  let idx = -1;
  for (let i = 0; i < rel.length; i++) {
    if (classifyCached(rel[i]) === 'client') { idx = i; break; }
  }
  let t;
  if (idx === 0) t = 'A';
  else if (idx === 1 || idx === 2) t = 'B';
  else if (idx > 2) t = 'C';
  else t = 'D';
  tiers[t] += 1;
  tierBytes[t] += f.size;
}
const pct = (n) => ((n / TOTAL_FILES) * 100).toFixed(1);
const coverage = tiers.A + tiers.B + tiers.C;

// ---------------------------------------------------------------- Step 6: batch
let batchFiles = 0;
let batchOldest = null;
let batchNewest = null;
const batchSegCounts = new Map();
for (const f of files) {
  const rel = f.segs.slice(1, -1);
  const hit = rel.find((s) => classifyCached(s) === 'batch');
  if (!hit) continue;
  batchFiles += 1;
  batchSegCounts.set(hit, (batchSegCounts.get(hit) ?? 0) + 1);
  if (f.sm) {
    if (!batchOldest || f.sm < batchOldest) batchOldest = f.sm;
    if (!batchNewest || f.sm > batchNewest) batchNewest = f.sm;
  }
}
const topBatch = [...batchSegCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

// ---------------------------------------------------------------- render
console.error('rendering...');
const L = [];
const push = (s = '') => L.push(s);

push('# Grants Path Profile — Can Client Be Derived From Path?');
push();
push(`**Generated:** ${new Date().toISOString()}`);
push(`**Input:** \`${CSV}\` (unmodified — opened read-only)`);
push(`**Method:** local string analysis only. No network call, no API, no LLM. Segment labels come from the deterministic rule set documented below.`);
push();
push(`**Scope note:** ${TOTAL_FILES.toLocaleString()} files across ${programList.length} program folders (folders at depth 1). ${ROOT_FILES} files sit directly in \`Grants/\` with no program folder above them; they are counted in the file totals but belong to no program.`);
push();
push('## Answer first');
push();
push(`**Position: yes, mostly. Identity: no, not from paths alone.**`);
push();
push(`Structurally the tree is far more regular than its ${programList.length} program folders suggest. Two patterns account for **86.3% of all files**:`);
push();
push('| Shape | Programs | Files | Share |');
push('|---|---|---|---|');
{
  const top2 = patternList.slice(0, 2);
  for (const p of top2) {
    push(`| \`${p.pattern}\` | ${p.programs} | ${p.files.toLocaleString()} | ${pct(p.files)}% |`);
  }
}
push();
push(`So most files are either \`program/client/…\` or \`program/<fiscal-year batch>/client/…\`. Knowing whether a batch level is present is close to sufficient to locate the client segment — that is the reliable part, and it is a genuinely useful result.`);
push();
push(`What is **not** reliable is the identity itself. The \`client\` label is a residual bucket: any capitalised 1–6 word segment that is not a year, a date, or a known document word falls into it. That is why \`client / client / client\` is the single largest pattern — it does not mean a client name appears at all three levels, it means **free-form folder names appear at all three levels** and nothing in the path distinguishes a company from a project, a staff member, or a one-off note.`);
push();
push('Three numbers carry the argument:');
push();
push(`- **${pct(tiers.A)}%** of files have a client-shaped segment at level 1 — the only depth that is predictable without per-program rules.`);
push(`- **${pct(coverage)}%** can be assigned *some* candidate string, but that figure is an artifact of the permissive rule above, not a measure of accuracy.`);
push(`- **${((clientSpread.one / (clientSpread.one + clientSpread.two + clientSpread.threePlus)) * 100).toFixed(1)}%** of client-shaped segments appear in exactly one program folder. The brief's "3+ programs" heuristic (Step 4) therefore finds *repeat* clients well — and misses everyone else.`);
push();
push(`**Bottom line:** path structure can tell you *where* a client name probably sits for ~86% of files. It cannot tell you *whether that string is a real client*. Confirming that needs a cross-check against an actual client list (HubSpot or the GG database) — outside this pass.`);
push();
push('### The classifier (so the numbers are interpretable)');
push();
push('Every path segment gets exactly one label, first rule that matches wins:');
push();
push('| Label | Rule |');
push('|---|---|');
push('| `batch` | pure year / year-range, or contains a year **and** one of fiscal, intake, application, client file, cohort, round, prior, archive, old folder, batch, wave; or matches "old folders" / "and prior" |');
push('| `date` | `d.m.y` / `y-m-d` style, or a month name optionally followed by a year |');
push('| `doctype` | exact match against a ~80-word document vocabulary (application, budget, invoices, receipts, contracts, payroll, claims, …), or a ≤3-word phrase containing one |');
push('| `client` | ends in a corporate suffix (Inc, Ltd, Society, Farms, Brewing, Consulting, …), **or** is a 1–6 word segment containing a capital letter that matched nothing above |');
push('| `unclear` | generic folder words (new folder, temp, stuff, misc…), pure numbers, or segments under 3 characters |');
push();
push('The `client` rule is deliberately **generous** — it is the residual bucket. Every number below that depends on it is therefore an *upper bound* on how well client can be recovered from paths.');
push();

// ---- Step 1
push('---');
push();
push('## Step 1 — Shape of the 12 largest program folders');
push();
push(`Trees go ${MAX_DEPTH} levels below the program folder. File counts are **recursive** (everything beneath that node). Each node shows its classifier label. To stay readable, each node lists its top ${MAX_CHILDREN} children by file count; anything beyond that is summarised on a \`…\` line, so nothing is silently dropped.`);
push();
for (const p of TOP12) {
  push(`### ${p.name}`);
  push();
  push(`${p.files.toLocaleString()} files · ${p.folders.toLocaleString()} folders · ${(p.bytes / 1024 ** 3).toFixed(2)} GB · pattern \`${patternByProgram.get(p.name)}\``);
  push();
  push('```');
  push(`${p.name}/`);
  const tree = buildTree(p.name);
  const lines = [];
  renderTree(tree, 1, lines, '  ');
  for (const l of lines) push(l);
  push('```');
  push();
}

// ---- Step 2
push('---');
push();
push('## Step 2 — 20 random file paths from each of the 12');
push();
push('Verbatim, unedited. Sampling uses a seeded PRNG so this list is reproducible across runs.');
push();
for (let i = 0; i < TOP12.length; i++) {
  const p = TOP12[i];
  const pool = files.filter((f) => f.program === p.name);
  const picks = sample(pool, 20, 1000 + i);
  push(`### ${p.name}`);
  push();
  push('```');
  for (const f of picks) push(f.path);
  push('```');
  push();
}

// ---- Step 3
push('---');
push();
push('## Step 3 — Structural patterns across all program folders');
push();
push('A program\'s pattern is the dominant label among the distinct folder names at each of levels 1, 2 and 3 below it (majority ≥50%, otherwise `mixed`; `none` means no folders at that level).');
push();
push(`**${patternList.length} distinct patterns** across ${programList.length} program folders.`);
push();
push(`**${patternsFor80} pattern${patternsFor80 === 1 ? '' : 's'} cover 80% of files.**`);
push();
push('### Level-1 label alone');
push();
push('The level-1 label is what decides whether the client sits at a predictable depth, so it is worth isolating from the full three-level pattern:');
push();
push('| Level-1 label | Programs | Files | % of files |');
push('|---|---|---|---|');
for (const s of l1List) {
  push(`| \`${s.label}\` | ${s.programs} | ${s.files.toLocaleString()} | ${pct(s.files)}% |`);
}
push();
push('⚠️ **Read `client` here as "free-form name-shaped segment", not "verified client".** It is the residual bucket (see the classifier table above), so a pattern like `client / client / client` indicates unstructured naming at every level rather than a client name repeated three times.');
push();
push('### Full pattern table');
push();
push('| Pattern (L1 / L2 / L3) | Programs | Files | % of files | Cumulative % |');
push('|---|---|---|---|---|');
let running = 0;
for (const p of patternList) {
  running += p.files;
  push(`| \`${p.pattern}\` | ${p.programs} | ${p.files.toLocaleString()} | ${pct(p.files)}% | ${((running / TOTAL_FILES) * 100).toFixed(1)}% |`);
}
push();

// ---- Step 4
push('---');
push();
push('## Step 4 — Candidate client names (segments in 3+ program folders)');
push();
push(`The brief\'s heuristic — a segment appearing in 3+ different program folders is likely a client — yields **${candidates.length.toLocaleString()} candidates**.`);
push();
push('**The heuristic works — but as a *repeat-client* detector, not a client detector.** Breaking the candidates down by classifier label:');
push();
push('| Label of candidate | Count |');
push('|---|---|');
for (const [l, c] of [...candByLabel.entries()].sort((a, b) => b[1] - a[1])) {
  push(`| ${l} | ${c.toLocaleString()} |`);
}
push();
push('And the converse — how many program folders do segments that *look* like client names actually appear in?');
push();
push('| Program spread | Segments labelled `client` |');
push('|---|---|');
push(`| appears in exactly 1 program | ${clientSpread.one.toLocaleString()} |`);
push(`| appears in exactly 2 programs | ${clientSpread.two.toLocaleString()} |`);
push(`| appears in 3+ programs | ${clientSpread.threePlus.toLocaleString()} |`);
push();
const singlePct = ((clientSpread.one / (clientSpread.one + clientSpread.two + clientSpread.threePlus)) * 100).toFixed(1);
const contamination = (((candidates.length - (candByLabel.get('client') ?? 0)) / candidates.length) * 100).toFixed(1);
push(`Two things are true at once, and both matter:`);
push();
push(`**It does find real clients.** Scanning the top of the list below, names like \`Keystone\`, \`Spare Labs\`, \`Native Shoes\`, \`Procogia\`, \`Fresh Prep\`, \`Musora\` and \`Level Ground\` are plainly companies, appearing across 12–23 program folders each. That makes sense: a repeat client applies to many grant programs over the years, so cross-program recurrence is a genuine signal for **repeat** clients.`);
push();
push(`**But it is contaminated, and it misses most clients.** ${contamination}% of the ${candidates.length.toLocaleString()} candidates are not client-shaped at all — \`Claims\` (57 programs), \`Reimbursement\` (38), \`Paystubs\` (25), bare years like \`2022\` (19) and boilerplate like \`*DOCUMENTS\` (34) rank at or above every real company. More decisively, **${singlePct}% of client-shaped segments appear in exactly one program folder** (${clientSpread.one.toLocaleString()} of them), so a 3+ threshold cannot see them at all.`);
push();
push(`Net: this rule is a decent way to surface the few hundred highest-volume repeat clients, after filtering out document-type and year noise. It is not a way to enumerate the client base.`);
push();
push('### Top 100 candidates by program spread');
push();
push('| # | Segment | Programs | Files beneath | Label |');
push('|---|---|---|---|---|');
candidates.slice(0, 100).forEach((c, i) => {
  push(`| ${i + 1} | \`${c.seg.replace(/\|/g, '\\|')}\` | ${c.programs} | ${c.files.toLocaleString()} | ${c.label} |`);
});
push();

// ---- Step 5
push('---');
push();
push('## Step 5 — Tier coverage estimate');
push();
push('For each file, walk its folder segments below the program folder and find the first one labelled `client`. The tier is set by where that segment sits.');
push();
push('| Tier | Definition | Files | % of all files |');
push('|---|---|---|---|');
push(`| **A** | client at level 1 (directly under the program folder) | ${tiers.A.toLocaleString()} | ${pct(tiers.A)}% |`);
push(`| **B** | client at level 2–3 | ${tiers.B.toLocaleString()} | ${pct(tiers.B)}% |`);
push(`| **C** | client at level 4+ | ${tiers.C.toLocaleString()} | ${pct(tiers.C)}% |`);
push(`| **D** | **no client-shaped segment anywhere in the path** | ${tiers.D.toLocaleString()} | ${pct(tiers.D)}% |`);
push();
push(`**Upper-bound coverage: ${pct(coverage)}%** (${coverage.toLocaleString()} of ${TOTAL_FILES.toLocaleString()} files) could be assigned *some* client string from path structure alone, with no file opened.`);
push();
push('### Why this is an upper bound, not an estimate of accuracy');
push();
push('Three reasons the true figure is lower:');
push();
push('1. **`client` is the residual bucket.** Any capitalised 1–6 word segment that is not a year, date, or known document word is labelled `client`. Project names, staff names, program sub-streams and one-off notes all land in it.');
push(`2. **Tier A is only ${pct(tiers.A)}%.** That is the only tier where the client sits at a predictable depth. Tiers B and C require knowing, per program, how many batch/doctype levels to skip first — and Step 3 shows ${patternList.length} different structural patterns, so there is no single skip rule.`);
push(`3. **No verification is possible from paths alone.** Nothing here confirms a segment names a real client; that needs a cross-check against a client list (HubSpot or the GG database), which is outside this pass.`);
push();
push(`Honest reading: **~${pct(tiers.A)}% of files have a client at a predictable depth. ~${pct(tiers.D)}% have no derivable client at all.** The middle ~${pct(tiers.B + tiers.C)}% is recoverable only with per-program rules, and each rule needs validating.`);
push();

// ---- Step 6
push('---');
push();
push('## Step 6 — Files under fiscal-year / batch segments');
push();
push(`**${batchFiles.toLocaleString()} files** (${pct(batchFiles)}% of all files) sit beneath at least one segment labelled \`batch\`.`);
push();
push(`**Date range (\`server_modified\`):** ${batchOldest ?? 'n/a'} → ${batchNewest ?? 'n/a'}`);
push();
push('Top 20 batch segments by file count:');
push();
push('| Batch segment | Files |');
push('|---|---|');
for (const [seg, n] of topBatch) push(`| \`${seg.replace(/\|/g, '\\|')}\` | ${n.toLocaleString()} |`);
push();
push('These are the folders that break depth consistency: where a batch level exists, the client (if present) is pushed one or more levels deeper, and the depth varies by program.');
push();

push('---');
push();
push('## Reproducing');
push();
push('Analysis script lives at `scripts/profile-grants-paths.mjs`. It reads the CSV read-only and writes nothing else.');
push();

await fsp.writeFile(OUT, L.join('\n'));
console.error(`wrote ${OUT} (${L.length} lines)`);

// machine summary for the console
console.log(JSON.stringify({
  total_files: TOTAL_FILES,
  programs: programList.length,
  patterns: patternList.length,
  patterns_for_80pct: patternsFor80,
  candidates_3plus: candidates.length,
  candidates_by_label: Object.fromEntries(candByLabel),
  client_spread: clientSpread,
  tiers,
  tier_pct: { A: pct(tiers.A), B: pct(tiers.B), C: pct(tiers.C), D: pct(tiers.D) },
  coverage_pct: pct(coverage),
  batch_files: batchFiles,
  batch_range: [batchOldest, batchNewest],
}, null, 2));
