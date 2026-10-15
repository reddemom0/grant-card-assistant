/**
 * Control Centre page API — mounted at /api/control-centre
 *
 * Every signed-in staff member has full access (no admin check). server.js
 * mounts this behind authenticateUser + requireAuth.
 *
 *   GET /overview?range=day|week|month|year   Overview payload (overview.js), cached 5 min
 *   GET /search?q=                            companies (name or id) + live grants (title or root id)
 *
 * Bad range → 400; a database env var unset → 503 not_configured. Read-only.
 * Docs: docs/control-centre.md.
 */

import express from 'express';
import { OverviewError, DEFAULT_RANGE, getOverview, search } from './overview.js';

const router = express.Router();

function sendError(res, error, label) {
  if (error instanceof OverviewError) return res.status(error.status).json({ error: error.message });
  if (error?.code === 'not_configured') return res.status(503).json({ error: 'not_configured' });
  console.error(`Control Centre ${label} failed (code: ${error?.code || error?.name || 'unknown'})`);
  return res.status(500).json({ error: `${label} error` });
}

router.get('/overview', async (req, res) => {
  try {
    const range = typeof req.query.range === 'string' && req.query.range ? req.query.range : DEFAULT_RANGE;
    res.set('Cache-Control', 'private, no-store');
    res.json(await getOverview(range));
  } catch (error) {
    sendError(res, error, 'overview');
  }
});

router.get('/search', async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json(await search(req.query.q));
  } catch (error) {
    sendError(res, error, 'search');
  }
});

export default router;
