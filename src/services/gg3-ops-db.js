/**
 * Read-only connection to the gg3-ai-service ops database (GetGranted Pulse)
 *
 * A separate, small pool — never the app's own pool in src/database/connection.js.
 * It logs in as oracle_readonly (scripts/sql/gg3-readonly-role.sql), which can
 * SELECT from six tables and nothing else. On top of that, every session this
 * pool opens is forced read-only with a 15s statement timeout, so a lost role
 * setting still can't turn it into a writer.
 *
 *   GG3_OPS_DB_READONLY_URL   postgresql://oracle_readonly:…@host:port/db
 *   GG3_INTERNAL_USER_IDS     comma-separated Clerk user ids of GetGranted staff
 *
 * Missing URL is not an error: gg3OpsQuery returns { configured: false } and
 * one warning is logged per process. Oracle never crashes over this.
 *
 * conversations holds client message text. Logs here name the statement and
 * the error code only, like query() in connection.js — never params or text.
 *
 * Runbook: docs/runbooks/gg3-readonly-access.md
 */

import pkg from 'pg';
import { queryLabel } from '../database/connection.js';

const { Pool } = pkg;

export const GG3_OPS_TIMEOUT_MS = 15_000;
export const GG3_OPS_POOL_MAX = 2;

const NOT_CONFIGURED_REASON = 'GG3_OPS_DB_READONLY_URL is not set';

let pool = null;
let warnedNotConfigured = false;
let warnedNoInternalUsers = false;

export function isGg3OpsConfigured() {
  return Boolean(process.env.GG3_OPS_DB_READONLY_URL?.trim());
}

/**
 * The pool, created on first use. null when not configured (warns once).
 * Exported for the check script's transaction probe; normal callers use
 * gg3OpsQuery.
 */
export function getGg3OpsPool() {
  if (!isGg3OpsConfigured()) {
    if (!warnedNotConfigured) {
      warnedNotConfigured = true;
      console.warn(`⚠️  GG3 ops DB not configured (${NOT_CONFIGURED_REASON}); Pulse reads are off.`);
    }
    return null;
  }

  if (!pool) {
    const url = process.env.GG3_OPS_DB_READONLY_URL.trim();
    pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') || url.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
      max: GG3_OPS_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: GG3_OPS_TIMEOUT_MS,
      query_timeout: GG3_OPS_TIMEOUT_MS,
      // Server-side, per session: read-only by default and the same timeout,
      // independent of what the role itself carries.
      options: `-c default_transaction_read_only=on -c statement_timeout=${GG3_OPS_TIMEOUT_MS}`
    });

    pool.on('error', (err) => {
      console.error(`GG3 ops DB pool error (code: ${err.code || err.name || 'unknown'})`);
    });
  }

  return pool;
}

/**
 * Run a read query against the gg3-ai-service ops DB.
 *
 * @returns {Promise<{configured: false, reason: string} | {configured: true, rows: Array, rowCount: number}>}
 *   Throws only for real query errors (timeout, refused write, bad SQL).
 */
export async function gg3OpsQuery(text, params = []) {
  const p = getGg3OpsPool();
  if (!p) return { configured: false, reason: NOT_CONFIGURED_REASON };

  try {
    const res = await p.query(text, params);
    return { configured: true, rows: res.rows, rowCount: res.rowCount };
  } catch (error) {
    console.error(`GG3 ops DB query error: ${queryLabel(text)} (code: ${error.code || error.name || 'unknown'})`);
    throw error;
  }
}

/**
 * Clerk user ids of GetGranted staff, from GG3_INTERNAL_USER_IDS.
 * Trimmed, de-duplicated, blanks dropped. Empty is allowed (warns once).
 */
export function getInternalUserIds() {
  const ids = [...new Set(
    (process.env.GG3_INTERNAL_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )];

  if (ids.length === 0 && !warnedNoInternalUsers) {
    warnedNoInternalUsers = true;
    console.warn('⚠️  GG3_INTERNAL_USER_IDS is empty; Pulse counts will include GetGranted staff.');
  }

  return ids;
}

const COLUMN_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/**
 * A WHERE fragment that drops internal users, with the ids as ONE bound
 * parameter — they never enter the SQL text.
 *
 *   const ex = excludeInternalUsers('user_id', 2);
 *   gg3OpsQuery(`SELECT … WHERE occurred_at > $1 AND ${ex.clause}`, [since, ...ex.params]);
 *
 * @param {string} column - column holding the Clerk user id (e.g. "user_id", "ct.user_id")
 * @param {number} paramIndex - the $n this fragment's parameter will take
 * @returns {{clause: string, params: Array}} clause is "TRUE" when the list is empty
 */
export function excludeInternalUsers(column, paramIndex) {
  if (typeof column !== 'string' || !COLUMN_RE.test(column)) {
    throw new Error('excludeInternalUsers: column must be a plain identifier');
  }
  if (!Number.isInteger(paramIndex) || paramIndex < 1) {
    throw new Error('excludeInternalUsers: paramIndex must be a positive integer');
  }

  const ids = getInternalUserIds();
  if (ids.length === 0) return { clause: 'TRUE', params: [] };

  // IS DISTINCT FROM-style: rows with a NULL user id are kept, not dropped.
  return {
    clause: `(${column} IS NULL OR NOT (${column} = ANY($${paramIndex}::text[])))`,
    params: [ids]
  };
}

/** Test-only: close and forget the pool, reset one-time warnings. */
export async function _resetGg3OpsForTests() {
  if (pool) {
    try { await pool.end(); } catch { /* ignore */ }
  }
  pool = null;
  warnedNotConfigured = false;
  warnedNoInternalUsers = false;
}
