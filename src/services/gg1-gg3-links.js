/**
 * GG1 ↔ GG3 links by exact normalized name (migration 039)
 *
 * GG1 (`grants`, keyed on grant_id) and GG3 (`gg3_grants`, keyed on id) share
 * no ids, so a GG1 grant is linked to a GG3 grant only when exactly one record
 * on each side has the same match key. Everything else goes to
 * gg1_gg3_unmatched for humans. Rebuilt after every successful GG3 refresh.
 *
 * Normalization is the rule the July–September reconciliations used
 * (gg3-ai-service gg1-gg3-reconciliation.md): NFKD accent strip, lowercase,
 * [bracketed] segments dropped, non-alphanumerics collapsed to single spaces,
 * trimmed. Parentheses are kept, so "(SWPP)" still matches "(SWPP)".
 *
 * Stream guard: the match key also carries every stream / component / phase
 * number found in the name BEFORE brackets are dropped, so "X [Stream 1]" and
 * "X [Stream 2]" — equal once normalized — never link, and neither does "X"
 * with "X - Stream 1". No fuzzy matching of any kind.
 */

import { query, transaction } from '../database/connection.js';

const INSERT_CHUNK = 500;

function fold(name) {
  return (name ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The reconciliation rule. "" for a missing or all-bracket name. */
export function normalizeGrantName(name) {
  return fold(name)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STREAM_PATTERN = /\b(substream|stream|component|phase|volet|tranche) ([0-9]+[a-z]?|[ivx]{1,4}|[a-z])\b/g;

/** Every "stream 1", "component b", "phase ii"… in the name, brackets included, sorted. */
export function streamTags(name) {
  const flat = fold(name).replace(/[^a-z0-9]+/g, ' ');
  const tags = new Set();
  for (const m of flat.matchAll(STREAM_PATTERN)) tags.add(`${m[1]} ${m[2]}`);
  return [...tags].sort();
}

export function matchKey(name) {
  const normalized = normalizeGrantName(name);
  if (!normalized) return null;
  return `${normalized}#${streamTags(name).join(',')}`;
}

function dedupeById(rows) {
  const byId = new Map();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()];
}

/**
 * Pure. Rows are { id, name, status } on each side.
 * @returns {{links: Array<{gg1_id, gg3_id, normalized_name}>, unmatched: Array<{side, grant_id, name, status, normalized_name, reason}>}}
 */
export function buildLinks(gg1Rows, gg3Rows) {
  const groups = new Map();
  const unmatched = [];
  const add = (side, row) => {
    const key = matchKey(row.name);
    if (!key) {
      unmatched.push(unmatchedRow(side, row, 'no_counterpart'));
      return;
    }
    if (!groups.has(key)) groups.set(key, { gg1: [], gg3: [] });
    groups.get(key)[side].push(row);
  };
  dedupeById(gg1Rows).forEach(row => add('gg1', row));
  dedupeById(gg3Rows).forEach(row => add('gg3', row));

  const links = [];
  for (const { gg1, gg3 } of groups.values()) {
    if (gg1.length === 1 && gg3.length === 1) {
      links.push({ gg1_id: String(gg1[0].id), gg3_id: Number(gg3[0].id), normalized_name: normalizeGrantName(gg1[0].name) });
      continue;
    }
    const reason = gg1.length > 0 && gg3.length > 0 ? 'ambiguous' : 'no_counterpart';
    gg1.forEach(row => unmatched.push(unmatchedRow('gg1', row, reason)));
    gg3.forEach(row => unmatched.push(unmatchedRow('gg3', row, reason)));
  }
  return { links, unmatched };
}

function unmatchedRow(side, row, reason) {
  return {
    side,
    grant_id: String(row.id),
    name: row.name ?? null,
    status: row.status ?? null,
    normalized_name: normalizeGrantName(row.name) || null,
    reason
  };
}

async function insertChunks(client, sql, rows) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await client.query(sql, [JSON.stringify(rows.slice(i, i + INSERT_CHUNK))]);
  }
}

/**
 * Read both copies, rebuild, and replace both tables in one transaction.
 * @returns {Promise<{linked: number, ambiguous: number, gg1_only: number, gg3_only: number}>}
 */
export async function rebuildGg1Gg3Links() {
  const gg1 = await query('SELECT grant_id, grant_name, is_active FROM grants');
  const gg3 = await query('SELECT id, grant_name, status FROM gg3_grants');

  const { links, unmatched } = buildLinks(
    gg1.rows.map(r => ({
      id: r.grant_id,
      name: r.grant_name,
      status: r.is_active === true ? 'active' : r.is_active === false ? 'inactive' : null
    })),
    gg3.rows.map(r => ({ id: r.id, name: r.grant_name, status: r.status }))
  );

  await transaction(async (client) => {
    await client.query('DELETE FROM gg1_gg3_links');
    await client.query('DELETE FROM gg1_gg3_unmatched');
    await insertChunks(client, `INSERT INTO gg1_gg3_links (gg1_id, gg3_id, normalized_name)
      SELECT gg1_id, gg3_id, normalized_name
        FROM jsonb_to_recordset($1::jsonb) AS l(gg1_id TEXT, gg3_id INTEGER, normalized_name TEXT)`, links);
    await insertChunks(client, `INSERT INTO gg1_gg3_unmatched (side, grant_id, name, status, normalized_name, reason)
      SELECT side, grant_id, name, status, normalized_name, reason
        FROM jsonb_to_recordset($1::jsonb) AS u(side TEXT, grant_id TEXT, name TEXT, status TEXT, normalized_name TEXT, reason TEXT)`, unmatched);
  }, 'gg1 gg3 links rebuild');

  const counts = {
    linked: links.length,
    ambiguous: unmatched.filter(u => u.reason === 'ambiguous').length,
    gg1_only: unmatched.filter(u => u.reason === 'no_counterpart' && u.side === 'gg1').length,
    gg3_only: unmatched.filter(u => u.reason === 'no_counterpart' && u.side === 'gg3').length
  };
  console.log(`🔗 GG1↔GG3 links — ${counts.linked} linked, ${counts.ambiguous} ambiguous, ${counts.gg1_only} GG1-only, ${counts.gg3_only} GG3-only`);
  return counts;
}
