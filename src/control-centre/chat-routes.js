/**
 * Control Centre Chat themes API — mounted at /api/control-centre/chat
 *
 * Every signed-in staff member has full access (no admin check); server.js
 * mounts this behind authenticateUser + requireAuth.
 *
 *   GET /?range=day|week|month|year
 *                          themes (clients only), unanswered questions, unmet
 *                          needs, grants discussed, chat health, chat outcomes —
 *                          client-only and with internal accounts (cached 5 min)
 *   GET /search?q=&company=&from=&to=&cards=any|shown|none&internal=1
 *                          any word across client and assistant text
 *   GET /:conversationId   one conversation, verbatim, with each reply's grant
 *                          cards; every opening is logged (cc_transcript_views)
 *
 * Bad input → 400, unknown conversation → 404, a database not configured → 503.
 * `overrides` replaces chat-themes.js functions (tests); `deps` is passed to
 * them (the local check points the daily-pass store at a scratch DB).
 * Logic: chat-themes.js. Docs: docs/control-centre.md.
 */

import express from 'express';
import * as chat from './chat-themes.js';

function sendError(res, error, label) {
  if (error instanceof chat.ChatError || error instanceof chat.OverviewError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error?.code === 'not_configured' || error?.name === 'NotConfiguredError') return res.status(503).json({ error: 'not_configured' });
  if (error?.code === '42P01') return res.status(503).json({ error: 'migration_missing' });
  console.error(`Control Centre chat ${label} failed (code: ${error?.code || error?.name || 'unknown'})`);
  return res.status(500).json({ error: `${label} error` });
}

const str = (v, fallback) => (typeof v === 'string' && v ? v : fallback);

export function createChatRouter(overrides = {}, deps = {}) {
  const f = { ...chat, ...overrides };
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.chatOverview(str(req.query.range, 'week'), deps));
    } catch (error) {
      sendError(res, error, 'overview');
    }
  });

  router.get('/search', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const q = req.query;
      res.json(await f.chatSearch({ q: str(q.q, ''), company: str(q.company, ''), from: str(q.from, ''), to: str(q.to, ''),
        cards: str(q.cards, 'any'), internal: str(q.internal, '') }, deps));
    } catch (error) {
      sendError(res, error, 'search');
    }
  });

  router.get('/:conversationId', async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await f.chatTranscript(req.params.conversationId, req.user?.email, deps));
    } catch (error) {
      sendError(res, error, 'transcript');
    }
  });

  return router;
}

export default createChatRouter();
