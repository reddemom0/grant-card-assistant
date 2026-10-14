/**
 * Control Centre review queue API — mounted at /api/control-centre/review
 *
 * Every signed-in staff member has full access (no admin check). server.js
 * mounts this behind authenticateUser + requireAuth: authenticateUser only
 * populates req.user, requireAuth is what returns 401.
 *
 *   GET    /             ?status=&owner=&kind=  most recently updated first
 *   GET    /:id          item + flags + events, with names
 *   POST   /flag         staff flag; actor is the signed-in email
 *   PATCH  /:id/status   {to}  ('closed' refused — use close)
 *   PATCH  /:id/owner    {owner}  (null clears)
 *   POST   /:id/close    {expected_match, close_note}
 *
 * Bad input → 400, unknown id → 404, already closed → 409, app DB not
 * configured → 503 (names only; the queue lives in the Hub DB).
 *
 * Logic: review-queue.js. Docs: docs/control-centre.md.
 */

import express from 'express';
import {
  ReviewQueueError, addFlag, moveStatus, setOwner, close, listItems, getItem, staffNames
} from './review-queue.js';
import { identitiesForClerkIds, companyNamesForIds } from './identity.js';

const router = express.Router();

function sendError(res, error, label) {
  if (error instanceof ReviewQueueError) return res.status(error.status).json({ error: error.message });
  if (error?.code === 'not_configured') return res.status(503).json({ error: 'not_configured' });
  console.error(`Control Centre review ${label} failed (code: ${error?.code || error?.name || 'unknown'})`);
  return res.status(500).json({ error: 'review queue error' });
}

const filter = (v) => (typeof v === 'string' && v !== '' ? v : undefined);

/**
 * Display names for every actor on an item. Clerk ids → company (through
 * identity.js) → company name; staff emails → Hub users.name. A names
 * failure never fails the request.
 */
async function namesFor(item, flags, events) {
  const actors = new Set([item.closed_by, ...flags.map((f) => f.actor), ...events.map((e) => e.actor)]
    .filter((a) => typeof a === 'string' && a));
  const clerkIds = [...actors].filter((a) => a.startsWith('user_'));
  const emails = [...actors].filter((a) => a.includes('@'));

  const out = { actors: {}, companies: {} };
  try {
    const staff = await staffNames(emails);
    for (const e of emails) out.actors[e] = { kind: 'staff', name: staff.get(e.toLowerCase()) ?? null };
  } catch (error) {
    out.error = String(error?.code || error?.name || 'unknown');
  }
  try {
    const ids = await identitiesForClerkIds(clerkIds);
    const companyIds = [item.company_id, ...[...ids.values()].map((i) => i.company_id)].filter((id) => id != null);
    const names = await companyNamesForIds(companyIds);
    for (const [id, name] of names) out.companies[id] = name;
    for (const c of clerkIds) {
      const company_id = ids.get(c)?.company_id ?? null;
      out.actors[c] = { kind: 'client', company_id, name: company_id != null ? names.get(company_id) ?? null : null };
    }
  } catch (error) {
    out.error = String(error?.code || error?.name || 'unknown');
  }
  return out;
}

router.get('/', async (req, res) => {
  try {
    const items = await listItems({
      status: filter(req.query.status), owner: filter(req.query.owner), kind: filter(req.query.kind)
    });
    res.set('Cache-Control', 'no-store');
    res.json({ items });
  } catch (error) {
    sendError(res, error, 'list');
  }
});

router.post('/flag', async (req, res) => {
  try {
    const b = req.body || {};
    const result = await addFlag({
      kind: b.kind, company_id: b.company_id, grant_root_id: b.grant_root_id, chat_turn_ref: b.chat_turn_ref,
      comment: b.comment, source: 'staff_flag', actor: req.user.email
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    sendError(res, error, 'flag');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { item, flags, events } = await getItem(req.params.id);
    const names = await namesFor(item, flags, events);
    res.set('Cache-Control', 'no-store');
    res.json({ item, flags, events, names });
  } catch (error) {
    sendError(res, error, 'get');
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    res.json({ item: await moveStatus(req.params.id, req.body?.to, req.user.email) });
  } catch (error) {
    sendError(res, error, 'status');
  }
});

router.patch('/:id/owner', async (req, res) => {
  try {
    if (!req.body || !('owner' in req.body)) throw new ReviewQueueError(400, 'owner is required (null clears it)');
    res.json({ item: await setOwner(req.params.id, req.body.owner, req.user.email) });
  } catch (error) {
    sendError(res, error, 'owner');
  }
});

router.post('/:id/close', async (req, res) => {
  try {
    const b = req.body || {};
    res.json({ item: await close(req.params.id, { expected_match: b.expected_match, close_note: b.close_note }, req.user.email) });
  } catch (error) {
    sendError(res, error, 'close');
  }
});

export default router;
