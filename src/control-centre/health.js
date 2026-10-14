/**
 * Control Centre health: can the Hub read both databases right now?
 *
 * GET /api/control-centre/health (admin only). Runs SELECT 1 + now() on each
 * DB through the read-only path in db.js. The response carries ok, server
 * time, latency, or an error code — never a URL, host, role or driver message.
 */

import { appQuery, opsQuery } from './db.js';

const PROBE_SQL = 'SELECT 1 AS ok, now() AS server_time';

async function probe(queryFn) {
  const started = Date.now();
  try {
    const { rows } = await queryFn(PROBE_SQL);
    return { ok: rows[0]?.ok === 1, server_time: rows[0]?.server_time ?? null, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: String(error.code || error.name || 'unknown') };
  }
}

/** @returns {Promise<{app: object, ops: object, checked_at: string}>} */
export async function checkDatabases({ app = appQuery, ops = opsQuery } = {}) {
  const [appResult, opsResult] = await Promise.all([probe(app), probe(ops)]);
  return { app: appResult, ops: opsResult, checked_at: new Date().toISOString() };
}

export async function controlCentreHealthEndpoint(req, res) {
  const result = await checkDatabases();
  res.status(result.app.ok && result.ops.ok ? 200 : 503).json(result);
}
