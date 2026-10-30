/**
 * Filing sweep — weekday suggestions for newly added Granted Files files (pilot)
 *
 * Suggest-only. Each weekday it reads the Granted Files change feed since the
 * last successful run, keeps files Granted Files has not had before (created
 * there, or moved in), and runs cheap rule checks (filing-rules.js). Only files
 * that fail get one Haiku call for a suggested home and name, which is then
 * checked with planFileMove as the person who will confirm it. That person gets
 * a Google Chat DM thread from Oracle: a short header, then one card per
 * destination folder. Files going to the same folder share a card with one
 * Confirm all / Skip; each file underneath is still its own file_move_rename
 * pending action (drive_actions, undo). Files it can't place get a "not sure"
 * card with Leave it here; a wage-subsidy paystub whose employer has no client
 * folder gets an advisory card (planFileMove won't create a client folder).
 * Nothing moves without their Confirm.
 *
 * Who gets it: the file's lastModifyingUser. The Drive Activity scope (which
 * would name who added or moved it) is not granted to the delegation, so a file
 * moved in without edits goes to its last editor; no @granted.ca person → the
 * fallback (Chris). Someone who has never messaged Oracle has no DM → their
 * items go to the fallback's thread, marked for them.
 *
 * Off unless FILING_SWEEP_ENABLED=true. While FILING_SWEEP_PILOT_EMAILS is set,
 * only those people get DMs; everyone else's suggestions are logged as
 * would_suggest. Every file is logged once in filing_sweep_suggestions
 * (migrations 055, 058); a file is never suggested twice.
 *
 * Reads Drive with drive.readonly as the reader (FILING_SWEEP_READER_EMAIL,
 * default the fallback). Never opens a file's content.
 */

import { randomUUID } from 'crypto';
import { GRANTED_FILES_DRIVE_ID, FOLDER_MIME, folderKey } from '../tools/google-drive.js';
import { CLAIM_NAME, TYPES, baseName, checkFile, claimFolder, inClaims, isPaystubConvention, paystubHome, programLines, typePatterns } from './filing-rules.js';

export const SWEEP_SCHEDULE = '30 8 * * 1-5';
export const SUMMARY_SCHEDULE = '45 8 * * 1';
export const TZ = 'America/Vancouver';
export const MAX_CARDS = 10;
export const IGNORE_DAYS = 7;
export const MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_FALLBACK_EMAIL = 'writers@granted.ca';
const GRANTED = /^[^@\s]+@granted\.ca$/i;
const MODEL_TIMEOUT_MS = 60000;
const FILE_FIELDS = 'id,name,mimeType,parents,trashed,driveId,createdTime,webViewLink,lastModifyingUser(emailAddress,displayName)';

export function localDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const fallbackEmail = (env = process.env) => String(env.FILING_SWEEP_FALLBACK_EMAIL || DEFAULT_FALLBACK_EMAIL).trim().toLowerCase();

/** The pilot list, or null when unset (everyone gets DMs). */
export function pilotEmails(env = process.env) {
  const raw = String(env.FILING_SWEEP_PILOT_EMAILS || '').trim();
  if (!raw) return null;
  return new Set(raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean));
}

export const inPilot = (email, pilot) => !pilot || pilot.has(String(email || '').toLowerCase());

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export const CLAIM_SQL = `
INSERT INTO filing_sweep_runs (kind, local_date) VALUES ($1, $2)
ON CONFLICT (kind, local_date) DO UPDATE
   SET status = 'building', claimed_at = NOW(), error_code = NULL, completed_at = NULL
 WHERE (filing_sweep_runs.status = 'failed'   AND filing_sweep_runs.claimed_at < NOW() - INTERVAL '30 minutes')
    OR (filing_sweep_runs.status = 'building' AND filing_sweep_runs.claimed_at < NOW() - INTERVAL '2 hours')
RETURNING id`;
const LAST_TOKEN_SQL = `SELECT page_token_after FROM filing_sweep_runs
 WHERE kind = 'sweep' AND status = 'done' AND page_token_after IS NOT NULL ORDER BY completed_at DESC LIMIT 1`;
const COMPLETE_SQL = `UPDATE filing_sweep_runs SET status = 'done', page_token_before = $2, page_token_after = $3, counts = $4::jsonb, cost_usd = $5, completed_at = NOW() WHERE id = $1`;
const FAIL_SQL = `UPDATE filing_sweep_runs SET status = 'failed', error_code = $2, completed_at = NOW() WHERE id = $1`;
const KNOWN_SQL = `SELECT file_id FROM filing_sweep_known_files WHERE file_id = ANY($1::text[])`;
const REMEMBER_SQL = `INSERT INTO filing_sweep_known_files (file_id) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`;
const ORACLE_FILED_SQL = `SELECT DISTINCT file_id FROM drive_actions WHERE file_id = ANY($1::text[]) AND created_at > NOW() - INTERVAL '2 days'`;
const INSERT_SQL = `
INSERT INTO filing_sweep_suggestions
  (run_id, file_id, file_name, mime_type, path_before, recipient_email, recipient_user_id, routed_reason,
   rule_failures, suggested_path, suggested_name, model_reason, status, cost_usd, suggested_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, $11, $12, $13, $14, CASE WHEN $13 IN ('suggested', 'listed') THEN NOW() END)
ON CONFLICT (file_id) DO NOTHING
RETURNING id`;
// Housekeeping, every run: results of presses on Confirm, then cards left for a week.
export const RECONCILE_SQL = [
  `UPDATE filing_sweep_suggestions s SET status = 'confirmed', resolved_at = COALESCE(p.confirmed_at, NOW())
     FROM pending_actions p WHERE s.pending_action_id = p.id AND s.status = 'suggested' AND p.status = 'confirmed'`,
  `UPDATE filing_sweep_suggestions s SET status = 'failed', resolved_at = NOW()
     FROM pending_actions p WHERE s.pending_action_id = p.id AND s.status = 'suggested' AND p.status = 'failed'`,
  `UPDATE filing_sweep_suggestions s SET status = 'skipped', resolved_at = NOW()
     FROM pending_actions p WHERE s.pending_action_id = p.id AND s.status = 'suggested' AND p.status = 'declined'`
];
export const IGNORE_SQL = `
WITH old AS (
  UPDATE filing_sweep_suggestions SET status = 'ignored', resolved_at = NOW()
   WHERE status = 'suggested' AND suggested_at < NOW() - INTERVAL '${IGNORE_DAYS} days'
  RETURNING pending_action_id)
UPDATE pending_actions SET status = 'expired' WHERE id IN (SELECT pending_action_id FROM old) AND status = 'pending'`;

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

let anthropic = null;
async function defaultCreateMessage(params, opts) {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic.messages.create(params, opts);
}

export function defaultDeps() {
  const drive = () => import('../tools/google-drive.js');
  const pending = () => import('../tools/pending-actions.js');
  const chat = () => import('../cards/chat-api.js');
  return {
    query: async (...a) => (await import('../database/connection.js')).query(...a),
    readDrive: async (email) => (await drive()).delegatedDriveClient(email),
    childFolders: async (...a) => (await drive()).childFolders(...a),
    resolvePath: async (...a) => (await drive()).resolveGrantedFilesPath(...a),
    planFileMove: async (...a) => (await import('../tools/drive-actions.js')).planFileMove(...a),
    savePendingAction: async (...a) => (await pending()).savePendingAction(...a),
    summarizeAction: async (...a) => (await pending()).summarizeAction(...a),
    createConversation: async (...a) => (await import('../database/messages.js')).createConversation(...a),
    saveMessage: async (...a) => (await import('../database/messages.js')).saveMessage(...a),
    findDm: async (id) => (await chat()).findDmSpace(id),
    post: async (args) => (await chat()).postMessageWithThread(args),
    renderCard: async (...a) => (await import('../cards/sweep-card.js')).renderSweepCard(...a),
    newId: () => randomUUID(),
    conversationFor: async (key) => { const { v5 } = await import('uuid'); return v5(key, v5.URL); },
    cost: async (usage) => { const c = (await import('../config/cost-settings.js')).calculateRequestCost(usage, MODEL); return Number(c?.totalCost ?? c) || 0; },
    createMessage: defaultCreateMessage,
    logCost: (args) => import('../utils/cost-logger.js').then(m => m.logAPICost(args)).catch(() => undefined)
  };
}

// ---------------------------------------------------------------------------
// Drive reads
// ---------------------------------------------------------------------------

/** Every file ID in Granted Files (the baseline), and the change token to start from. */
export async function baseline(drive) {
  const { data: start } = await drive.changes.getStartPageToken({ driveId: GRANTED_FILES_DRIVE_ID, supportsAllDrives: true });
  const ids = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      corpora: 'drive', driveId: GRANTED_FILES_DRIVE_ID, includeItemsFromAllDrives: true, supportsAllDrives: true,
      q: 'trashed = false', fields: 'nextPageToken, files(id)', pageSize: 1000, pageToken
    });
    ids.push(...(data.files || []).map(f => f.id));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { ids, token: start.startPageToken };
}

/** Files changed since the token (live, not trashed, still in Granted Files), and the next token. */
export async function changedFiles(drive, token) {
  const byId = new Map();
  let pageToken = token;
  let next = null;
  while (pageToken) {
    const { data } = await drive.changes.list({
      driveId: GRANTED_FILES_DRIVE_ID, pageToken, includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 1000,
      fields: `nextPageToken, newStartPageToken, changes(fileId, removed, file(${FILE_FIELDS}))`
    });
    for (const c of data.changes || []) {
      if (c.removed || !c.file || c.file.trashed || c.file.driveId !== GRANTED_FILES_DRIVE_ID) byId.delete(c.fileId);
      else byId.set(c.fileId, c.file);
    }
    next = data.newStartPageToken || next;
    pageToken = data.nextPageToken || null;
  }
  return { files: [...byId.values()], token: next || token };
}

/** Files created in Granted Files since an instant (the dry-run script; moved-in files aren't found this way). */
export async function createdSince(drive, sinceIso) {
  const files = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      corpora: 'drive', driveId: GRANTED_FILES_DRIVE_ID, includeItemsFromAllDrives: true, supportsAllDrives: true,
      q: `trashed = false and createdTime > '${sinceIso}' and mimeType != '${FOLDER_MIME}'`,
      fields: `nextPageToken, files(${FILE_FIELDS})`, pageSize: 1000, pageToken
    });
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

/** A folder walker with a cache: file → [{id, name}] from the drive root down to its parent. */
export function pathWalker(drive) {
  const cache = new Map();
  const folder = async (id) => {
    if (!cache.has(id)) {
      cache.set(id, drive.files.get({ fileId: id, fields: 'id,name,parents', supportsAllDrives: true }).then(r => r.data));
    }
    return cache.get(id);
  };
  return async (file) => {
    const out = [];
    let parent = (file.parents || [])[0];
    for (let i = 0; parent && parent !== GRANTED_FILES_DRIVE_ID && i < 30; i++) {
      const f = await folder(parent);
      out.unshift({ id: f.id, name: f.name });
      parent = (f.parents || [])[0];
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// The suggestion (one Haiku call, metadata only)
// ---------------------------------------------------------------------------

export const SUGGEST_TOOL = {
  name: 'suggest_filing',
  description: 'Suggest where a Granted Files file belongs and what to call it, under the filing rules.',
  input_schema: {
    type: 'object',
    properties: {
      confident: { type: 'boolean', description: 'true only if the home and name are clear from the facts given' },
      destination_path: { type: 'string', description: 'Folder path inside Granted Files, parts joined by "/", e.g. "Clients/Caliber Projects/CanExport/2026/Claims/202609". Empty if not confident.' },
      new_name: { type: 'string', description: 'The new file name without an extension, following the patterns. Empty to keep the current name.' },
      reason: { type: 'string', description: 'One short sentence: the type and the rule applied.' }
    },
    required: ['confident', 'destination_path', 'new_name', 'reason']
  }
};

export function suggestSystem(programNames) {
  return `You file documents in Granted Consulting's "Granted Files" shared drive. You see only a file's name, type and current folder, never its contents.

Folder rules:
- Client work: Clients/{Client}/{Program}/{YYYY}/[stage]/... Program is the standard folder name (list below). The year is a bare YYYY. Stage folders: Application, Approval Docs, Claims (with {YYYYMM} inside), Reimbursements, Paystubs, Reporting, Hiring. Reuse a variant that already exists (e.g. "Reimb").
- Client work tied to no program (grant planners, readiness assessments, business info, licences): Clients/{Client}/General/{YYYY or Undated}/.
- Program material: Programs/{Program}/Guidance | Templates | Examples | _Unfiled.
- Internal work: Departments/{DEPT}/{Topic}/ — always inside a topic subfolder, never loose at the top. Departments: OPERATIONS, MARKETING, SALES, RESEARCH, WRITERS, PRODUCT, AI, LEADERSHIP.
- Use folders that already exist (listed in the facts) whenever one fits. You may propose a new year, stage or topic folder below an existing client, program or department folder. Never propose Old Files, Active Clients, Review, Pre-Call Briefings, Departments/Mindfulness, HR or FINANCE.

Name rules (new files): follow the type's pattern exactly (below), hyphens with no spaces around them. {Program} in a name is the program's code; {Client} is the client folder's name. Dates: YYYYMM, YYYYMM-YYYYMM, YYYYMMDD, YYYY, FY2024. Internal docs: DEPT-###-Short Name (controlled), Type-YYYYMMDD-Topic (everyday), Type-Topic (living). No v2/FINAL/draft/Copy of. Keep the file's own key words. Photos and video: keep the name.

Claims and paystubs (these override the type list below):
- A file already inside a claim folder is never moved. A claim folder is a folder in Claims that is not a YYYYMM month (e.g. ".../claims/CHFA 2026"), or a folder below a student or intake folder whose name signals a claim or pay period (e.g. ".../2026/Fall 2026/Fall intake first claim paystubs", ".../2026/Electrical Apprentice - Amir Beheshtian/Oct 8 to Oct 23"), or any folder below one. For such a file: leave destination_path empty and suggest a rename only, as {Type}-Exp{N}-{YYYYMMDD}-{Vendor}, keeping the expense number and the full date (e.g. "Expense 10 - Proof of Payment - Kickback Social - 11 August 2026" → "Proof of Payment-Exp10-20260811-Kickback Social"). No expense number in the name: {Type}-{YYYYMMDD}-{Vendor}. No full date in the name: not confident.
- Paystubs for wage-subsidy programs (Eco Canada SWPP, Eco Canada YNR, WorkBC and similar) are filed under the EMPLOYER as the client: Clients/{Employer}/{Program}/{YYYY}/Claims, with no month folder inside. If the file already sits in a student or intake/season folder directly under the year (e.g. "2026/Electrical Apprentice - Amir Beheshtian/...", "2026/Fall 2026/..."), put Claims inside that folder ("2026/Electrical Apprentice - Amir Beheshtian/Claims", "2026/Fall 2026/Claims"); only use {YYYY}/Claims when there is no such folder. A paystub already in a claim or pay-period folder stays where it is. Reuse a program folder the employer already has for that program (e.g. "Eco-Canada CO-OP" for Eco Canada SWPP); otherwise SWPP → "ECO Canada", YNR → "ECO Canada-YNR - STIP", WorkBC → "WorkBC Wage Subsidy". If the client, program, year or Claims folder doesn't exist, propose it anyway (this is the one case where a new client folder may be proposed); a missing folder is not a reason to be unsure.
- "Paystubs-{Program}-{Employee}-{Employer}-{Pay period}" is an official name: leave new_name empty for a file named this way.

Dates: use only a month or day you can see in the file name or folder names (e.g. "September 2026" → 202609). Never make one up. If the pattern or a Claims month folder needs a date you can't see, set confident to false.
If the client, program or year can't be told from the facts, set confident to false. A wrong confident guess is worse than "not sure".

Document types — pattern → home (inside the year folder unless it starts with Clients/ or Programs/):
${typePatterns().join('\n')}

Standard program folder names:
${programNames.join('\n')}`;
}

/** Facts for one file, as plain lines. */
export function suggestFacts({ file, path, failures, nearby }) {
  return [
    `File name: ${file.name}`,
    `File type: ${file.mimeType}`,
    file.createdTime ? `Added: ${String(file.createdTime).slice(0, 10)}` : null,
    `Current folder: Granted Files/${path.map(p => p.name).join('/')}`,
    `Rule checks failed: ${failures.join(', ')}`,
    nearby.length ? `Existing folders nearby:\n${nearby.map(n => `- ${n}`).join('\n')}` : 'Existing folders nearby: (none listed)'
  ].filter(Boolean).join('\n');
}

/** Folder names near the file the model may use: the client's programs and years, or the department's topics. */
async function nearbyFolders(drive, deps, path) {
  const keys = path.map(p => folderKey(p.name));
  const out = [];
  try {
    if (keys[0] === 'clients' && path[1] && keys[1] !== folderKey('_Unsorted')) {
      const { folders: programs } = await deps.childFolders(drive, path[1].id);
      for (const p of programs.slice(0, 40)) {
        const { folders: years } = await deps.childFolders(drive, p.id);
        out.push(`Clients/${path[1].name}/${p.name}${years.length ? ` (${years.map(y => y.name).slice(0, 12).join(', ')})` : ''}`);
      }
    } else if (keys[0] === 'departments' && path[1]) {
      const { folders } = await deps.childFolders(drive, path[1].id);
      out.push(...folders.slice(0, 60).map(f => `Departments/${path[1].name}/${f.name}`));
    } else if (keys[0] === 'departments') {
      const { folders } = await deps.childFolders(drive, path[0].id);
      out.push(...folders.map(f => `Departments/${f.name}`));
    }
  } catch { /* fewer facts; the model can still say not sure */ }
  return out;
}

export async function suggest({ file, path, failures, drive, deps, programNames, meta = {} }) {
  const nearby = await nearbyFolders(drive, deps, path);
  const response = await deps.createMessage({
    model: MODEL, max_tokens: 600, temperature: 0, system: suggestSystem(programNames),
    tools: [SUGGEST_TOOL], tool_choice: { type: 'tool', name: SUGGEST_TOOL.name },
    messages: [{ role: 'user', content: suggestFacts({ file, path, failures, nearby }) }]
  }, { timeout: MODEL_TIMEOUT_MS, maxRetries: 1 });
  const usage = response?.usage || null;
  if (usage) deps.logCost({ usage, model: MODEL, source: 'filing-sweep', agentType: 'internal-oracle', metadata: meta });
  const costUsd = usage ? await deps.cost(usage) : 0;
  const input = (response?.content || []).find(b => b.type === 'tool_use' && b.name === SUGGEST_TOOL.name)?.input || {};
  return {
    confident: input.confident === true && Boolean(String(input.destination_path || '').trim() || String(input.new_name || '').trim()),
    destination_path: String(input.destination_path || '').trim().replace(/^Granted Files\//i, ''),
    new_name: String(input.new_name || '').trim(),
    reason: String(input.reason || '').trim().slice(0, 300),
    costUsd
  };
}

// ---------------------------------------------------------------------------
// Evaluate, route, group
// ---------------------------------------------------------------------------

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Year-months a file's own name and folders show: 202609, 2026-09, "September 2026", "Sept 30 2026". */
export function visibleMonths(text) {
  const out = new Set();
  const t = String(text).toLowerCase();
  for (const m of t.matchAll(/(?<!\d)(20\d{2})[-_ ]?(0[1-9]|1[0-2])(?:[-_ ]?\d{2})?(?!\d)/g)) out.add(`${m[1]}${m[2]}`);
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\b[^0-9]{0,4}(?:\d{1,2}\b[^0-9]{0,25})?(20\d{2})\b/g)) {
    const month = MONTHS.findIndex(n => n.startsWith(m[1])) + 1;
    if (month) out.add(`${m[2]}${String(month).padStart(2, '0')}`);
  }
  return out;
}

/** Year-months (YYYYMM, YYYYMMDD) in a suggestion that the file's name and folders don't show. */
export function inventedDates(suggestion, file, path) {
  const seen = visibleMonths(`${file.name} ${path.map(p => p.name).join(' ')}`);
  const proposed = `${suggestion.destination_path || ''} ${suggestion.new_name || ''}`;
  const bad = [];
  for (const m of proposed.matchAll(/(?<!\d)(20\d{2})(\d{2})(\d{2})?(?!\d)/g)) {
    const ym = `${m[1]}${m[2]}`;
    if (Number(m[2]) < 1 || Number(m[2]) > 12 || !seen.has(ym)) bad.push(m[0]);
  }
  return [...new Set(bad)];
}

/** Full dates (YYYYMMDD) a text shows: 20260811, 2026-08-11, "11 August 2026", "August 11 2026", "Aug 11, 2026". */
export function visibleDays(text) {
  const out = new Set();
  const t = String(text).toLowerCase();
  const add = (y, m, d) => { if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.add(`${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`); };
  for (const m of t.matchAll(/(?<!\d)(20\d{2})[-_ ]?(0[1-9]|1[0-2])[-_ ]?(0[1-9]|[12]\d|3[01])(?!\d)/g)) add(m[1], Number(m[2]), Number(m[3]));
  const month = (w) => MONTHS.findIndex(n => n.startsWith(w)) + 1;
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s,.-]+(20\d{2})\b/g)) add(m[3], month(m[2]), Number(m[1]));
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s,.-]+(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+(20\d{2})\b/g)) add(m[3], month(m[1]), Number(m[2]));
  return out;
}

/** The expense number a file's own name shows ("Expense 10 - …", "Exp 10", "Exp#10"), or null. */
export function expenseNumber(name) {
  const m = String(name).match(/\bexp(?:ense)?\.?\s*#?\s*(\d{1,4})(?!\d)/i);
  return m ? Number(m[1]) : null;
}

/**
 * Why a claim-folder rename breaks the rule, or null when it keeps it:
 * {Type}-Exp{N}-{YYYYMMDD}-{Vendor} with the file's own expense number and full date
 * ({Type}-{YYYYMMDD}-{Vendor} when its name has no expense number).
 */
export function claimRenameProblem(name, newName) {
  const proposed = String(newName || '').trim();
  if (!proposed) return 'claim folder: no rename suggested';
  const days = visibleDays(name);
  if (!days.size) return 'claim folder: no full date in the name';
  const m = proposed.match(CLAIM_NAME);
  if (!m) return 'claim folder: rename is not {Type}-Exp{N}-{YYYYMMDD}-{Vendor}';
  const n = expenseNumber(name);
  if (n !== null && Number(m[2]) !== n) return `claim folder: rename drops or changes the expense number (Exp${n})`;
  if (n === null && m[2]) return 'claim folder: rename adds an expense number the name does not show';
  if (!days.has(m[3])) return `claim folder: date ${m[3]} is not the full date in the name`;
  return null;
}

async function userByEmail(query, email) {
  if (!email) return null;
  const r = await query('SELECT id, email, name, chat_user_id FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true LIMIT 1', [email]);
  return r.rows[0] || null;
}

/**
 * Check, suggest and validate each file. Returns one item per file:
 * { file, path, recipient, routed, status: 'excluded'|'ok'|'unsure'|'card', failures, suggestion, plan, note, costUsd }
 */
export async function evaluate(files, { drive, deps, env, meta = {} }) {
  const walk = pathWalker(drive);
  const names = deps.programNames ? deps.programNames() : programLines();
  const fallback = await userByEmail(deps.query, fallbackEmail(env));
  const items = [];
  const targets = new Set();   // path + name already proposed this run: no two files get the same one
  for (const file of files) {
    const path = await walk(file);
    const check = checkFile({ path: path.map(p => p.name), name: file.name, mimeType: file.mimeType });
    const editor = file.lastModifyingUser?.emailAddress || '';
    const person = GRANTED.test(editor) ? await userByEmail(deps.query, editor) : null;
    const recipient = person || fallback;
    const item = { file, path, recipient, routed: person ? 'last_modifier' : 'fallback_no_person', failures: check.failures, costUsd: 0 };
    if (check.excluded) { items.push({ ...item, status: 'excluded', note: check.excluded }); continue; }
    if (!check.failures.length) { items.push({ ...item, status: 'ok' }); continue; }
    if (!recipient) { items.push({ ...item, status: 'unsure', note: 'no recipient' }); continue; }
    let suggestion;
    try {
      suggestion = await suggest({ file, path, failures: check.failures, drive, deps, programNames: names, meta });
    } catch (err) {
      items.push({ ...item, status: 'unsure', note: `model ${err?.code || err?.status || 'error'}` });
      continue;
    }
    // The pilot rules (reference.md "Claims, paystubs and wage subsidies"), enforced whatever the model said:
    // nothing leaves a claim folder, and Delpreet's paystub names are kept. Cleared first, so a dropped part can't fail a check.
    const inClaimFolder = claimFolder(path.map(p => p.name));
    const conventionName = isPaystubConvention(file.name, file.mimeType);
    if (inClaimFolder) suggestion.destination_path = '';
    if (conventionName) suggestion.new_name = '';
    if (/^(Type|\{)|[{}]/.test(suggestion.new_name)) { items.push({ ...item, status: 'unsure', suggestion, costUsd: suggestion.costUsd, note: 'name still has a pattern placeholder' }); continue; }
    const invented = inventedDates(suggestion, file, path);
    if (invented.length) { items.push({ ...item, status: 'unsure', suggestion, costUsd: suggestion.costUsd, note: `date not in the file's name or folders (${invented.join(', ')})` }); continue; }
    if (!suggestion.confident) { items.push({ ...item, status: 'unsure', suggestion, costUsd: suggestion.costUsd, note: suggestion.reason }); continue; }
    const unsure = (note) => items.push({ ...item, status: 'unsure', suggestion, costUsd: suggestion.costUsd, note });
    if (inClaimFolder) {
      const problem = claimRenameProblem(file.name, suggestion.new_name);
      if (problem) { unsure(problem); continue; }
    }
    let destParts = suggestion.destination_path.split('/').map(p => p.trim()).filter(Boolean);
    if (conventionName) {
      // Same client, program and year as now: keep its student or intake folder (Claims inside it), never flatten.
      const home = paystubHome(path.map(p => p.name));
      if (home && destParts.length >= 4 && home.slice(0, 4).every((p, i) => folderKey(p) === folderKey(destParts[i]))) {
        destParts = home;
        suggestion.destination_path = home.join('/');
      }
      if (!destParts.length) { unsure('paystub: no folder suggested'); continue; }
      if (!inClaims(destParts)) { unsure(`paystub: ${suggestion.destination_path} is not a year's Claims folder`); continue; }
    }
    // A paystub's employer with no client folder: planFileMove only creates folders below a client, so advise instead.
    if (deps.resolvePath && destParts.length > 1 && folderKey(destParts[0]) === 'clients' && /paystub/i.test(`${file.name} ${suggestion.new_name}`)) {
      const walk = await deps.resolvePath(drive, destParts).catch(() => null);
      if (walk?.missingAt === 1) {
        items.push({ ...item, status: 'advised', suggestion, costUsd: suggestion.costUsd, foldersToCreate: destParts.slice(1), note: `${destParts[0]}/${destParts[1]} doesn't exist yet` });
        continue;
      }
    }
    const planned = await deps.planFileMove(
      { file: file.id, destination_path: suggestion.destination_path || null, new_name: suggestion.new_name || null },
      { askerEmail: recipient.email, askerUserId: recipient.id });
    if (!planned?.ok) { items.push({ ...item, status: 'unsure', suggestion, costUsd: suggestion.costUsd, note: planned?.reason || 'plan refused' }); continue; }
    const target = `${planned.plan.path_after}/${planned.plan.name_after}`.toLowerCase();
    if (targets.has(target)) { items.push({ ...item, status: 'unsure', suggestion, costUsd: suggestion.costUsd, note: 'another new file would get the same home and name' }); continue; }
    targets.add(target);
    items.push({ ...item, status: 'card', suggestion, plan: planned.plan, costUsd: suggestion.costUsd });
  }
  return items;
}

/**
 * Per-recipient groups for the items that would reach someone. Pilot: anyone
 * not on the list is held back (would_suggest). Items going to the same folder
 * share one card: {kind: 'move'|'advise'|'unsure', key, items}. At most
 * MAX_CARDS cards each (moves first); the rest are listed.
 * @returns {{groups: Map<string, {recipient, cards, listed}>, held: Array}}
 */
const KIND = { card: 'move', advised: 'advise', unsure: 'unsure' };
const KIND_ORDER = ['move', 'advise', 'unsure'];
export function groupByRecipient(items, { pilot = null } = {}) {
  const byEmail = new Map();
  const held = [];
  for (const item of items) {
    const kind = KIND[item.status];
    if (!kind) continue;
    const email = String(item.recipient?.email || '').toLowerCase();
    if (!email) continue;
    if (!inPilot(email, pilot)) { if (item.status === 'card') held.push(item); continue; }
    if (!byEmail.has(email)) byEmail.set(email, { recipient: item.recipient, byKey: new Map() });
    const g = byEmail.get(email);
    // One card per destination (and per person a fallback item was meant for).
    const key = `${kind}|${destinationOf(item).toLowerCase()}|${String(item.originalEmail || '').toLowerCase()}`;
    if (!g.byKey.has(key)) g.byKey.set(key, { kind, key, items: [] });
    g.byKey.get(key).items.push(item);
  }
  const groups = new Map();
  for (const [email, { recipient, byKey }] of byEmail) {
    const all = [...byKey.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    groups.set(email, { recipient, cards: all.slice(0, MAX_CARDS), listed: all.slice(MAX_CARDS) });
  }
  return { groups, held };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const homeOf = (plan) => String(plan.path_after || '').replace(/^Granted Files\//, '');
const folderOf = (item) => item.path.map(p => p.name).join('/');
/** The folder a card is about: where the files go, or (not sure) the model's guess, else where they are now. */
export function destinationOf(item) {
  if (item.status === 'card') return homeOf(item.plan);
  return String(item.suggestion?.destination_path || '') || folderOf(item);
}

/** "Delpreet", from users.name, else the start of their address. */
export function firstName(name, email = '') {
  const fromName = String(name || '').trim();
  if (fromName && !fromName.includes('@')) return fromName.split(/\s+/)[0];
  const local = String(email || name || '').split('@')[0].split(/[._-]/)[0];
  return local ? local[0].toUpperCase() + local.slice(1) : 'Someone';
}

/** For a card that came to the fallback because its person has no DM with Oracle yet. */
export function forLine(items) {
  const first = items.find(i => i.routed === 'fallback_unreachable');
  if (!first) return '';
  const who = firstName(first.originalName, first.originalEmail);
  return items.length === 1
    ? `${who}'s file — they're not on Chat yet, so it's come to you.`
    : `${who}'s files — they're not on Chat yet, so they've come to you.`;
}

/**
 * What a card shows, from the items at send time or from the log rows at press
 * time (sweep-card.js): {kind, destination, moving, foldersToCreate, files: [{id, name, link, nameAfter}], note, forLine}.
 */
export function cardView(card) {
  const first = card.items[0];
  const files = card.items.map(i => ({
    id: i.file.id,
    name: i.file.name,
    link: i.file.webViewLink || `https://drive.google.com/open?id=${i.file.id}`,
    nameAfter: card.kind === 'move' && i.plan.name_after !== i.plan.name_before ? i.plan.name_after
      : (card.kind === 'advise' && i.suggestion?.new_name ? i.suggestion.new_name : null)
  }));
  return {
    kind: card.kind,
    destination: card.kind === 'move' ? homeOf(first.plan) : destinationOf(first),
    moving: card.kind === 'move' ? card.items.some(i => i.plan.moving !== false && i.plan.path_after !== i.plan.path_before) : card.kind === 'advise',
    foldersToCreate: card.kind === 'move' ? (first.plan.folders_to_create || []) : (first.foldersToCreate || []),
    files,
    note: card.kind === 'move' ? null : ([...new Set(card.items.map(i => i.note).filter(Boolean))].join('; ') || null),
    forLine: forLine(card.items)
  };
}

/** "9 Eco Canada SWPP paystubs for AME Consulting Group", "3 Proof of Payment files", "Invoice 4.pdf", "4 files". */
export function whatLine(files) {
  const n = files.length;
  if (n === 1) return files[0].name;
  if (files.every(f => isPaystubConvention(f.name))) {
    const parts = files.map(f => baseName(f.name).split('-').map(p => p.trim()));
    const [program, employer] = [parts[0][1], parts[0][3]];
    return parts.every(p => p[1] === program && p[3] === employer) ? `${n} ${program} paystubs for ${employer}` : `${n} paystubs`;
  }
  const typeOf = (f) => TYPES.find(t => String(f.nameAfter || f.name).toLowerCase().startsWith(`${t.toLowerCase()}-`)) || null;
  const type = typeOf(files[0]);
  if (type && files.every(f => typeOf(f) === type)) return `${n} ${type} files`;
  return `${n} files`;
}

/** The card's one-line summary. */
export function summaryLine(view) {
  const what = whatLine(view.files);
  if (view.kind === 'unsure') return view.files.length === 1 ? `Not sure where ${what} goes` : `Not sure where these ${view.files.length} files go`;
  if (view.kind === 'move' && !view.moving) return `${what} — rename${view.files.length === 1 ? '' : 's'} in ${view.destination}`;
  return `${what} → ${view.destination}`;
}

export function headerText(group) {
  const moves = [...group.cards, ...group.listed].filter(c => c.kind === 'move').reduce((n, c) => n + c.items.length, 0);
  const others = [...group.cards, ...group.listed].filter(c => c.kind !== 'move').reduce((n, c) => n + c.items.length, 0);
  const s = (n) => (n === 1 ? '' : 's');
  if (moves) {
    return [`**Filing suggestions** — ${moves} new file${s(moves)} in Granted Files look${moves === 1 ? 's' : ''} misfiled or misnamed. Files going to the same folder share one card; nothing moves until you press Confirm. Press Skip if they're fine where they are.`,
      others ? `${others} more I couldn't file myself — see the cards below.` : null].filter(Boolean).join('\n\n');
  }
  return `**Filing check** — ${others} new file${s(others)} in Granted Files I couldn't file myself. Reply in this thread to tell me where ${others === 1 ? 'it goes' : 'they go'}, or press Leave it here.`;
}

export function overflowText(listed) {
  const lines = [];
  for (const card of listed) {
    for (const i of card.items) {
      const link = `[${i.file.name}](${i.file.webViewLink || `https://drive.google.com/open?id=${i.file.id}`})`;
      if (card.kind === 'move') lines.push(`- ${link} → ${homeOf(i.plan)}${i.plan.name_after !== i.plan.name_before ? `, as "${i.plan.name_after}"` : ''}`);
      else if (card.kind === 'advise') lines.push(`- ${link} → ${destinationOf(i)} (${i.note})`);
      else lines.push(`- ${link} — not sure where it goes`);
    }
    const f = forLine(card.items);
    if (f) lines.push(`  ${f}`);
  }
  const n = listed.reduce((t, c) => t + c.items.length, 0);
  return [`${n} more (no card — reply if you want any of them filed):`, ...lines].join('\n');
}

/** What a reply in the thread needs to know (saved as a system note in the thread's conversation). */
export function threadNote(group) {
  const lines = ['[System event — recorded by Granted\'s systems, not typed by anyone] Oracle posted filing suggestions in this thread:'];
  for (const card of [...group.cards, ...group.listed]) {
    for (const i of card.items) {
      const id = `${i.file.name} (Drive file ID: ${i.file.id})`;
      if (card.kind === 'move') lines.push(`- ${id} — now in ${String(i.plan.path_before)}; suggested ${homeOf(i.plan)}${i.plan.name_after !== i.plan.name_before ? `, as "${i.plan.name_after}"` : ''}`);
      else if (card.kind === 'advise') lines.push(`- ${id} — now in Granted Files/${folderOf(i)}; suggested ${destinationOf(i)}${i.suggestion?.new_name ? `, as "${i.suggestion.new_name}"` : ''}, but ${i.note}: asked the person to create it, then reply`);
      else lines.push(`- ${id} — not sure where it goes; asked the person`);
    }
  }
  return lines.join('\n');
}

async function logItem(q, runId, item, status, extra = {}) {
  const r = await q(INSERT_SQL, [
    runId, item.file.id, item.file.name, item.file.mimeType || null,
    `Granted Files/${item.path.map(p => p.name).join('/')}`,
    item.recipient?.email || null, item.recipient?.id ?? null, item.routed || null,
    item.failures || [],
    item.plan ? homeOf(item.plan) : (item.suggestion?.destination_path || null),
    item.plan ? item.plan.name_after : (item.suggestion?.new_name || null),
    (item.suggestion?.reason || item.note || null)?.slice?.(0, 500) ?? null,
    status, item.costUsd || 0
  ]);
  const id = r.rows[0]?.id || null;
  const sets = Object.entries(extra);
  if (id && sets.length) {
    await q(`UPDATE filing_sweep_suggestions SET ${sets.map(([k], i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...sets.map(([, v]) => v)]);
  }
  return id;
}

const LOG_STATUS = { move: 'listed', advise: 'advised', unsure: 'unsure' };

/** Send one recipient's thread: header, one card per destination, overflow list. Logs each item. */
async function sendGroup(group, { runId, deps, spaceName, date }) {
  const q = deps.query;
  const header = headerText(group);
  const posted = await deps.post({ spaceName, text: header, fallbackText: 'Filing suggestions' });
  const threadName = posted.threadName;
  if (threadName && group.recipient?.id) {
    const threadConversation = await deps.conversationFor(threadName);
    await deps.createConversation(threadConversation, group.recipient.id, 'internal-oracle', `Filing suggestions ${date}`).catch(() => {});
    await deps.saveMessage(threadConversation, 'system', threadNote(group)).catch(() => {});
  }
  const askerName = group.recipient.name || group.recipient.email;
  for (const card of group.cards) {
    const groupId = deps.newId ? deps.newId() : randomUUID();
    const sent = [];
    for (const item of card.items) {
      if (card.kind !== 'move') {
        // Log first: file_id is unique, so a file an earlier run already logged gets no second card.
        if (await logItem(q, runId, item, LOG_STATUS[card.kind], { space_name: spaceName, thread_name: threadName, group_id: groupId })) sent.push(item);
        continue;
      }
      const conversationId = await deps.conversationFor(`filing-sweep:${item.file.id}`);
      const suggestionId = await logItem(q, runId, item, 'suggested', { conversation_id: conversationId, space_name: spaceName, thread_name: threadName, group_id: groupId });
      if (!suggestionId) continue;
      // Each file stays its own pending action (Confirm gate, drive_actions, undo); the card confirms them together.
      await deps.createConversation(conversationId, group.recipient.id, 'internal-oracle', `Filing: ${item.file.name}`.slice(0, 200)).catch(() => {});
      const summary = await deps.summarizeAction('file_move_rename', item.plan);
      const action = await deps.savePendingAction({ conversationId, toolName: 'file_move_rename', input: item.plan, userId: group.recipient.id, summary });
      await q(`UPDATE pending_actions SET expires_at = NOW() + INTERVAL '${IGNORE_DAYS} days' WHERE id = $1`, [action.id]);
      await q('UPDATE filing_sweep_suggestions SET pending_action_id = $2 WHERE id = $1', [suggestionId, action.id]);
      sent.push(item);
    }
    if (!sent.length) continue;
    const view = cardView({ ...card, items: sent });
    const cardsV2 = await deps.renderCard(view, { groupId, askerName });
    const msg = await deps.post({ spaceName, threadName, cardsV2, fallbackText: summaryLine(view) });
    if (msg?.messageName) await q('UPDATE filing_sweep_suggestions SET message_name = $2 WHERE group_id = $1', [groupId, msg.messageName]);
  }
  if (group.listed.length) {
    await deps.post({ spaceName, threadName, text: overflowText(group.listed) });
    for (const card of group.listed) for (const item of card.items) await logItem(q, runId, item, LOG_STATUS[card.kind], { space_name: spaceName, thread_name: threadName });
  }
}

/** Where a recipient's thread goes: their DM, else the fallback's (items marked for them). */
async function reachable(recipient, deps) {
  if (!recipient?.chat_user_id) return null;
  return deps.findDm(recipient.chat_user_id).catch(() => null);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * @param {{now?: Date, env?: Object, deps?: Object}} opts
 * @returns {Promise<Object>} a summary of counts (no names)
 */
export async function runFilingSweep({ now = new Date(), env = process.env, deps: given = defaultDeps() } = {}) {
  const deps = given;
  const q = deps.query;
  const date = localDate(now);
  let runId;
  try {
    runId = (await q(CLAIM_SQL, ['sweep', date])).rows[0]?.id;
  } catch (err) {
    if (err?.code === '42P01') { console.warn('⚠️  Filing sweep: tables missing — apply migration 055'); return { status: 'no_state_table' }; }
    throw err;
  }
  if (!runId) return { status: 'already_ran' };

  let tokenBefore = null;
  try {
    const drive = await deps.readDrive(String(env.FILING_SWEEP_READER_EMAIL || fallbackEmail(env)));
    tokenBefore = (await q(LAST_TOKEN_SQL)).rows[0]?.page_token_after || null;

    if (!tokenBefore) {
      // First run: remember everything that is already there; check nothing.
      const { ids, token } = await baseline(drive);
      for (let i = 0; i < ids.length; i += 5000) await q(REMEMBER_SQL, [ids.slice(i, i + 5000)]);
      await q(COMPLETE_SQL, [runId, null, token, JSON.stringify({ baseline: ids.length }), 0]);
      console.log(`🗂️  Filing sweep baseline — ${ids.length} files remembered`);
      return { status: 'baseline', files: ids.length };
    }

    for (const sql of RECONCILE_SQL) await q(sql);
    await q(IGNORE_SQL);

    const { files: changed, token: tokenAfter } = await changedFiles(drive, tokenBefore);
    const ids = changed.map(f => f.id);
    const known = new Set(ids.length ? (await q(KNOWN_SQL, [ids])).rows.map(r => r.file_id) : []);
    const filedByOracle = new Set(ids.length ? (await q(ORACLE_FILED_SQL, [ids])).rows.map(r => r.file_id) : []);
    const fresh = changed.filter(f => !known.has(f.id) && !filedByOracle.has(f.id) && f.mimeType !== FOLDER_MIME);

    const items = await evaluate(fresh, { drive, deps, env, meta: { sweep_run_id: runId } });
    for (const item of items.filter(i => i.status === 'excluded' || i.status === 'ok')) await logItem(q, runId, item, item.status);

    // Unreachable recipients: their items go to the fallback's thread.
    const fallback = await userByEmail(q, fallbackEmail(env));
    const spaces = new Map();
    for (const item of items.filter(i => i.status === 'card' || i.status === 'unsure' || i.status === 'advised')) {
      const email = item.recipient.email.toLowerCase();
      if (!spaces.has(email)) spaces.set(email, await reachable(item.recipient, deps));
      if (!spaces.get(email) && fallback && email !== fallback.email.toLowerCase()) {
        item.originalEmail = item.recipient.email;
        item.originalName = item.recipient.name || null;
        item.recipient = fallback;
        item.routed = 'fallback_unreachable';
        // Only the asker can confirm a move, so the card is re-planned as the fallback.
        if (item.status === 'card') {
          const planned = await deps.planFileMove(item.plan.request, { askerEmail: fallback.email, askerUserId: fallback.id });
          if (planned?.ok) item.plan = planned.plan;
          else Object.assign(item, { status: 'unsure', plan: null, note: planned?.reason || 'plan refused' });
        }
      }
    }
    const pilot = pilotEmails(env);
    const { groups, held } = groupByRecipient(items, { pilot });
    for (const item of held) await logItem(q, runId, item, 'would_suggest');
    // Unsure and advised items for people outside the pilot are logged without a message.
    for (const item of items.filter(i => (i.status === 'unsure' || i.status === 'advised') && !inPilot(i.recipient?.email, pilot))) await logItem(q, runId, item, item.status === 'advised' ? 'advised' : 'unsure');

    let sent = 0;
    for (const [email, group] of groups) {
      const spaceName = spaces.get(email) ?? await reachable(group.recipient, deps);
      if (!spaceName) {
        for (const card of [...group.cards, ...group.listed]) {
          for (const item of card.items) await logItem(q, runId, item, card.kind === 'move' ? 'would_suggest' : LOG_STATUS[card.kind]);
        }
        continue;
      }
      await sendGroup(group, { runId, deps, spaceName, date });
      sent++;
    }

    if (ids.length) await q(REMEMBER_SQL, [ids]);
    const counts = countsOf(items, { held: held.length, recipients: sent });
    const cost = items.reduce((s, i) => s + (i.costUsd || 0), 0);
    await q(COMPLETE_SQL, [runId, tokenBefore, tokenAfter, JSON.stringify(counts), cost]);
    console.log(`🗂️  Filing sweep — ${JSON.stringify(counts)}`);
    return { status: 'done', ...counts };
  } catch (err) {
    await q(FAIL_SQL, [runId, String(err?.code || err?.name || 'error').slice(0, 60)]).catch(() => {});
    throw err;
  }
}

export function countsOf(items, extra = {}) {
  const c = { new_files: items.length };
  for (const i of items) c[i.status] = (c[i.status] || 0) + 1;
  return { ...c, ...extra };
}

// ---------------------------------------------------------------------------
// Weekly summary (Mondays, to the fallback)
// ---------------------------------------------------------------------------

export function summaryText({ week, total, skipped, failures }) {
  const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none';
  return [
    '**Filing sweep — weekly summary**',
    `Last 7 days: ${fmt(week)}`,
    `Since the start: ${fmt(total)}`,
    failures.length ? `Skipped most often for: ${failures.map(f => `${f.failure} (${f.n})`).join(', ')}` : null,
    skipped.length ? `Skipped files:\n${skipped.map(s => `- [${s.file_name}](https://drive.google.com/open?id=${s.file_id}) → suggested ${s.suggested_path || '—'}${s.recipient_email ? ` (${s.recipient_email})` : ''}`).join('\n')}` : 'No files were skipped.'
  ].filter(Boolean).join('\n\n');
}

export async function runWeeklySummary({ now = new Date(), env = process.env, deps: given = defaultDeps() } = {}) {
  const deps = given;
  const q = deps.query;
  let runId;
  try {
    runId = (await q(CLAIM_SQL, ['summary', localDate(now)])).rows[0]?.id;
  } catch (err) {
    if (err?.code === '42P01') return { status: 'no_state_table' };
    throw err;
  }
  if (!runId) return { status: 'already_ran' };
  try {
    const counts = async (where) => Object.fromEntries((await q(`SELECT status, COUNT(*)::int AS n FROM filing_sweep_suggestions ${where} GROUP BY status`)).rows.map(r => [r.status, r.n]));
    const week = await counts(`WHERE created_at > NOW() - INTERVAL '7 days'`);
    const total = await counts('');
    const skipped = (await q(`SELECT file_id, file_name, suggested_path, recipient_email FROM filing_sweep_suggestions WHERE status = 'skipped' AND resolved_at > NOW() - INTERVAL '7 days' ORDER BY resolved_at DESC LIMIT 10`)).rows;
    const failures = (await q(`SELECT f AS failure, COUNT(*)::int AS n FROM filing_sweep_suggestions, unnest(rule_failures) f WHERE status = 'skipped' GROUP BY f ORDER BY n DESC LIMIT 3`)).rows;
    const to = await userByEmail(q, fallbackEmail(env));
    const spaceName = to?.chat_user_id ? await deps.findDm(to.chat_user_id).catch(() => null) : null;
    if (spaceName) await deps.post({ spaceName, text: summaryText({ week, total, skipped, failures }), fallbackText: 'Filing sweep summary' });
    await q(COMPLETE_SQL, [runId, null, null, JSON.stringify({ week, total, sent: Boolean(spaceName) }), 0]);
    return { status: spaceName ? 'sent' : 'no_dm', week, total };
  } catch (err) {
    await q(FAIL_SQL, [runId, String(err?.code || err?.name || 'error').slice(0, 60)]).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export function startFilingSweep(cron, env = process.env) {
  if (env.FILING_SWEEP_ENABLED !== 'true') {
    console.log('⏸️  Filing sweep off (FILING_SWEEP_ENABLED is not "true")');
    return false;
  }
  const guard = (name, fn) => async () => {
    try { await fn({ env }); } catch (err) { console.error(`❌ ${name} failed — code: ${err?.code || err?.name || 'unknown'}`); }
  };
  cron.schedule(SWEEP_SCHEDULE, guard('Filing sweep', runFilingSweep), { name: 'filing-sweep', timezone: TZ, noOverlap: true });
  cron.schedule(SUMMARY_SCHEDULE, guard('Filing sweep summary', runWeeklySummary), { name: 'filing-sweep-summary', timezone: TZ, noOverlap: true });
  console.log('✅ Filing sweep scheduled (08:30 America/Vancouver Mon–Fri; summary Mondays 08:45)');
  return true;
}
