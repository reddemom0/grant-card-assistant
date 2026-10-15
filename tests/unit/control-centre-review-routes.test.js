/**
 * control-centre review routes (step 5c+9, Part B): the list's summary shape
 * and titles, the full card with comments and titled links, the chat
 * conversation read, comments, and the signed-in email on every action.
 *
 * A real express app on a random port; every dependency is injected through
 * createReviewRouter(overrides). No database.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-review-routes.test.js
 */

import { jest } from '@jest/globals';
import express from 'express';

const { createReviewRouter } = await import('../../src/control-centre/review-routes.js');
const Q = await import('../../src/control-centre/review-queue.js');
const D = await import('../../src/control-centre/diagnosis.js');

const STAFF = 'steph@granted.ca';

const listRow = (over = {}) => ({
  id: '3', kind: 'match', status: 'diagnosed', owner: 'chris', company_id: 81, grant_root_id: 1196, pattern_category: null,
  chat_turn_ref: null, conversation_id: null, flag_count: 2, flagged_again: false, verdict: 'tag_missed_restriction',
  narrative: 'n', grant_name: 'Agricultural Clean Technology Program', stuck: false, idle_days: 0, ...over
});

function deps(over = {}) {
  const calls = [];
  const hubQuery = jest.fn(async (sql, p) => {
    if (sql === Q.LINK_NAMES_SQL) return { rows: p[0].includes(1196) ? [{ id: 1196, grant_name: 'Agricultural Clean Technology Program' }] : [] };
    if (sql === Q.ITEM_CONVERSATION_SQL) {
      return { rows: p[0] === 9 ? [{ kind: 'chat', conversation_id: 290, chat_turn_ref: 'conv:290:left_unanswered' }]
        : p[0] === 10 ? [{ kind: 'chat', conversation_id: null, chat_turn_ref: 'turn-abc' }]
          : p[0] === 3 ? [{ kind: 'match', conversation_id: null, chat_turn_ref: null }] : [] };
    }
    throw new Error(`unexpected hub SQL ${sql.slice(0, 40)}`);
  });
  const opsQuery = jest.fn(async (sql, p) => {
    if (sql === D.CHAT_TURN_SQL) return { rows: [{ turn_id: p[0], conversation_id: 77 }] };
    if (sql === D.CONVERSATION_MESSAGES_SQL) {
      return { rows: [{ messages: [{ role: 'user', content: `q in ${p[0]} ${'z'.repeat(5000)}` }, { role: 'assistant', content: 'a' }] }] };
    }
    throw new Error('unexpected ops SQL');
  });
  const d = {
    hubQuery,
    opsQuery,
    listItems: jest.fn(async (f) => { calls.push(['list', f]); return [listRow(), listRow({ id: '23', kind: 'grant_pattern', company_id: null, pattern_category: 'wrong_industry' }), listRow({ id: '9', kind: 'chat', grant_root_id: null, grant_name: null, company_id: 135, chat_turn_ref: 'conv:290:left_unanswered' })]; }),
    namedItems: jest.fn(async (items) => ({ items: items.map((i) => ({ ...i, company_name: { 81: 'Maximizer', 135: 'NYA Ventures' }[i.company_id] ?? null, company_internal: i.company_id === 81 })) })),
    getItem: jest.fn(async (id) => {
      if (id !== '3') throw new Q.ReviewQueueError(404, 'review item not found');
      return {
        item: { id: 3, kind: 'match', status: 'diagnosed', owner: 'chris', company_id: 81, grant_root_id: 1196, snapshot: { source: 'match_explain', response: {} }, closed_by: null },
        flags: [{ id: 1, source: 'client_thumbs_down', actor: 'user_a', comment: null }],
        events: [
          { id: 1, action: 'created', actor: 'user_a' },
          { id: 2, action: 'diagnosed', actor: 'system:review-sweep' },
          { id: 3, action: 'comment', actor: STAFF, detail: '{"text":"Looking at it"}' }
        ],
        links: [{ id: 23, kind: 'grant_pattern', status: 'diagnosed', company_id: null, grant_root_id: 1196, pattern_category: 'wrong_industry', relation: 'same_grant' }]
      };
    }),
    staffNames: jest.fn(async () => new Map([[STAFF, 'Steph Lee']])),
    identitiesForClerkIds: jest.fn(async () => new Map([['user_a', { company_id: 81 }]])),
    companyNamesForIds: jest.fn(async () => new Map([[81, 'Maximizer']])),
    addComment: jest.fn(async (id, text, actor) => ({ item_id: Number(id), text, actor })),
    moveStatus: jest.fn(async (id, to, actor) => ({ id: Number(id), status: to, actor })),
    setOwner: jest.fn(async (id, owner, actor) => ({ id: Number(id), owner, actor })),
    close: jest.fn(async (id, body, actor) => ({ id: Number(id), status: 'closed', ...body, closed_by: actor })),
    addFlag: jest.fn(async () => ({ created: true })),
    ...over
  };
  return { d, calls };
}

async function serve(d, user = { email: STAFF }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/review', createReviewRouter(d));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/review`;
  const call = async (method, path, body) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

let srv;
afterEach(async () => { await srv?.close(); srv = null; });
beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });

describe('GET /', () => {
  test('summaries with names, internal tag and a plain title for each kind', async () => {
    const { d } = deps();
    srv = await serve(d);
    const r = await srv.call('GET', '/?owner=chris');
    expect(r.status).toBe(200);
    expect(d.listItems).toHaveBeenCalledWith({ status: undefined, owner: 'chris', kind: undefined });
    expect(r.body.stuck_days).toBe(3);
    expect(r.body.items.map((i) => i.title)).toEqual([
      'Agricultural Clean Technology Program matched to Maximizer',
      'Agricultural Clean Technology Program — cut for several companies (wrong industry)',
      'Question left unanswered (NYA Ventures)'
    ]);
    expect(r.body.items[0]).toMatchObject({ company_name: 'Maximizer', company_internal: true, verdict: 'tag_missed_restriction', stuck: false });
    expect(r.body.items.some((i) => 'snapshot' in i)).toBe(false);
    expect(r.body.items.map((i) => i.id)).toEqual([3, 23, 9]);
  });
});

describe('GET /:id', () => {
  test('the full card with title, comments split out, titled linked cards and actor names', async () => {
    const { d } = deps();
    srv = await serve(d);
    const r = await srv.call('GET', '/3');
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ title: 'Agricultural Clean Technology Program matched to Maximizer', company_name: 'Maximizer',
      company_internal: true, grant_name: 'Agricultural Clean Technology Program' });
    expect(r.body.item.snapshot).toBeDefined();
    expect(r.body.comments).toEqual([expect.objectContaining({ action: 'comment', actor: STAFF })]);
    expect(r.body.links).toEqual([expect.objectContaining({ id: 23, title: 'Agricultural Clean Technology Program — cut for several companies (wrong industry)' })]);
    expect(r.body.names.actors).toMatchObject({
      [STAFF]: { kind: 'staff', name: 'Steph Lee' },
      user_a: { kind: 'client', name: 'Maximizer', internal: true },
      'system:review-sweep': { kind: 'system', name: 'the hourly review sweep' }
    });
  });

  test('unknown card is a 404', async () => {
    const { d } = deps();
    srv = await serve(d);
    expect((await srv.call('GET', '/404')).status).toBe(404);
  });
});

describe('GET /:id/conversation', () => {
  test('a chat card: the whole conversation, verbatim, read from the ops DB', async () => {
    const { d } = deps();
    srv = await serve(d);
    const r = await srv.call('GET', '/9/conversation');
    expect(r.status).toBe(200);
    expect(r.body.conversation_id).toBe(290);
    expect(r.body.turns[0].client).toHaveLength(`q in 290 `.length + 5000);
    expect(d.opsQuery.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });

  test('a single-turn chat card finds its conversation through the turn', async () => {
    const { d } = deps();
    srv = await serve(d);
    const r = await srv.call('GET', '/10/conversation');
    expect(r.body.conversation_id).toBe(77);
    expect(d.opsQuery).toHaveBeenCalledWith(D.CHAT_TURN_SQL, ['turn-abc']);
  });

  test('not a chat card, unknown card, bad id, ops DB unset', async () => {
    const { d } = deps();
    srv = await serve(d);
    expect((await srv.call('GET', '/3/conversation')).status).toBe(404);
    expect((await srv.call('GET', '/5/conversation')).status).toBe(404);
    expect((await srv.call('GET', '/x/conversation')).status).toBe(400);
    await srv.close();
    const off = deps({ opsQuery: async () => { throw Object.assign(new Error('x'), { name: 'NotConfiguredError', code: 'not_configured' }); } });
    srv = await serve(off.d);
    expect((await srv.call('GET', '/9/conversation')).status).toBe(503);
  });
});

describe('actions record the signed-in staff member', () => {
  test('comment, move, reassign and close pass req.user.email', async () => {
    const { d } = deps();
    srv = await serve(d);
    expect((await srv.call('POST', '/3/comment', { text: 'On it' })).status).toBe(201);
    expect(d.addComment).toHaveBeenCalledWith('3', 'On it', STAFF);
    expect((await srv.call('PATCH', '/3/status', { to: 'in_progress' })).body.item).toMatchObject({ status: 'in_progress', actor: STAFF });
    expect((await srv.call('PATCH', '/3/owner', { owner: 'research' })).body.item).toMatchObject({ owner: 'research', actor: STAFF });
    expect((await srv.call('POST', '/3/close', { expected_match: 'shouldnt', close_note: 'Tag fixed' })).body.item)
      .toMatchObject({ expected_match: 'shouldnt', close_note: 'Tag fixed', closed_by: STAFF });
  });

  test('queue errors keep their status: a bad comment 400, closing twice 409', async () => {
    const { d } = deps({
      addComment: async () => { throw new Q.ReviewQueueError(400, 'text is required'); },
      close: async () => { throw new Q.ReviewQueueError(409, 'item is already closed'); }
    });
    srv = await serve(d);
    expect(await srv.call('POST', '/3/comment', { text: '' })).toEqual({ status: 400, body: { error: 'text is required' } });
    expect((await srv.call('POST', '/3/close', { expected_match: 'should' })).status).toBe(409);
  });
});
