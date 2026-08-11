/**
 * grants-lib.mjs — shared logic for grants inventory analysis.
 *
 * Lifted VERBATIM from profile-grants-paths.mjs (the script behind
 * docs/inventory/path-profile.md) so batch detection and segment
 * classification have a single definition and cannot drift.
 *
 * Pure string analysis. No network, no API, no LLM.
 */

export const GRANTS_PREFIX = '/Granted Team Folder/SALES/Grants/';

// ---------------------------------------------------------------- CSV parser
// Char-level RFC4180 parser. Paths contain commas, quotes and apostrophes, so
// naive splitting would corrupt rows.
export function* parseCsv(text) {
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

export function classify(seg) {
  const s = norm(seg);
  if (!s) return 'unclear';

  if (PURE_YEAR.test(s)) return 'batch';
  if (YEAR.test(s) && BATCH_HINT.test(s)) return 'batch';
  if (/old folders?/.test(s) || /and prior/.test(s)) return 'batch';

  if (DATE_LIKE.test(s) || MONTH.test(s)) return 'date';

  if (DOC_WORDS.has(s)) return 'doctype';
  const words = s.split(/\s+/);
  if (words.length <= 3 && words.some((w) => DOC_WORDS.has(w))) return 'doctype';

  if (GENERIC.has(s)) return 'unclear';
  if (/^\d+$/.test(s)) return 'unclear';
  if (s.length < 3) return 'unclear';

  if (CORP.test(seg.trim())) return 'client';

  const alphaWords = seg.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (alphaWords.length >= 1 && alphaWords.length <= 6 && /[A-Z]/.test(seg)) return 'client';

  return 'unclear';
}

const classCache = new Map();
export function classifyCached(seg) {
  let v = classCache.get(seg);
  if (v === undefined) { v = classify(seg); classCache.set(seg, v); }
  return v;
}

// ---------------------------------------------------------------- batch skip list
/** Canonical normalization used for name identity across the whole pipeline. */
export function normalizeName(s) {
  return s.trim()
    .replace(/[\s.,;:_\-*]+$/u, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Names classified as `batch` by claude-sonnet-4-6 in the client-classification
 * pass (docs/inventory/client-classification.md).
 *
 * These are DATA, not regex, on purpose. The regex in classify() missed every
 * one of them for edge-case reasons no pattern generalizes cleanly — a year
 * with a trailing letter (`2021x`, `2018xx`) has no word boundary after the
 * digits, `2016:2017 Clients` says "Clients" not "Client Files", and the
 * program-stream groupings (`Clean Tech Stream`, `CAJG`, `Second Intake`)
 * contain no date token at all. Widening the regex to catch these would
 * over-match real client names; an explicit list cannot.
 *
 * Entries are normalizeName() output.
 */
export const MODEL_BATCH_NAMES = new Set([
  '*ds4y 2021', '*ds4y-lhl 2021', '*psyip 2016 clients', '2015 forms',
  '2015:2016 clients', '2016 forms', '2016 forms for employers', '2016 q4',
  '2016:17 clients', '2016:17 ictc clients', '2016:2017 clients',
  '2017 forms for employers', '2017 q1', '2017 q4', '2018 approval forms',
  '2018 clients', '2018 deposits', '2018 files', '2018 q1-2', '2018 q4',
  '2018-2019 clients', '2019 clients', '2019 post approval forms', '2019 q2',
  '2019 q3', '2020 clients', '2020 csj', '2020 q1', '2020 q2', '2020 q4',
  '2021 clients', '2021 q1', '2021 q2', '2021 q4', '2022 clients', '2022 csj',
  '2022 q1', '2022 q2', '2022 q3', '2023 clients', '2023 documents',
  '2024 clients', '2025 clients', 'agrilinnovate 2023', 'bcmjg', 'cajg',
  'cjg manitoba', 'cjg-bc applications 2016x (october onwards)',
  'cjg-bc applications 2018x', 'cjg-bc applications 2018xx',
  'cjg-manitoba applications all intakes', 'clean tech stream', 'client folder',
  'clients', 'clients - 2022', 'clients 2016:17', 'clients 2017:18',
  'clients 2018:19', 'clients 2019-2020', 'clients-2023',
  'ds4y - digital tech stream', 'ds4y 2020 clients',
  'ds4y 2021 prospects:pending', 'etg-bc applications 2019x',
  'etg-bc applications 2019xx', 'etg-bc applications 2020x',
  'etg-bc applications 2020xx', 'etg-bc applications 2021x',
  'etg-bc applications 2021xx', 'export-development stream 2023',
  'export-ready stream 2023', 'forms 2015:16', 'gyw 2023', 'gyw 2024',
  'impact stream', 'natural resources stream',
  'postsecondary - aviation & aerospace (career focus)',
  'postsecondary biotech (career focus)',
  'postsecondary environment (career focus)', 'psyip 2017', 'psyip 2018',
  'second intake', 'third intake',

  // --- Pass 2 additions (docs/inventory/final-classification.md) ---------------
  // Surfaced only after the pass-1 skip list let resolution descend one level
  // further. Same failure modes as above: "Clients" as a grouping word, a
  // quarter label with no year, a program acronym, a parenthesised status.
  'cajg clients', '2017:2018 clients', '2020 clients - waitlist',
  'clients - q4', 'clients - q1, q2', '2016:2017 clients (abandoned)',
]);

/** The 6 names added after pass 2 — kept separate so a run can diff against the pass-1 state. */
export const PASS2_BATCH_NAMES = new Set([
  'cajg clients', '2017:2018 clients', '2020 clients - waitlist',
  'clients - q4', 'clients - q1, q2', '2016:2017 clients (abandoned)',
]);

/** True when a folder should be skipped through when hunting for client depth. */
export function isBatchName(name) {
  return classifyCached(name) === 'batch' || MODEL_BATCH_NAMES.has(normalizeName(name));
}

// ---------------------------------------------------------------- loader
export function loadRows(text) {
  const rows = [];
  let header = null;
  for (const r of parseCsv(text)) {
    if (!header) { header = r; continue; }
    if (r.length < 8) continue;
    const [p, name, type, size, sm, cm] = r;
    if (!p.startsWith(GRANTS_PREFIX)) continue;
    const segs = p.slice(GRANTS_PREFIX.length).split('/');
    rows.push({
      path: p,
      name,
      isFile: type === 'file',
      size: size ? Number(size) : 0,
      sm: sm || null,
      cm: cm || null,
      segs,
      program: segs[0],
    });
  }
  return rows;
}

/** Dominant label among the distinct folder names at `level` below a program. */
export function levelLabel(rows, programName, level) {
  const names = new Set();
  for (const r of rows) {
    if (r.program !== programName || r.isFile) continue;
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
