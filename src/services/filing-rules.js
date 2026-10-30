/**
 * Filing sweep — cheap rule checks (no Drive, no model)
 *
 * Decides whether a newly added Granted Files file looks misfiled or misnamed,
 * from its folder path and name only. The rules are the filing skill's
 * (.claude/skills/filing/reference.md): Clients/{Client}/{Program}/{YYYY}/…,
 * Clients/{Client}/General/{YYYY or Undated}/…, Departments/{DEPT}/{Topic}/…,
 * and Type-When-Who-Program names. A file that passes needs no suggestion; one
 * that fails gets a model call (src/services/filing-sweep.js).
 *
 * Never opens a file, and never judges sensitivity from content: names and
 * folders only (matchSensitive, as file_move_rename does).
 */

import fs from 'fs';
import { folderKey } from '../tools/google-drive.js';
import { matchSensitive } from '../tools/drive-sensitive.js';

const REFERENCE = new URL('../../.claude/skills/filing/reference.md', import.meta.url);
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

/** Document types from reference.md, spelled exactly. A client file's name starts with one, then "-". */
export const TYPES = Object.freeze([
  'Application Document', 'Funding Agreement', 'Business Certificate', 'Employer Participation Form',
  'Eligibility Assessment', 'Training Plan', 'Support Letter',
  'Budget Sheet', 'Bank Statement', 'Financial Statement', 'Tax Documents',
  'Claim Submission', 'Claim Confirmation', 'Invoice', 'Proof of Payment', 'Quote', 'Receipt', 'Timesheet', 'Paystub',
  'Employment Contract', 'Proof of WIL Form', 'Student Information Form', 'Vetting Form', 'Resume', 'Job Description',
  'Course Outline', 'Business Case', 'Training Certificate',
  'Progress Report', 'Final Report',
  'Grant Planner', 'Readiness Assessment', 'Business Licence',
  'Claim Form', 'Proposal'
]);

/** Top-level areas that are never filing targets, and department folders nothing is filed into. */
const EXCLUDED_TOP = new Set(['oldfiles', 'activeclients', 'review', 'precallbriefings'].map(folderKey));
export const EXCLUDED_DEPARTMENTS = new Set(['mindfulness', 'hr', 'finance'].map(folderKey));
// Machine-written subtrees: everything below a path whose last part starts with the given name
// (Departments/AI/Matching sweep — raw artifacts holds the matching engine's sweep reports).
export const EXCLUDED_SUBTREES = Object.freeze([['Departments', 'AI', 'Matching sweep']]);

let names = null;
/** Standard program folder names from the program table in reference.md, as written. */
export function programNames(text = null) {
  if (names && !text) return names;
  const source = text ?? fs.readFileSync(REFERENCE, 'utf8');
  const out = [];
  let inTable = false;
  for (const line of source.split('\n')) {
    if (line.startsWith('| Standard folder name |')) { inTable = true; continue; }
    if (!inTable) continue;
    if (!line.startsWith('|')) break;
    const name = line.split('|')[1]?.trim();
    if (name && !/^-+$/.test(name)) out.push(name);
  }
  if (!text) names = out;
  return out;
}

/** Program rows for the model: "Standard folder name (code)". */
export function programLines(text = null) {
  const source = text ?? fs.readFileSync(REFERENCE, 'utf8');
  const out = [];
  let inTable = false;
  for (const line of source.split('\n')) {
    if (line.startsWith('| Standard folder name |')) { inTable = true; continue; }
    if (!inTable) continue;
    if (!line.startsWith('|')) break;
    const [, name, code] = line.split('|').map(c => c.trim());
    if (name && !/^-+$/.test(name)) out.push(`${name} (code: ${String(code).replace(/\s*\(proposed\)$/, '')})`);
  }
  return out;
}

/** Each document type's pattern and home, from the type tables in reference.md: "Type: Pattern → Home (notes)". */
export function typePatterns(text = null) {
  const source = text ?? fs.readFileSync(REFERENCE, 'utf8');
  const out = [];
  for (const line of source.split('\n')) {
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 8 || !/^`.+`$/.test(cells[3] || '') || cells[1] === 'Type') continue;
    const [, type, , pattern, , home, notes] = cells;
    out.push(`${type}: ${pattern.replace(/`/g, '')} → ${home.replace(/`/g, '')}${notes ? ` (${notes})` : ''}`);
  }
  return out;
}

/** The same names, folderKey'd, for matching folders. */
export function programKeys(text = null) {
  return new Set(programNames(text).map(folderKey));
}

const typeKeys = TYPES.map(t => t.toLowerCase());

/** The name without a file extension (uploads keep one; Google files have none). */
export function baseName(name, mimeType = '') {
  if (String(mimeType).startsWith('application/vnd.google-apps.')) return String(name);
  return String(name).replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

function startsWithType(name) {
  const lower = name.toLowerCase();
  return typeKeys.some(t => lower.startsWith(`${t}-`) && lower.length > t.length + 1);
}

// Internal docs (reference.md "Internal docs"): controlled DEPT-###-Name,
// everyday Type-YYYYMMDD-Topic, Proposal-YYYYMMDD-Client, living Type-Topic.
const INTERNAL_PATTERNS = [
  /^[A-Z]{2,4}-\d{3}-\S/,
  /^[A-Z][^-]*-\d{8}-\S/,
  /^Proposal-\d{8}-\S/,
  /^[A-Z][^-]*[^\s-]-[^\s-]/
];

const isMedia = (mimeType) => /^(image|video)\//.test(String(mimeType || ''));

// Pilot rules (reference.md "Claims, paystubs and wage subsidies").
const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A claim-folder name: {Type}-Exp{N}-{YYYYMMDD}-{Vendor}, or {Type}-{YYYYMMDD}-{Vendor} with no expense number. Groups: type, N, date. */
export const CLAIM_NAME = new RegExp(`^(${TYPES.map(escape).join('|')})-(?:Exp(\\d+)-)?(\\d{8})-\\S`, 'i');
/** Delpreet's paystub convention: Paystubs-{Program}-{Employee}-{Employer}-{Pay period}. Never renamed. */
export const PAYSTUB_CONVENTION = /^Paystubs-[^-]+-[^-]+-[^-]+-\s*\S/i;
export const isPaystubConvention = (name, mimeType = '') => PAYSTUB_CONVENTION.test(baseName(name, mimeType).trim());

const isClaimsStage = (key) => key === 'claim' || key.startsWith('claims');
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
/** A folder name that signals a claim or a pay period: "first claim", "Claim 2", "Oct 8 to Oct 23", "8 Oct", "Pay period 3", "2026-10-08", "202610". */
export const CLAIM_OR_PERIOD = new RegExp(`\\bclaims?\\b|\\bpay\\s*period|\\b${MONTH}\\s*\\d{1,2}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s*${MONTH}(?![a-z])|(?<!\\d)20\\d{2}-?(?:0[1-9]|1[0-2])(?:-?\\d{2})?(?!\\d)`, 'i');
/**
 * True when the path is inside a claim folder:
 * - a named folder in a Claims stage (anything but a YYYYMM month), e.g. …/claims/CHFA 2026, or
 * - a folder below a student or intake folder whose name signals a claim or pay period,
 *   e.g. …/2026/Fall 2026/Fall intake first claim paystubs, …/2026/{Role}-{Student}/Oct 8 to Oct 23.
 */
export function claimFolder(path = []) {
  const i = path.findIndex((p, n) => n >= 3 && isClaimsStage(folderKey(p)));
  if (i !== -1 && i + 1 < path.length && !/^\d{6}$/.test(String(path[i + 1]).trim())) return true;
  return periodFolder(path);
}
/** The second kind only: a claim or pay-period folder below a student or intake folder. Files in it are left as they are. */
export const periodFolder = (path = []) => studentOrIntake(path) && path.slice(5).some(p => CLAIM_OR_PERIOD.test(String(p)));
// Clients/{Client}/{Program}/{YYYY}/{folder that isn't a stage}/…
const studentOrIntake = (path) => path.length > 5 && folderKey(path[0]) === 'clients' && /^\d{4}$/.test(String(path[3]).trim()) && !isStage(folderKey(path[4]));
/** True when the path has a Claims stage folder below the year (Clients/{Client}/{Program}/{YYYY}/…/Claims). */
export const inClaims = (path = []) => path.some((p, n) => n >= 4 && isClaimsStage(folderKey(p)));

// Stage folder names (reference.md "Client folders", aliases included): not a student or intake folder.
const isStage = (key) => isClaimsStage(key) || key.startsWith('reim') || key.endsWith('reimbursements')
  || ['application', 'approvaldocs', 'paystubs', 'reporting', 'hiring'].includes(key);

/**
 * Where a wage-subsidy paystub in this client/program/year belongs: Claims inside the student or
 * intake folder it already sits in (the folder directly under the year), else {YYYY}/Claims.
 * Null when the path isn't Clients/{Client}/{Program}/{YYYY}/….
 */
export function paystubHome(path = []) {
  if (path.length < 4 || folderKey(path[0]) !== 'clients' || !/^\d{4}$/.test(String(path[3]).trim())) return null;
  const keep = path[4] !== undefined && !isStage(folderKey(path[4])) ? [path[4]] : [];
  return [...path.slice(0, 4), ...keep, 'Claims'];
}

/**
 * @param {{path: string[], name: string, mimeType?: string}} file - path = folder
 *   names below the Granted Files root (e.g. ['Clients','Caliber Projects','CanExport','2026'])
 * @returns {{excluded: string|null, failures: string[]}}
 */
let keySet = null;
export function checkFile({ path = [], name = '', mimeType = '' }, { programSet = (keySet ||= programKeys()) } = {}) {
  if (mimeType === FOLDER_MIME) return { excluded: 'folder', failures: [] };
  if (mimeType === SHORTCUT_MIME) return { excluded: 'shortcut', failures: [] };
  const keys = path.map(folderKey);
  if (keys[0] && EXCLUDED_TOP.has(keys[0])) return { excluded: `area:${path[0]}`, failures: [] };
  if (keys[0] === 'departments' && keys[1] && EXCLUDED_DEPARTMENTS.has(keys[1])) return { excluded: `area:Departments/${path[1]}`, failures: [] };
  const subtree = EXCLUDED_SUBTREES.find(parts => parts.length <= keys.length
    && parts.every((p, i) => (i === parts.length - 1 ? keys[i].startsWith(folderKey(p)) : keys[i] === folderKey(p))));
  if (subtree) return { excluded: `area:${subtree.join('/')}`, failures: [] };
  if ([name, ...path].some(t => matchSensitive(t))) return { excluded: 'sensitive_name', failures: [] };

  const failures = [];
  const base = baseName(name, mimeType);
  const top = keys[0];

  if (!top) failures.push('loose_top_level');
  else if (top === 'clients') {
    const program = keys[2];
    if (path.length === 1) failures.push('loose_clients_root');
    else if (keys[1] === folderKey('_Unsorted')) failures.push('unsorted');
    else if (path.length === 2) failures.push('loose_client_root');
    else {
      const general = program === 'general';
      if (!general && !programSet.has(program)) failures.push('unknown_program');
      if (path.length === 3) failures.push('no_year');
      else if (!/^\d{4}$/.test(path[3].trim()) && !(general && keys[3] === 'undated')) failures.push('no_year');
    }
    if (periodFolder(path)) {
      // A claim or pay-period folder under a student or intake folder: left as it is, name included.
    } else if (isPaystubConvention(name, mimeType)) {
      // An official name; only its folder is checked: wage-subsidy paystubs go in a Claims or claim folder.
      if (path.length > 3 && !inClaims(path) && !claimFolder(path)) failures.push('paystub_not_in_claims');
    } else if (claimFolder(path)) {
      // Never moved out of a claim folder; only the name can be wrong.
      if (!isMedia(mimeType) && !CLAIM_NAME.test(base)) failures.push('claim_folder_name');
    } else if (!isMedia(mimeType) && !startsWithType(base)) failures.push('name_pattern');
  } else if (top === 'departments') {
    if (path.length === 1) failures.push('loose_departments_root');
    else if (path.length === 2) failures.push('loose_department_root');
    if (!isMedia(mimeType) && !INTERNAL_PATTERNS.some(re => re.test(base))) failures.push('name_pattern');
  } else if (top === 'programs') {
    if (path.length === 1) failures.push('loose_programs_root');
  } else {
    failures.push('non_standard_area');
  }
  return { excluded: null, failures };
}
