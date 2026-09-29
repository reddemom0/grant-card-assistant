/**
 * Oracle's copy of GG3 grant data (migration 038)
 *
 *   hourly :41 UTC   pull every GG3 grant from ai-api-backend search-context
 *                    and replace gg3_grants in one transaction
 *   startup + 60s    one pull, so a deploy doesn't wait up to an hour
 *   on demand        GET /api/admin/gg3-refresh (session + ?secret=)
 *
 * Guard: the old copy stays when the call errors, returns 0 rows, or returns
 * fewer than 80% of the last successful run's rows. A pull at the 700-row limit
 * still replaces the copy but is recorded capped=true with a loud warning —
 * search-context has no pagination, so grants past 700 are being cut off.
 * Every run, whatever its outcome, is one row in gg3_refresh_runs; the latest
 * success is the copy's "data as of" time.
 *
 * Needs AI_API_BACKEND_URL and AI_API_BACKEND_TOKEN (the names gg3-ai-service
 * uses for the same backend). The token is sent as X-AI-Service-Token and is
 * never logged or stored. Switch off with GG3_REFRESH_DISABLED=true. Assumes
 * one instance, like the other cron jobs in server.js.
 */

import { query, transaction } from '../database/connection.js';

export const SEARCH_CONTEXT_LIMIT = 700;
export const MIN_RATIO = 0.8;
const FETCH_TIMEOUT_MS = 60_000;
const INSERT_CHUNK = 100;
const STARTUP_DELAY_MS = 60_000;

const GRANT_COLUMNS = [
  ['id', 'INTEGER'],
  ['grant_name', 'TEXT'],
  ['grant_type', 'TEXT'],
  ['program_provider', 'TEXT'],
  ['regions', 'JSONB'],
  ['industries', 'JSONB'],
  ['genre_scores', 'JSONB'],
  ['grant_criteria', 'TEXT'],
  ['grant_amount', 'TEXT'],
  ['contribution_percentage', 'TEXT'],
  ['deadline', 'TEXT'],
  ['best_practices', 'TEXT'],
  ['status', 'TEXT'],
  ['last_updated', 'TEXT'],
  ['boost_attributes', 'JSONB'],
  ['eligibility_criteria', 'JSONB'],
  ['field_content', 'JSONB']
];

const COLUMN_LIST = GRANT_COLUMNS.map(([name]) => name).join(', ');
const RECORD_TYPE = GRANT_COLUMNS.map(([name, type]) => `${name} ${type}`).join(', ');
const INSERT_SQL = `INSERT INTO gg3_grants (${COLUMN_LIST})
  SELECT ${COLUMN_LIST} FROM jsonb_to_recordset($1::jsonb) AS g(${RECORD_TYPE})`;

let inFlight = false;

function config(env) {
  const url = env.AI_API_BACKEND_URL?.trim().replace(/\/+$/, '');
  const token = env.AI_API_BACKEND_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

/**
 * Every GG3 grant, all statuses. Throws on a non-2xx or a malformed body; the
 * error never carries the token or the response body.
 */
export async function fetchSearchContext({ url, token, fetchImpl = fetch }) {
  const res = await fetchImpl(`${url}/api/v1/ai/grants/search-context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AI-Service-Token': token },
    body: JSON.stringify({ filters: { active_only: false }, limit: SEARCH_CONTEXT_LIMIT }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`search-context HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body?.grants)) throw new Error('search-context response has no grants array');
  return body.grants;
}

/**
 * The guard. Pure: decides from counts alone whether a pull may replace the copy.
 * @param {{count: number, previousCount: number|null}} counts
 * @returns {{ok: boolean, capped: boolean, reason: string|null}}
 */
export function decideRefresh({ count, previousCount }) {
  const capped = count >= SEARCH_CONTEXT_LIMIT;
  if (count === 0) return { ok: false, capped, reason: '0 rows returned' };
  if (previousCount && count < MIN_RATIO * previousCount) {
    return {
      ok: false,
      capped,
      reason: `${count} rows is below ${MIN_RATIO * 100}% of the last successful run (${previousCount})`
    };
  }
  return { ok: true, capped, reason: null };
}

async function lastSuccessCount() {
  const { rows } = await query(
    `SELECT row_count FROM gg3_refresh_runs
      WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1`
  );
  return rows[0]?.row_count ?? null;
}

async function replaceCopy(grants) {
  const rows = grants.map(g => Object.fromEntries(GRANT_COLUMNS.map(([name]) => [name, g[name] ?? null])));
  await transaction(async (client) => {
    await client.query('DELETE FROM gg3_grants');
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await client.query(INSERT_SQL, [JSON.stringify(rows.slice(i, i + INSERT_CHUNK))]);
    }
  }, 'gg3 refresh replace');
}

function describeError(err) {
  if (err?.name === 'TimeoutError') return `search-context timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
  const text = err?.message ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, 300);
}

async function finish(run) {
  const result = {
    status: run.status,
    row_count: run.row_count ?? null,
    previous_count: run.previous_count ?? null,
    capped: run.capped ?? false,
    error: run.error ?? null
  };
  await query(
    `INSERT INTO gg3_refresh_runs
       (started_at, finished_at, row_count, previous_count, status, capped, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [run.startedAt, run.finishedAt, result.row_count, result.previous_count, result.status, result.capped, result.error]
  );
  if (result.status === 'success') {
    console.log(`✅ GG3 refresh — ${result.row_count} grants copied${result.capped ? ' (CAPPED)' : ''}`);
  } else if (result.status === 'failed') {
    console.error(`❌ GG3 refresh failed — ${result.error}. Previous copy kept.`);
  } else {
    console.log(`⏭️  GG3 refresh skipped — ${result.error}`);
  }
  return result;
}

/**
 * One refresh. env, fetch and the clock are injectable for tests.
 * @returns {Promise<{status: string, row_count: number|null, previous_count: number|null, capped: boolean, error: string|null}>}
 */
export async function runGg3Refresh({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  const startedAt = now();
  const done = (run) => finish({ startedAt, finishedAt: now(), ...run });

  const cfg = config(env);
  if (!cfg) return done({ status: 'skipped', error: 'AI_API_BACKEND_URL / AI_API_BACKEND_TOKEN not set' });
  if (inFlight) return done({ status: 'skipped', error: 'a refresh is already running' });

  inFlight = true;
  try {
    const previous_count = await lastSuccessCount();

    let grants;
    try {
      grants = await fetchSearchContext({ ...cfg, fetchImpl });
    } catch (err) {
      return done({ status: 'failed', previous_count, error: describeError(err) });
    }

    const row_count = grants.length;
    const decision = decideRefresh({ count: row_count, previousCount: previous_count });
    if (!decision.ok) {
      return done({ status: 'failed', row_count, previous_count, capped: decision.capped, error: decision.reason });
    }

    try {
      await replaceCopy(grants);
    } catch (err) {
      return done({
        status: 'failed', row_count, previous_count, capped: decision.capped,
        error: `database replace failed — code: ${err?.code ?? err?.name ?? 'unknown'}`
      });
    }

    if (decision.capped) {
      console.error(`🚨 GG3 refresh CAPPED at ${SEARCH_CONTEXT_LIMIT} rows — grants are being cut off. search-context has no pagination; ask for it or a higher limit.`);
    }
    return done({ status: 'success', row_count, previous_count, capped: decision.capped });
  } finally {
    inFlight = false;
  }
}

function guarded(label, fn) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`❌ GG3 refresh ${label} failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
    }
  };
}

/** @param {Object} cron - node-cron */
export function startGg3Refresh(cron) {
  if (process.env.GG3_REFRESH_DISABLED === 'true') {
    console.log('⏸️  GG3 refresh DISABLED (GG3_REFRESH_DISABLED=true)');
    return false;
  }
  if (!config(process.env)) {
    console.warn('⚠️  GG3 refresh NOT configured — AI_API_BACKEND_URL / AI_API_BACKEND_TOKEN not set. No hourly copy.');
    return false;
  }
  const run = guarded('run', () => runGg3Refresh());
  cron.schedule('41 * * * *', run, { name: 'gg3-refresh', timezone: 'UTC', noOverlap: true });
  setTimeout(run, STARTUP_DELAY_MS).unref();
  console.log('⏰ Cron job scheduled: GG3 refresh hourly (:41 UTC), first run 60s after startup');
  return true;
}

/**
 * Manual trigger. Behind authenticateUser + requireAuth in server.js, plus the
 * same ?secret= check as /run-migration.
 */
export async function gg3RefreshEndpoint(req, res) {
  const secret = process.env.MIGRATION_SECRET || process.env.JWT_SECRET;
  if (!secret || req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    res.json(await runGg3Refresh());
  } catch (err) {
    console.error(`❌ GG3 refresh (manual) failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
    res.status(500).json({ error: 'GG3 refresh failed', code: err?.code ?? err?.name ?? 'unknown' });
  }
}
