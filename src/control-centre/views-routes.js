/**
 * Control Centre Department views API — mounted at /api/control-centre/views
 *
 * Every signed-in staff member has full access (no admin check); server.js
 * mounts this behind authenticateUser + requireAuth.
 *
 *   GET /?range=day|week|month|year   Research, Consulting/Sales and Marketing
 *                                     items, both variants (cached 5 min)
 *
 * Bad input → 400. A source that isn't configured fails only its own items
 * (each carries `error`), so the response is still 200. Logic: views.js.
 * Docs: docs/control-centre.md.
 */

import express from 'express';
import * as views from './views.js';

function sendError(res, error, label) {
  if (error instanceof views.ViewsError) return res.status(error.status).json({ error: error.message });
  if (error?.code === 'not_configured' || error?.name === 'NotConfiguredError') return res.status(503).json({ error: 'not_configured' });
  if (error?.code === '42P01') return res.status(503).json({ error: 'migration_missing' });
  console.error(`Control Centre views ${label} failed (code: ${error?.code || error?.name || 'unknown'})`);
  return res.status(500).json({ error: `${label} error` });
}

/** The router; `overrides` replaces views.js functions (tests). */
export function createViewsRouter(overrides = {}) {
  const f = { ...views, ...overrides };
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.departmentViews(typeof req.query.range === 'string' && req.query.range ? req.query.range : 'week'));
    } catch (error) {
      sendError(res, error, 'views');
    }
  });

  return router;
}

export default createViewsRouter();
