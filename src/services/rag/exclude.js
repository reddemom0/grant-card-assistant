/**
 * Granted Files RAG — what is never indexed, and what can't be
 *
 * Exclusions (decision 3, 22 Oct 2026) come from names and folders only, never
 * content: Departments/HR, FINANCE and Mindfulness (the filing sweep's
 * EXCLUDED_DEPARTMENTS), and any file whose name or any folder on its path
 * matches the sensitive list (matchSensitive, src/tools/drive-sensitive.js).
 * Unlike the filing sweep, Old Files, Active Clients and Review ARE indexed.
 * Departments/LEADERSHIP (Limited access since 30 Oct 2026) and the top-level
 * Pre-Call Briefings folder are excluded here only; the filing sweep's lists
 * are unchanged.
 */

import { folderKey } from '../../tools/google-drive.js';
import { matchSensitive } from '../../tools/drive-sensitive.js';
import { EXCLUDED_DEPARTMENTS } from '../filing-rules.js';

const RAG_EXCLUDED_DEPARTMENTS = new Set([...EXCLUDED_DEPARTMENTS, folderKey('LEADERSHIP')]);
const RAG_EXCLUDED_TOP = new Set([folderKey('Pre-Call Briefings')]);

/**
 * Why a file must not be indexed, or null.
 * @param {{path?: string[], name?: string}} file - path = folder names below the Granted Files root
 * @returns {string|null} 'area:Departments/HR' | 'area:Pre-Call Briefings' | 'sensitive_name' | 'sensitive_path' | null
 */
export function exclusionReason({ path = [], name = '' }) {
  const keys = path.map(folderKey);
  if (keys[0] && RAG_EXCLUDED_TOP.has(keys[0])) return `area:${path[0]}`;
  if (keys[0] === 'departments' && keys[1] && RAG_EXCLUDED_DEPARTMENTS.has(keys[1])) return `area:Departments/${path[1]}`;
  if (matchSensitive(name)) return 'sensitive_name';
  if (path.some(part => matchSensitive(part))) return 'sensitive_path';
  return null;
}
