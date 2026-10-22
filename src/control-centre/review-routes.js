/**
 * Control Centre review queue API — mounted at /api/control-centre/review
 *
 * Every signed-in staff member has full access (no admin check). server.js
 * mounts this behind authenticateUser + requireAuth: authenticateUser only
 * populates req.user, requireAuth is what returns 401.
 *
 *   GET    /                  ?status=&owner=&kind=  summaries (no snapshot), most
 *                             recently updated first, each with title, names and stuck
 *   GET    /:id               item + flags + events + comments + linked cards, with names
 *   GET    /:id/conversation  a chat card's whole conversation, read-only from the ops DB
 *   POST   /flag              staff flag; actor is the signed-in email
 *   POST   /:id/comment       {text}; logged as a 'comment' event by the signed-in email
 *   PATCH  /:id/status        {to}  ('closed' refused — use close)
 *   PATCH  /:id/owner         {owner}  (null clears it)
 *   POST   /:id/close         {expected_match, close_note}
 *   PATCH  /:id/answer        {answer}  consulting cards: the consultant's answer
 *   POST   /:id/send-to-chris {answer}  save the answer, owner chris, in progress
 *   POST   /:id/approve-for-ai {answer?} Chris only: queue the Q&A for the AI
 *                             (cc_ai_knowledge, knowledge.js) and close the card
 *
 * Bad input → 400, unknown id → 404, already closed → 409, app or ops DB not
 * configured → 503 (names and conversations only; the queue lives in the Hub DB).
 *
 * Logic: review-queue.js. The Review queue screen: public/js/control-centre.js.
 * Docs: docs/control-centre.md.
 */

import express from 'express';
import { query as hubQueryDefault } from '../database/connection.js';
import * as queue from './review-queue.js';
import { identitiesForClerkIds, companyNamesForIds, withCompanyNames } from './identity.js';
import { isInternalCompany } from './internal-accounts.js';
import { cardTitle } from './card-summary.js';

const { ReviewQueueError } = queue;

function sendError(res, error, label) {
  if (error instanceof ReviewQueueError) return res.status(error.status).json({ error: error.message });
  if (error?.code === 'not_configured' || error?.name === 'NotConfiguredError') return res.status(503).json({ error: 'not_configured' });
  console.error(`Control Centre review ${label} failed (code: ${error?.code || error?.name || 'unknown'})`);
  return res.status(500).json({ error: 'review queue error' });
}

const filter = (v) => (typeof v === 'string' && v !== '' ? v : undefined);

const SYSTEM_ACTORS = {
  'system:review-sweep': 'the hourly review sweep',
  'system:oracle-chat-review': "Oracle's morning chat review"
};

/**
 * Display names for every actor on an item. Clerk ids → company (through
 * identity.js) → company name; staff emails → Hub users.name; system jobs →
 * what they are. A names failure never fails the request.
 */
async function namesFor(item, flags, events, deps) {
  const actors = new Set([item.closed_by, ...flags.map((f) => f.actor), ...events.map((e) => e.actor)]
    .filter((a) => typeof a === 'string' && a));
  const clerkIds = [...actors].filter((a) => a.startsWith('user_'));
  const emails = [...actors].filter((a) => a.includes('@'));

  const out = { actors: {}, companies: {} };
  for (const a of actors) if (SYSTEM_ACTORS[a]) out.actors[a] = { kind: 'system', name: SYSTEM_ACTORS[a] };
  try {
    const staff = await deps.staffNames(emails);
    for (const e of emails) out.actors[e] = { kind: 'staff', name: staff.get(e.toLowerCase()) ?? null };
  } catch (error) {
    out.error = String(error?.code || error?.name || 'unknown');
  }
  try {
    const ids = await deps.identitiesForClerkIds(clerkIds);
    const companyIds = [item.company_id, ...[...ids.values()].map((i) => i.company_id)].filter((id) => id != null);
    const names = await deps.companyNamesForIds(companyIds);
    for (const [id, name] of names) out.companies[id] = name;
    for (const c of clerkIds) {
      const company_id = ids.get(c)?.company_id ?? null;
      out.actors[c] = { kind: 'client', company_id, name: company_id != null ? names.get(company_id) ?? null : null,
        internal: isInternalCompany(company_id) };
    }
  } catch (error) {
    out.error = String(error?.code || error?.name || 'unknown');
  }
  return out;
}

/**
 * Items with `company_name` beside `company_id` (name first in the UI, id
 * second). The app DB is only needed for names, so a names failure — or an
 * unset APP_DB_READONLY_URL — still returns the list, names null, with
 * `names_error`.
 */
export async function namedItems(items, { query } = {}) {
  try {
    return { items: await withCompanyNames(items, query ? { query } : {}) };
  } catch (error) {
    return {
      items: items.map((i) => ({ ...i, company_name: null, company_internal: isInternalCompany(i.company_id) })),
      names_error: String(error?.code || error?.name || 'unknown')
    };
  }
}

/**
 * Each row with its plain title (cardTitle) — company + grant, grant + reason,
 * or issue + client — and its id as a number (BIGSERIAL comes back as text).
 */
export const withTitles = (items) => items.map((i) => ({ ...i, id: Number(i.id), title: cardTitle(i) }));

/** Linked cards with grant names, company names and titles. A names failure keeps ids. */
async function titledLinks(links, deps) {
  if (!links.length) return [];
  let grants = new Map();
  try {
    const ids = [...new Set(links.map((l) => l.grant_root_id).filter((id) => id != null))];
    if (ids.length) grants = new Map((await deps.hubQuery(queue.LINK_NAMES_SQL, [ids])).rows.map((r) => [r.id, r.grant_name]));
  } catch { /* titles fall back to ids */ }
  const named = (await deps.namedItems(links.map((l) => ({ ...l, grant_name: grants.get(l.grant_root_id) ?? null })))).items;
  return withTitles(named);
}

/** The ops conversation id behind a chat card, from its ref or its turn. */
async function conversationIdOf(item, deps) {
  if (item.conversation_id != null) return item.conversation_id;
  const conv = deps.parseConversationRef(item.chat_turn_ref);
  if (conv) return conv.conversationId;
  const turn = (await deps.opsQuery(deps.CHAT_TURN_SQL, [item.chat_turn_ref])).rows[0];
  return turn?.conversation_id ?? null;
}

async function defaultDeps() {
  const [diagnosis, db] = await Promise.all([import('./diagnosis.js'), import('./db.js')]);
  return {
    ...queue,
    hubQuery: hubQueryDefault,
    opsQuery: db.opsQuery,
    identitiesForClerkIds,
    companyNamesForIds,
    namedItems,
    splitTurns: diagnosis.splitTurns,
    parseConversationRef: diagnosis.parseConversationRef,
    CHAT_TURN_SQL: diagnosis.CHAT_TURN_SQL,
    CONVERSATION_MESSAGES_SQL: diagnosis.CONVERSATION_MESSAGES_SQL
  };
}

/**
 * The router. `overrides` replaces any dependency (tests); everything else is
 * the real review-queue.js, identity.js and db.js.
 */
export function createReviewRouter(overrides = {}) {
  const router = express.Router();
  let depsPromise = null;
  const deps = () => (depsPromise ??= defaultDeps().then((d) => ({ ...d, ...overrides })));

  router.get('/', async (req, res) => {
    try {
      const d = await deps();
      const items = await d.listItems({
        status: filter(req.query.status), owner: filter(req.query.owner), kind: filter(req.query.kind)
      });
      const named = await d.namedItems(items);
      res.set('Cache-Control', 'no-store');
      res.json({ ...named, items: withTitles(named.items), stuck_days: queue.STUCK_DAYS });
    } catch (error) {
      sendError(res, error, 'list');
    }
  });

  router.post('/flag', async (req, res) => {
    try {
      const b = req.body || {};
      const result = await (await deps()).addFlag({
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
      const d = await deps();
      const { item, flags, events, links = [] } = await d.getItem(req.params.id);
      const names = await namesFor(item, flags, events, d);
      const company_name = item.company_id != null ? names.companies?.[item.company_id] ?? null : null;
      const grant_name = item.grant_root_id != null
        ? (await d.hubQuery(queue.LINK_NAMES_SQL, [[item.grant_root_id]]).catch(() => ({ rows: [] }))).rows[0]?.grant_name ?? null
        : null;
      const full = { ...item, id: Number(item.id), company_name, company_internal: isInternalCompany(item.company_id), grant_name };
      res.set('Cache-Control', 'no-store');
      res.json({
        item: { ...full, title: cardTitle(full) },
        flags,
        events,
        comments: events.filter((e) => e.action === 'comment'),
        links: await titledLinks(links, d),
        names
      });
    } catch (error) {
      sendError(res, error, 'get');
    }
  });

  router.get('/:id/conversation', async (req, res) => {
    try {
      const d = await deps();
      const id = queue.parseId(req.params.id);
      if (id === null) throw new ReviewQueueError(400, 'id must be a positive integer');
      const item = (await d.hubQuery(queue.ITEM_CONVERSATION_SQL, [id])).rows[0];
      if (!item) throw new ReviewQueueError(404, 'review item not found');
      if (item.kind !== 'chat') throw new ReviewQueueError(404, 'only chat cards have a conversation');
      const conversationId = await conversationIdOf(item, d);
      if (conversationId == null) throw new ReviewQueueError(404, 'conversation not found');
      const conv = (await d.opsQuery(d.CONVERSATION_MESSAGES_SQL, [conversationId])).rows[0];
      if (!conv) throw new ReviewQueueError(404, 'conversation not found');
      res.set('Cache-Control', 'no-store');
      res.json({ conversation_id: conversationId, turns: d.splitTurns(conv.messages, { clipChars: Infinity }) });
    } catch (error) {
      sendError(res, error, 'conversation');
    }
  });

  router.post('/:id/comment', async (req, res) => {
    try {
      res.status(201).json({ comment: await (await deps()).addComment(req.params.id, req.body?.text, req.user.email) });
    } catch (error) {
      sendError(res, error, 'comment');
    }
  });

  router.patch('/:id/status', async (req, res) => {
    try {
      res.json({ item: await (await deps()).moveStatus(req.params.id, req.body?.to, req.user.email) });
    } catch (error) {
      sendError(res, error, 'status');
    }
  });

  router.patch('/:id/owner', async (req, res) => {
    try {
      if (!req.body || !('owner' in req.body)) throw new ReviewQueueError(400, 'owner is required (null clears it)');
      res.json({ item: await (await deps()).setOwner(req.params.id, req.body.owner, req.user.email) });
    } catch (error) {
      sendError(res, error, 'owner');
    }
  });

  router.post('/:id/close', async (req, res) => {
    try {
      const b = req.body || {};
      res.json({ item: await (await deps()).close(req.params.id, { expected_match: b.expected_match, close_note: b.close_note }, req.user.email) });
    } catch (error) {
      sendError(res, error, 'close');
    }
  });

  // Consulting cards (chat-daily.js consulting_question): the consultant's
  // answer, handing it to Chris, and Chris approving it for the AI.
  router.patch('/:id/answer', async (req, res) => {
    try {
      res.json({ item: await (await deps()).setAnswer(req.params.id, req.body?.answer, req.user.email) });
    } catch (error) {
      sendError(res, error, 'answer');
    }
  });

  router.post('/:id/send-to-chris', async (req, res) => {
    try {
      res.json({ item: await (await deps()).sendToChris(req.params.id, req.body?.answer, req.user.email) });
    } catch (error) {
      sendError(res, error, 'send-to-chris');
    }
  });

  router.post('/:id/approve-for-ai', async (req, res) => {
    try {
      const r = await (await deps()).approveForAi(req.params.id, req.user.email, { answer: req.body?.answer });
      res.json({ item: r.item, knowledge: r.knowledge ?? null });
    } catch (error) {
      sendError(res, error, 'approve-for-ai');
    }
  });

  return router;
}

export default createReviewRouter();
