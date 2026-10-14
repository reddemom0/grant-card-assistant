/**
 * Control Centre: read-only access to both databases
 *
 *   app DB   GetGranted's ai-api-backend Postgres, APP_DB_READONLY_URL (read_user)
 *   ops DB   gg3-ai-service, the existing oracle_readonly pool in
 *            src/services/gg3-ops-db.js (GG3_OPS_DB_READONLY_URL), reused, not copied
 *
 * Three layers keep this read-only:
 *   1. the roles themselves can only SELECT
 *   2. every session opens with default_transaction_read_only=on
 *   3. every query runs inside BEGIN READ ONLY with SET LOCAL statement_timeout
 *
 * A URL that logs in as `postgres` is refused outright. Superuser connections
 * (including ~/.gg3-db-url) never belong here.
 *
 * Logs name the statement (queryLabel) and the error code only, never params,
 * SQL text or driver messages.
 *
 * Docs: docs/control-centre.md
 */

import pkg from 'pg';
import { queryLabel } from '../database/connection.js';
import { getGg3OpsPool, isGg3OpsConfigured } from '../services/gg3-ops-db.js';

const { Pool } = pkg;

export const CONTROL_CENTRE_TIMEOUT_MS = 10_000;
export const APP_POOL_MAX = 3;

const FORBIDDEN_USERS = new Set(['postgres']);

export class NotConfiguredError extends Error {
  constructor(db, envVar) {
    super(`${db} DB not configured (${envVar} is not set)`);
    this.name = 'NotConfiguredError';
    this.code = 'not_configured';
    this.db = db;
  }
}

let appPool = null;

export function isAppDbConfigured() {
  return Boolean(process.env.APP_DB_READONLY_URL?.trim());
}

/**
 * The app DB pool, created on first use. Throws NotConfiguredError when
 * APP_DB_READONLY_URL is unset, and refuses superuser logins.
 */
export function getAppReadPool() {
  if (!isAppDbConfigured()) throw new NotConfiguredError('app', 'APP_DB_READONLY_URL');

  if (!appPool) {
    const url = process.env.APP_DB_READONLY_URL.trim();
    let user;
    try {
      user = decodeURIComponent(new URL(url).username);
    } catch {
      throw new Error('APP_DB_READONLY_URL is not a valid URL');
    }
    if (FORBIDDEN_USERS.has(user)) {
      throw new Error('APP_DB_READONLY_URL must use a read-only role, not a superuser');
    }

    appPool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') || url.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
      max: APP_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: CONTROL_CENTRE_TIMEOUT_MS,
      query_timeout: CONTROL_CENTRE_TIMEOUT_MS,
      options: `-c default_transaction_read_only=on -c statement_timeout=${CONTROL_CENTRE_TIMEOUT_MS}`
    });

    appPool.on('error', (err) => {
      console.error(`Control Centre app DB pool error (code: ${err.code || err.name || 'unknown'})`);
    });
  }

  return appPool;
}

/**
 * Run one statement inside BEGIN READ ONLY with a 10s statement timeout.
 * Rolls back on any error; always releases the client.
 *
 * @returns {Promise<{rows: Array, rowCount: number}>}
 */
export async function runReadOnly(pool, text, params = [], label = 'control-centre') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${CONTROL_CENTRE_TIMEOUT_MS}`);
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return { rows: res.rows, rowCount: res.rowCount };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
    console.error(`Control Centre ${label} query error: ${queryLabel(text)} (code: ${error.code || error.name || 'unknown'})`);
    throw error;
  } finally {
    client.release();
  }
}

/** Read from the app DB (ai-api-backend). */
export async function appQuery(text, params = []) {
  return runReadOnly(getAppReadPool(), text, params, 'app DB');
}

/** Read from the ops DB (gg3-ai-service), through the oracle_readonly pool. */
export async function opsQuery(text, params = []) {
  if (!isGg3OpsConfigured()) throw new NotConfiguredError('ops', 'GG3_OPS_DB_READONLY_URL');
  return runReadOnly(getGg3OpsPool(), text, params, 'ops DB');
}

/** Test-only: close and forget the app pool. */
export async function _resetForTests() {
  if (appPool) {
    try { await appPool.end(); } catch { /* ignore */ }
  }
  appPool = null;
}
