/**
 * Control Centre Grants API — mounted at /api/control-centre/grants
 *
 * Every signed-in staff member has full access (no admin check); server.js
 * mounts this behind authenticateUser + requireAuth.
 *
 *   GET /?range=day|week|month|year&view=all|most_ignored|not_matching
 *                          every live grant with its counts for the range —
 *                          client-only and with internal accounts (window cached 5 min)
 *   GET /:id?range=        one grant's page: companies matched by goal track,
 *                          tags vs card text, engagement trend, edits, review cards
 *
 * "Why matched?" reuses GET /api/control-centre/companies/:id/why and "Flag"
 * reuses POST /api/control-centre/review/flag. Bad input → 400, not live → 404,
 * a database not configured → 503. Logic: grants.js. Docs: docs/control-centre.md.
 */

import express from 'express';
import * as grants from './grants.js';

function sendError(res, error, label) {
  if (error instanceof grants.GrantsError || error instanceof grants.OverviewError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error?.code === 'not_configured' || error?.name === 'NotConfiguredError') return res.status(503).json({ error: 'not_configured' });
  if (error?.code === '42P01') return res.status(503).json({ error: 'migration_missing' });
  console.error(`Control Centre grants ${label} failed (code: ${error?.code || error?.name || 'unknown'})`);
  return res.status(500).json({ error: `${label} error` });
}

const str = (v, fallback) => (typeof v === 'string' && v ? v : fallback);

/** The router; `overrides` replaces grants.js functions (tests). */
export function createGrantsRouter(overrides = {}) {
  const f = { ...grants, ...overrides };
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.grantList(str(req.query.range, 'week'), str(req.query.view, 'all')));
    } catch (error) {
      sendError(res, error, 'list');
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.grantPage(req.params.id, str(req.query.range, 'week')));
    } catch (error) {
      sendError(res, error, 'page');
    }
  });

  return router;
}

export default createGrantsRouter();
