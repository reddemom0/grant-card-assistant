/**
 * Granted Files RAG — area, client, program and year from a folder path
 *
 * Tags every file and chunk so answers can filter by client or program and flag
 * Old Files as historical. Paths follow the filing skill's layout
 * (Clients/{Client}/{Program}/{YYYY}/…, Programs/{Program}/…, Departments/{DEPT}/…);
 * Old Files keeps the same shape one level down (Old Files/Clients/{Client}/…).
 */

import { folderKey } from '../../tools/google-drive.js';
import { programKeys } from '../filing-rules.js';

const AREAS = { clients: 'Clients', programs: 'Programs', departments: 'Departments', oldfiles: 'Old Files' };

// A year folder ("2024") or a segment that starts with one ("2024 Q3", "2024-25").
const YEAR = /^(19[5-9]\d|20\d\d)(?!\d)/;

/**
 * @param {string[]} path - folder names below the Granted Files root (no file name)
 * @param {{programSet?: Set<string>}} [opts]
 * @returns {{area: string, client: string|null, program: string|null, year: number|null}}
 */
export function pathMeta(path = [], { programSet = programKeys() } = {}) {
  const keys = path.map(folderKey);
  const area = AREAS[keys[0]] || 'Other';

  // Old Files/Clients/… and Old Files/Programs/… read like their live counterparts.
  const offset = area === 'Old Files' && (keys[1] === 'clients' || keys[1] === 'programs') ? 1 : 0;
  const shape = keys[offset];

  let client = null;
  let program = null;
  if (shape === 'clients') {
    client = path[offset + 1]?.trim() || null;
    const candidate = path[offset + 2];
    if (candidate && programSet.has(folderKey(candidate))) program = candidate.trim();
  } else if (shape === 'programs') {
    program = path[offset + 1]?.trim() || null;
  }

  let year = null;
  for (let i = path.length - 1; i >= 1; i--) {
    if (shape === 'clients' && i === offset + 1) continue;  // "2020 Logistics Inc" is a client, not a year
    const m = YEAR.exec(String(path[i]).trim());
    if (m) { year = Number(m[1]); break; }
  }

  return { area, client, program, year };
}
