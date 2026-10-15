/**
 * Control Centre Companies API — mounted at /api/control-centre/companies
 *
 * Every signed-in staff member has full access (no admin check); server.js
 * mounts this behind authenticateUser + requireAuth.
 *
 *   GET /?range=day|week|month|year         the client list (cached 5 min per range)
 *   GET /:id                                one company's page, first half (fast): company,
 *                                           profile + gaps, goals, goal tracks
 *   GET /:id/feed                           second half: tiles, timeline, chats, review cards
 *   POST /:id/empty-track                   {track, note} — "Flag empty track": a staff
 *                                           empty_track card; evidence built server-side
 *   GET /:id/why?grant=                     "Why matched?" — match-explain bad_match, trimmed
 *   GET /:id/chats/:conversationId          one of the company's conversations, verbatim;
 *                                           the view is logged (migration 048)
 *
 * Flagging a grant from the page reuses POST /api/control-centre/review/flag.
 * Bad input → 400, unknown → 404, a database or match-explain not configured →
 * 503, match-explain failing → 502. Logic: companies.js. Docs: docs/control-centre.md.
 */

import express from 'express';
import * as companies from './companies.js';

function sendError(res, error, label) {
  if (error instanceof companies.CompaniesError || error instanceof companies.OverviewError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error?.code === 'not_configured' || error?.name === 'NotConfiguredError') return res.status(503).json({ error: 'not_configured' });
  if (error?.code === '42P01') return res.status(503).json({ error: 'migration_missing' });
  console.error(`Control Centre companies ${label} failed (code: ${error?.code || error?.name || 'unknown'})`);
  return res.status(500).json({ error: `${label} error` });
}

/** The router; `overrides` replaces companies.js functions (tests). */
export function createCompaniesRouter(overrides = {}) {
  const f = { ...companies, ...overrides };
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      const range = typeof req.query.range === 'string' && req.query.range ? req.query.range : 'week';
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.companyList(range));
    } catch (error) {
      sendError(res, error, 'list');
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.companyCore(req.params.id));
    } catch (error) {
      sendError(res, error, 'detail');
    }
  });

  router.get('/:id/feed', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.companyFeed(req.params.id));
    } catch (error) {
      sendError(res, error, 'feed');
    }
  });

  router.post('/:id/empty-track', express.json(), async (req, res) => {
    try {
      const r = await f.fileEmptyTrack(req.params.id, req.body?.track, req.body?.note, req.user?.email);
      res.status(r.created ? 201 : 200).json(r);
    } catch (error) {
      if (error?.name === 'ReviewQueueError') return res.status(error.status).json({ error: error.message });
      sendError(res, error, 'empty-track');
    }
  });

  router.get('/:id/why', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.whyMatched(req.params.id, req.query.grant));
    } catch (error) {
      sendError(res, error, 'why');
    }
  });

  router.get('/:id/chats/:conversationId', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.transcript(req.params.id, req.params.conversationId, req.user?.email));
    } catch (error) {
      sendError(res, error, 'transcript');
    }
  });

  return router;
}

export default createCompaniesRouter();
