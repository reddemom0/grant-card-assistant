/**
 * Granted Files RAG — what is never indexed, and what can't be
 *
 * Exclusions (decision 3, 22 Oct 2026) come from names and folders only, never
 * content: Departments/HR, FINANCE and Mindfulness (the filing sweep's
 * EXCLUDED_DEPARTMENTS), and any file whose name or any folder on its path
 * matches the sensitive list (matchSensitive, src/tools/drive-sensitive.js).
 * Unlike the filing sweep, Old Files, Active Clients and Review ARE indexed.
 */

import { folderKey } from '../../tools/google-drive.js';
import { matchSensitive } from '../../tools/drive-sensitive.js';
import { EXCLUDED_DEPARTMENTS } from '../filing-rules.js';

/**
 * Why a file must not be indexed, or null.
 * @param {{path?: string[], name?: string}} file - path = folder names below the Granted Files root
 * @returns {string|null} 'area:Departments/HR' | 'sensitive_name' | 'sensitive_path' | null
 */
export function exclusionReason({ path = [], name = '' }) {
  const keys = path.map(folderKey);
  if (keys[0] === 'departments' && keys[1] && EXCLUDED_DEPARTMENTS.has(keys[1])) return `area:Departments/${path[1]}`;
  if (matchSensitive(name)) return 'sensitive_name';
  if (path.some(part => matchSensitive(part))) return 'sensitive_path';
  return null;
}
