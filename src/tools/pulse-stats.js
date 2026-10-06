/**
 * pulse_stats — GetGranted usage and matching stats for Oracle (read-only)
 *
 * Per Mon–Sun week (America/Vancouver): chat users, conversations, companies
 * that ran matches, and the most-matched grants (or one requested grant) with
 * the change from the week before. Every number comes from the same functions
 * the Pulse weekly digest uses (src/services/pulse-digest.js) — same rules,
 * same staff filter — so the tool and the digest never disagree.
 *
 * Reads the gg3 ops DB through its read-only role (gg3-ops-db.js) and Oracle's
 * own gg3_grants copy for names. No writes, no model calls.
 */

import { gg3OpsQuery, isGg3OpsConfigured } from '../services/gg3-ops-db.js';
import {
  collectUsage, collectGrantMatches, collectMatchingCompanies, nameGrants, grantChange,
  weekBounds, previousWeek, isMonday, addDays
} from '../services/pulse-digest.js';

export const MAX_WEEKS = 13;
export const TOP_GRANTS = 10;
export const DATA_STARTS = '2026-08-26';
const MAX_CANDIDATES = 5;

const codeOf = (err) => err?.code ?? err?.status ?? err?.name ?? 'unknown';

async function oracleQuery(text, params) {
  const { query } = await import('../database/connection.js');
  return query(text, params);
}

const defaultDeps = {
  opsQuery: gg3OpsQuery,
  oracleQuery,
  isConfigured: isGg3OpsConfigured,
  now: () => new Date()
};

/**
 * A grant by GG3 id or part of its name, from Oracle's gg3_grants copy.
 * @returns {Promise<{grant: {id: number, name: string}}|{error: string, candidates?: Array<{id: number, name: string}>}>}
 */
export async function resolveGrant(grant, runQuery) {
  const raw = String(grant ?? '').trim();
  if (!raw) return { error: 'grant is empty.' };
  if (/^\d+$/.test(raw)) {
    const r = await runQuery('SELECT id, grant_name FROM gg3_grants WHERE id = $1', [Number(raw)]);
    const row = r.rows[0];
    return row ? { grant: { id: row.id, name: row.grant_name || `grant #${row.id}` } } : { error: `No GG3 grant with id ${raw}.` };
  }
  const pattern = `%${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const r = await runQuery(
    `SELECT id, grant_name FROM gg3_grants
      WHERE grant_name ILIKE $1
      ORDER BY (lower(grant_name) = lower($2)) DESC, grant_name
      LIMIT ${MAX_CANDIDATES + 1}`,
    [pattern, raw]
  );
  const rows = r.rows.map(x => ({ id: x.id, name: x.grant_name }));
  if (!rows.length) return { error: `No GG3 grant name contains "${raw}".` };
  const exact = rows.filter(x => String(x.name).toLowerCase() === raw.toLowerCase());
  if (exact.length === 1) return { grant: exact[0] };
  if (rows.length === 1) return { grant: rows[0] };
  return { error: `"${raw}" matches several grants — ask which one, or pass its id.`, candidates: rows.slice(0, MAX_CANDIDATES) };
}

/** A grant's change in words; "not matched either week" when both are 0. */
function changeText(companies, prior) {
  return companies === 0 && !prior ? '(not matched either week)' : grantChange(companies, prior);
}

/**
 * @param {{start_week?: string, weeks?: number, grant?: string|number}} input
 * @returns {Promise<Object>} { success: true, timezone, data_starts, grant?, weeks } or { success: false, error, candidates? }
 */
export async function runPulseStats(input = {}, context = {}, deps = defaultDeps) {
  const d = { ...defaultDeps, ...deps };
  const now = d.now();

  const weeks = input.weeks ?? 1;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) {
    return { success: false, error: `weeks must be a whole number from 1 to ${MAX_WEEKS}.` };
  }
  const start = input.start_week ?? previousWeek(now);
  if (!isMonday(start)) return { success: false, error: 'start_week must be a Monday, as YYYY-MM-DD.' };
  if (weekBounds(start).start > now) return { success: false, error: `The week of ${start} hasn't started yet.` };
  if (!d.isConfigured()) return { success: false, error: 'GetGranted stats are not available: the GetGranted ops database is not configured.' };

  try {
    let grant = null;
    if (input.grant !== undefined && input.grant !== null && String(input.grant).trim()) {
      const resolved = await resolveGrant(input.grant, d.oracleQuery);
      if (!resolved.grant) return { success: false, error: resolved.error, ...(resolved.candidates ? { candidates: resolved.candidates } : {}) };
      grant = resolved.grant;
    }

    // The week before the range too, so the first week has a comparison.
    const mondays = Array.from({ length: weeks }, (_, i) => addDays(start, 7 * i));
    const priorMatches = await collectGrantMatches(weekBounds(addDays(start, -7)), d.opsQuery);
    if (!priorMatches) return { success: false, error: 'GetGranted stats are not available right now.' };

    const raw = [];
    let before = priorMatches;
    for (const monday of mondays) {
      const bounds = weekBounds(monday);
      if (bounds.start > now) break;   // a range running into the future stops at this week
      const [usage, matching, matches] = [
        await collectUsage(bounds, d.opsQuery),
        await collectMatchingCompanies(bounds, d.opsQuery),
        await collectGrantMatches(bounds, d.opsQuery)
      ];
      if (!usage || matching === null || !matches) return { success: false, error: 'GetGranted stats are not available right now.' };
      const prior = new Map(before.map(m => [m.grantId, m.companies]));
      const picked = grant
        ? [{ grantId: grant.id, companies: matches.find(m => m.grantId === grant.id)?.companies ?? 0 }]
        : matches.slice(0, TOP_GRANTS);
      raw.push({
        monday, bounds, usage, matching,
        grants: picked.map(m => ({ ...m, priorCompanies: prior.get(m.grantId) ?? 0 }))
      });
      before = matches;
    }

    // Names in one lookup for every grant shown.
    const ids = [...new Set(raw.flatMap(w => w.grants.map(g => g.grantId)))];
    const names = new Map((await nameGrants(ids.map(grantId => ({ grantId })), d.oracleQuery)).map(g => [g.grantId, g.name]));

    return {
      success: true,
      timezone: 'America/Vancouver',
      data_starts: DATA_STARTS,
      ...(grant ? { grant } : {}),
      weeks: raw.map(w => ({
        week_start: w.monday,
        week_end: addDays(w.monday, 6),
        partial: w.bounds.end > now,
        chat_users: w.usage.chatUsers,
        conversations: w.usage.conversations,
        companies_matching: w.matching,
        grants: w.grants.map(g => ({
          grant_id: g.grantId,
          name: grant && g.grantId === grant.id ? grant.name : names.get(g.grantId),
          companies: g.companies,
          week_before: g.priorCompanies,
          change: changeText(g.companies, g.priorCompanies)
        }))
      }))
    };
  } catch (err) {
    return { success: false, error: `GetGranted stats failed (code: ${codeOf(err)}).` };
  }
}
