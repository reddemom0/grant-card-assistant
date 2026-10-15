/**
 * Control Centre identity: Clerk user id → app user_id → company_id
 *
 * The ops DB (chat_turns, events, …) knows people only by Clerk id
 * ("user_…"). The app DB maps that through users_clerk.clerk_id → user_id,
 * then company_users.user_id → company_id. Soft-deleted rows on either side
 * are ignored.
 *
 * company_id is the membership marked primary, else the only membership, else
 * null (several and none primary, or none at all). company_ids lists them all.
 */

import { appQuery } from './db.js';
import { isInternalCompany, INTERNAL_COMPANY_IDS } from './internal-accounts.js';

const IDENTITY_SQL = `
  SELECT uc.clerk_id, uc.user_id, cu.company_id, cu."primary" AS is_primary
    FROM users_clerk uc
    LEFT JOIN company_users cu
      ON cu.user_id = uc.user_id AND cu.deleted_at IS NULL
   WHERE uc.deleted_at IS NULL
     AND uc.clerk_id = ANY($1::text[])
   ORDER BY uc.clerk_id, cu.company_id`;

/** Pure: rows from IDENTITY_SQL → Map<clerk_id, {user_id, company_id, company_ids}>. */
export function shapeIdentities(rows) {
  const byClerk = new Map();
  for (const row of rows) {
    let entry = byClerk.get(row.clerk_id);
    if (!entry) {
      entry = { user_id: row.user_id, company_ids: [], primary_ids: [] };
      byClerk.set(row.clerk_id, entry);
    }
    if (row.company_id != null && !entry.company_ids.includes(row.company_id)) {
      entry.company_ids.push(row.company_id);
      if (row.is_primary) entry.primary_ids.push(row.company_id);
    }
  }

  const out = new Map();
  for (const [clerkId, { user_id, company_ids, primary_ids }] of byClerk) {
    let company_id = null;
    if (primary_ids.length === 1) company_id = primary_ids[0];
    else if (company_ids.length === 1) company_id = company_ids[0];
    out.set(clerkId, { user_id, company_id, company_ids });
  }
  return out;
}

/**
 * Resolve Clerk ids to app identities in one query. Unknown ids are absent
 * from the Map. Pass a one-element array for a single chat.
 *
 * @param {string[]} clerkIds
 * @returns {Promise<Map<string, {user_id: number, company_id: number|null, company_ids: number[]}>>}
 */
export async function identitiesForClerkIds(clerkIds, { query = appQuery } = {}) {
  const ids = [...new Set((clerkIds || []).filter((id) => typeof id === 'string' && id))];
  if (ids.length === 0) return new Map();
  const { rows } = await query(IDENTITY_SQL, [ids]);
  return shapeIdentities(rows);
}

// Names only, so soft-deleted companies are kept: an old flag still needs a name.
const COMPANY_NAMES_SQL = `
  SELECT id, name FROM companies WHERE id = ANY($1::int[])`;

/**
 * Company names for display. The app users table holds no names or emails,
 * so a client is shown by their company. Unknown ids are absent from the Map.
 *
 * @param {number[]} companyIds
 * @returns {Promise<Map<number, string>>}
 */
export async function companyNamesForIds(companyIds, { query = appQuery } = {}) {
  const ids = [...new Set((companyIds || []).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Map();
  const { rows } = await query(COMPANY_NAMES_SQL, [ids]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Rows that carry a company_id, each given `company_name` (null when the
 * company has no row or no id) and `company_internal` (true for a confirmed
 * internal account, internal-accounts.js — shown as an "Internal" tag).
 * Anything shown to staff names the company first and keeps the id second.
 * One batched query.
 *
 * @template {{company_id?: number|null}} T
 * @param {T[]} rows
 * @returns {Promise<Array<T & {company_name: string|null, company_internal: boolean}>>}
 */
export async function withCompanyNames(rows, { query = appQuery } = {}) {
  const names = await companyNamesForIds((rows || []).map((r) => r?.company_id), { query });
  return (rows || []).map((r) => ({
    ...r,
    company_name: r?.company_id != null ? names.get(r.company_id) ?? null : null,
    company_internal: isInternalCompany(r?.company_id)
  }));
}

// ---------------------------------------------------------------------------
// Internal accounts as Clerk ids — the one staff source for Pulse
// ---------------------------------------------------------------------------

/**
 * Clerk users of the internal accounts (internal-accounts.js), through company
 * users. Soft-deleted rows on either side are ignored. This is the one staff
 * source: Pulse (roundup, digest) and the Control Centre classify the same
 * people as internal. GG3_INTERNAL_USER_IDS is retired.
 */
export const INTERNAL_CLERKS_SQL = `
  SELECT DISTINCT uc.clerk_id
    FROM company_users cu
    JOIN users_clerk uc ON uc.user_id = cu.user_id AND uc.deleted_at IS NULL
   WHERE cu.deleted_at IS NULL
     AND uc.clerk_id LIKE 'user\\_%'
     AND cu.company_id = ANY($1::int[])`;

export const INTERNAL_CLERKS_TTL_MS = 60 * 60 * 1000;
const internalClerksCache = { at: 0, ids: null };

/**
 * @returns {Promise<Set<string>>} Clerk ids of internal-account users, cached
 *   INTERNAL_CLERKS_TTL_MS. Throws when the app DB can't be read and nothing is
 *   cached yet — callers decide what that means for them.
 */
export async function internalClerkIds({ query = appQuery, now = () => Date.now(), companyIds = INTERNAL_COMPANY_IDS } = {}) {
  if (internalClerksCache.ids && now() - internalClerksCache.at < INTERNAL_CLERKS_TTL_MS) return internalClerksCache.ids;
  try {
    const { rows } = await query(INTERNAL_CLERKS_SQL, [[...companyIds]]);
    internalClerksCache.ids = new Set(rows.map((r) => r.clerk_id));
    internalClerksCache.at = now();
  } catch (err) {
    if (!internalClerksCache.ids) throw err;
    // A stale list beats none: keep using it until the app DB answers again.
  }
  return internalClerksCache.ids;
}

/** Test-only. */
export function _resetInternalClerksForTests() { internalClerksCache.at = 0; internalClerksCache.ids = null; }
