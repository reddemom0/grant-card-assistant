/**
 * Control Centre Coverage & changes API — mounted at /api/control-centre/coverage
 *
 * Every signed-in staff member has full access (no admin check); server.js
 * mounts this behind authenticateUser + requireAuth.
 *
 *   GET /?range=day|week|month|year
 *                          coverage: main industries with their specific
 *                          industries, province / goal track / grant type /
 *                          grant vs loan breakdowns — client-only and with
 *                          internal accounts (cached 5 min)
 *   GET /changes?range=    what changed in the catalogue: went live, closed,
 *                          removed, edited, deadlines passed and due soon
 *
 * Bad input → 400, a database not configured → 503. Logic: coverage.js.
 * Docs: docs/control-centre.md.
 */

import express from 'express';
import * as coverage from './coverage.js';

function sendError(res, error, label) {
  if (error instanceof coverage.CoverageError || error instanceof coverage.OverviewError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error?.code === 'not_configured' || error?.name === 'NotConfiguredError') return res.status(503).json({ error: 'not_configured' });
  if (error?.code === '42P01') return res.status(503).json({ error: 'migration_missing' });
  console.error(`Control Centre coverage ${label} failed (code: ${error?.code || error?.name || 'unknown'})`);
  return res.status(500).json({ error: `${label} error` });
}

const str = (v, fallback) => (typeof v === 'string' && v ? v : fallback);

/** The router; `overrides` replaces coverage.js functions (tests). */
export function createCoverageRouter(overrides = {}) {
  const f = { ...coverage, ...overrides };
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.coverage(str(req.query.range, 'week')));
    } catch (error) {
      sendError(res, error, 'coverage');
    }
  });

  router.get('/changes', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.changes(str(req.query.range, 'week')));
    } catch (error) {
      sendError(res, error, 'changes');
    }
  });

  return router;
}

export default createCoverageRouter();
