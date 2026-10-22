/**
 * Control Centre AI knowledge queue API — mounted at /api/control-centre/knowledge
 *
 * Every signed-in staff member has full access (no admin check); server.js
 * mounts this behind authenticateUser + requireAuth.
 *
 *   GET  /?status=pending|exported   the queue rows (newest approval first) and counts
 *   POST /export                     mark every pending row exported in one batch and
 *                                    send the markdown as a download; {count: 0} when
 *                                    nothing is pending (nothing written)
 *   GET  /export/:batch              a past batch's markdown again (a failed download
 *                                    never loses answers)
 *
 * Bad input → 400, unknown batch → 404, migration 057 not applied → 503
 * migration_missing. Logic: knowledge.js. Docs: docs/control-centre.md.
 */

import express from 'express';
import * as knowledge from './knowledge.js';

function sendError(res, error, label) {
  if (error instanceof knowledge.KnowledgeError) return res.status(error.status).json({ error: error.message });
  if (error?.code === '42P01') return res.status(503).json({ error: 'migration_missing' });
  if (error?.code === 'not_configured' || error?.name === 'NotConfiguredError') return res.status(503).json({ error: 'not_configured' });
  console.error(`Control Centre knowledge ${label} failed (code: ${error?.code || error?.name || 'unknown'})`);
  return res.status(500).json({ error: `${label} error` });
}

const filter = (v) => (typeof v === 'string' && v !== '' ? v : undefined);

function sendMarkdown(res, { batch, markdown, count }) {
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="ai-knowledge-${batch}.md"`);
  res.set('X-Export-Count', String(count));
  res.set('Cache-Control', 'no-store');
  res.send(markdown);
}

/** The router; `overrides` replaces knowledge.js functions (tests). */
export function createKnowledgeRouter(overrides = {}) {
  const f = { ...knowledge, ...overrides };
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await f.listKnowledge({ status: filter(req.query.status) }));
    } catch (error) {
      sendError(res, error, 'list');
    }
  });

  router.post('/export', async (req, res) => {
    try {
      const out = await f.exportPending(req.user?.email ?? null);
      if (!out.count) return res.json({ count: 0 });
      return sendMarkdown(res, out);
    } catch (error) {
      return sendError(res, error, 'export');
    }
  });

  router.get('/export/:batch', async (req, res) => {
    try {
      const out = await f.batchMarkdown(req.params.batch);
      if (!out) return res.status(404).json({ error: 'batch not found' });
      return sendMarkdown(res, out);
    } catch (error) {
      return sendError(res, error, 'batch');
    }
  });

  return router;
}

export default createKnowledgeRouter();
