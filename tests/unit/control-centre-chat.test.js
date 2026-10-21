/**
 * control-centre Chat themes tab and the daily chat review: the unanswered
 * definition, the two chat-card rules (funding ask with no cards — the three
 * search statuses, the not-recorded skip, one card per chat; a card for a
 * grant the reply ruled out), their forced diagnosis, the 24-hour outcome
 * window, chat search over client and assistant text (never tool output), the
 * dry run writing nothing, the routes and Oracle's chat modes.
 * Fixtures and injected deps only — no DB, no network, no model.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-chat.test.js
 */

import { jest } from '@jest/globals';
import express from 'express';

const D = await import('../../src/control-centre/chat-daily.js');
const C = await import('../../src/control-centre/chat-themes.js');
const { createChatRouter } = await import('../../src/control-centre/chat-routes.js');
const { routeFor } = await import('../../src/control-centre/diagnosis.js');
const T = await import('../../src/tools/control-centre-tools.js');

beforeEach(() => { C._clearCacheForTests(); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

const result = (id, body) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(body) }] });
const use = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });

/** #289's shape: an equipment question answered with a search and a card, then "What about loan programs" with no tools. */
const loansChat = [
  { role: 'user', content: 'Show me equipment funding programs for my company' },
  { role: 'assistant', content: [{ type: 'text', text: 'Checking your profile.' }, use('a', 'get_company_profile')] },
  result('a', { success: true }),
  { role: 'assistant', content: [use('b', 'search_grants', { query: 'equipment' })] },
  result('b', { results: [{ id: 1742, grant_name: 'Regional Tariff Response Initiative - British Columbia' }, { id: 1080, grant_name: 'Other Fund' }] }),
  { role: 'assistant', content: 'The Regional Tariff Response Initiative - British Columbia is the realistic fit.' },
  { role: 'user', content: 'What about loan programs' },
  { role: 'assistant', content: 'Loan programs are outside what Granted covers.' }
];

describe('parsing a conversation', () => {
  test('turns, grants the tools returned, search and its results, mentions named in the reply', () => {
    const turns = D.parseTurns(loansChat);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ turn_index: 0, searched: true, search_results: 2 });
    expect([...turns[0].returned.keys()]).toEqual([1742, 1080]);
    expect(D.namedInReply(turns[0].reply, turns[0].returned)).toEqual([1742]);
    expect(turns[1]).toMatchObject({ turn_index: 1, searched: false, search_results: 0, reply: 'Loan programs are outside what Granted covers.' });
  });

  test('search status: did not search / searched and found nothing / found but not shown / shown', () => {
    expect(D.searchStatus({ searched: false, search_results: 0 }, [])).toBe('did_not_search');
    expect(D.searchStatus({ searched: true, search_results: 0 }, [])).toBe('searched_found_nothing');
    expect(D.searchStatus({ searched: true, search_results: 4 }, [])).toBe('searched_not_shown');
    expect(D.searchStatus({ searched: true, search_results: 4 }, [12])).toBe('searched_shown');
  });

  test('roundup flag refs name the turn; "end" means the last one', () => {
    expect(D.parseFlagRef('oracle:290:left_unanswered:t3')).toEqual({ conversation_id: 290, issue: 'left_unanswered', turn: 3 });
    expect(D.parseFlagRef('oracle:290:pushback:tend')).toEqual({ conversation_id: 290, issue: 'pushback', turn: null });
    expect(D.parseFlagRef('oracle:turn:abc')).toBeNull();
  });
});

describe('unanswered', () => {
  const r = (over) => D.unansweredReason({ failed: false, answer: 'answered', client: 'Any hiring grants?', flags: [], isLast: false, ...over });
  test('no answer: the turn failed, or the reply did not answer', () => {
    expect(r({ failed: true })).toBe('no_answer');
    expect(r({ answer: 'not_answered' })).toBe('no_answer');
  });
  test('asked for a person: the roundup flag, or the model backed by the client\'s own words', () => {
    expect(r({ flags: ['asked_for_human'] })).toBe('asked_for_person');
    expect(r({ askedForPerson: true, client: 'Can I talk to someone on your team?' })).toBe('asked_for_person');
    // The model alone, without the client's words matching, isn't enough.
    expect(r({ askedForPerson: true, client: 'Which grants cover hiring?' })).toBeNull();
    // HUMAN_ASK words on their own aren't enough either ("support" in a grant question).
    expect(r({ client: 'Grants to support hiring?' })).toBeNull();
  });
  test('left after a bad reply: only on the client\'s last message', () => {
    expect(r({ answer: 'partly', isLast: true })).toBe('left_after_bad_reply');
    expect(r({ flags: ['pushback'], isLast: true })).toBe('left_after_bad_reply');
    expect(r({ answer: 'partly', isLast: false })).toBeNull();
    expect(r({ flags: ['left_unanswered'], isLast: false })).toBeNull();
    expect(r({ answer: 'answered', isLast: true })).toBeNull();
  });
});

const row = (over = {}) => ({
  day: '2026-10-13', conversation_id: 289, turn_index: 1, clerk_id: 'user_x', company_id: 135, occurred_at: '2026-10-13T17:54:41Z',
  question: 'Are there loan programs?', theme: 'Loans and financing', funding_ask: true, answer: 'answered', unanswered_reason: null,
  unmet_need: 'Loans', cards_shown: [], cards_recorded: true, grants_named: [], rejected_shown: [], search_status: 'did_not_search',
  search_results: 0, turn_failed: false, ...over
});

describe('card rule: no_cards_for_funding_ask', () => {
  test('a funding ask with no cards → a card, with the search status as its evidence', () => {
    const [c] = D.cardCandidates([row()]);
    expect(c).toMatchObject({ issue: 'no_cards_for_funding_ask', conversation_id: 289, turn_index: 1,
      evidence: { rule: 'no_cards_for_funding_ask', search_status: 'did_not_search' } });
    expect(D.cardRef(c)).toBe('conv:289:no_cards_for_funding_ask');
    expect(D.flagRef(c)).toBe('oracle:289:no_cards_for_funding_ask:t1');
    expect(c.take).toMatch(/didn't search/);
    for (const s of ['searched_found_nothing', 'searched_not_shown']) {
      expect(D.cardCandidates([row({ search_status: s, search_results: s === 'searched_not_shown' ? 5 : 0 })])[0].evidence.search_status).toBe(s);
    }
  });
  test('no card: not a funding ask, cards were shown, or cards weren\'t recorded', () => {
    expect(D.cardCandidates([row({ funding_ask: false })])).toEqual([]);
    expect(D.cardCandidates([row({ cards_shown: [1742], search_status: 'searched_shown' })])).toEqual([]);
    expect(D.cardCandidates([row({ cards_recorded: false })])).toEqual([]);
  });
  test('one card per chat: two qualifying messages share the card, each its own flag', () => {
    const cs = D.cardCandidates([row({ turn_index: 3 }), row({ turn_index: 4 })]);
    expect(new Set(cs.map(D.cardRef))).toEqual(new Set(['conv:289:no_cards_for_funding_ask']));
    expect(cs.map(D.flagRef)).toEqual(['oracle:289:no_cards_for_funding_ask:t3', 'oracle:289:no_cards_for_funding_ask:t4']);
  });
});

describe('card rule: card_for_rejected_grant', () => {
  const names = new Map([[1262, 'Scale A.I.'], [1416, 'Youth Internship Incentive Program (YIIP)']]);
  const message = { conversation_id: 310, turn_index: 0, clerk_id: 'user_y', occurred_at: '2026-10-13T20:00:00Z', client: 'Grants for my AI startup?',
    reply: 'Scale A.I. is not a fit for you.', cards_shown: [1262, 1416], cards_recorded: true, grants_named: [1262], search_status: 'searched_shown',
    search_results: 6, failed: false, flags: [], isLast: true };
  test('the model\'s rejected names map to shown cards only; unknown names are ignored', () => {
    const r = D.rowFor(message, { id: 1, question: 'Grants for an AI start-up?', theme: 'Start-up funding', funding_ask: true, answer: 'answered',
      asked_for_person: false, unmet_need: null, rejected_shown: ['Scale A.I.', 'Some grant never shown'] }, { day: '2026-10-13', companyOf: new Map(), names });
    expect(r.rejected_shown).toEqual([1262]);
    const [c] = D.cardCandidates([r], { names, env: { PUBLIC_URL: 'https://hub.test' } });
    expect(c).toMatchObject({ issue: 'card_for_rejected_grant', evidence: { rejected_grants: [{ grant_id: 1262, name: 'Scale A.I.', link: 'https://hub.test/control-centre#grants/1262' }] } });
  });
  test('nothing rejected → no card', () => {
    expect(D.cardCandidates([row({ funding_ask: false, rejected_shown: [] })])).toEqual([]);
  });
});

describe('diagnosis of the two card types', () => {
  test('owner chris and the verdict set from the evidence, chat fields still required', () => {
    const chat = { kind: 'chat' };
    const r = (ev) => routeFor(chat, { rule_evidence: ev });
    expect(r({ rule: 'no_cards_for_funding_ask', search_status: 'did_not_search' })).toMatchObject({ allowed: ['chris'], forcedVerdict: 'chat_did_not_search', chatFields: true });
    expect(r({ rule: 'no_cards_for_funding_ask', search_status: 'searched_found_nothing' }).forcedVerdict).toBe('chat_search_found_nothing');
    expect(r({ rule: 'no_cards_for_funding_ask', search_status: 'searched_not_shown' }).forcedVerdict).toBe('chat_results_not_shown');
    expect(r({ rule: 'card_for_rejected_grant' })).toMatchObject({ allowed: ['chris'], forcedVerdict: 'chat_carded_rejected_grant' });
    // The roundup's chat cards keep their rule.
    expect(routeFor(chat, {}).rule).toBe('chat');
  });
});

describe('the daily run', () => {
  function deps(over = {}) {
    const ops = jest.fn(async (sql) => {
      if (sql === D.DAY_TURNS_SQL) return { rows: [{ conversation_id: 289, turn_index: 1, occurred_at: '2026-10-13T17:54:41Z', user_id: 'user_x', outcome: 'completed', surfaced_grant_ids: [] }] };
      if (sql === D.DAY_UNRECORDED_SQL) return { rows: [] };
      if (sql === D.CONVERSATIONS_SQL) return { rows: [{ id: 289, user_id: 'user_x', messages: loansChat, updated_at: '2026-10-13T17:54:41Z' }] };
      if (sql === D.TURN_ROWS_SQL) return { rows: [
        { conversation_id: 289, turn_index: 0, occurred_at: '2026-10-13T17:54:18Z', outcome: 'completed', surfaced_grant_ids: [1742] },
        { conversation_id: 289, turn_index: 1, occurred_at: '2026-10-13T17:54:41Z', outcome: 'completed', surfaced_grant_ids: [] }] };
      return { rows: [] };
    });
    return {
      opsQuery: ops,
      hubQuery: jest.fn(async () => ({ rows: [] })),
      hubTransaction: jest.fn(),
      companyFor: jest.fn(async () => new Map([['user_x', 135]])),
      callDaily: jest.fn(async () => ({ items: [{ id: 1, question: 'Are there loan programs?', theme: 'Loans and financing', funding_ask: true,
        answer: 'answered', asked_for_person: false, unmet_need: 'Loans', rejected_shown: [] }], usage: { input_tokens: 500, output_tokens: 60 } })),
      addFlag: jest.fn(),
      logCost: jest.fn(),
      ...over
    };
  }

  test('a dry run reads the day, classifies only that day\'s messages and writes nothing — not even a cost row', async () => {
    const d = deps();
    const r = await D.runDay('2026-10-13', { deps: d, write: false });
    expect(r.messages).toBe(1); // turn 0 was another day
    expect(r.rows[0]).toMatchObject({ conversation_id: 289, turn_index: 1, company_id: 135, search_status: 'did_not_search', cards_recorded: true, unmet_need: 'Loans' });
    expect(r.candidates.map((c) => [c.issue, c.turn_index])).toEqual([['no_cards_for_funding_ask', 1]]);
    expect(d.hubTransaction).not.toHaveBeenCalled();
    expect(d.addFlag).not.toHaveBeenCalled();
    expect(d.callDaily.mock.calls[0][1].logCost).toBeNull();
    // Only the client's message and reply reach the model, wrapped as data.
    expect(d.callDaily.mock.calls[0][0]).toContain('CLIENT: What about loan programs');
    expect(d.callDaily.mock.calls[0][0]).toContain('CARDS SHOWN: none');
  });

  test('with write: the day is stored and the card filed through addFlag as a chat card, with its evidence', async () => {
    const client = { query: jest.fn(async () => ({ rows: [] })) };
    const d = deps({ hubTransaction: jest.fn(async (fn) => fn(client)), addFlag: jest.fn(async () => ({ item: { id: 77 }, created: true })) });
    const r = await D.runDay('2026-10-13', { deps: d, write: true });
    expect(client.query.mock.calls[0]).toEqual([D.DELETE_DAY_SQL, ['2026-10-13']]);
    expect(client.query.mock.calls[1][0]).toBe(D.UPSERT_QUESTION_SQL);
    expect(d.addFlag).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'chat', chat_turn_ref: 'conv:289:no_cards_for_funding_ask', conversation_id: 289, company_id: 135,
      source: 'oracle_detected', source_ref: 'oracle:289:no_cards_for_funding_ask:t1', actor: 'system:oracle-chat-review',
      snapshot: expect.objectContaining({ rule_evidence: expect.objectContaining({ search_status: 'did_not_search' }), flagged_turn_index: 1 })
    }));
    expect(r.filed.results[0]).toMatchObject({ ok: true, id: 77 });
    expect(d.callDaily.mock.calls[0][1].logCost).toBe(d.logCost);
  });
});

describe('24-hour outcome window', () => {
  const start = Date.parse('2026-10-13T17:00:00Z');
  const end = Date.parse('2026-10-13T18:00:00Z');
  const chat = { id: 1, company_id: 135, startMs: start, endMs: end };
  const at = (ms) => new Date(ms).toISOString();
  test('from the chat\'s first message to 24 hours after its last, both ends included', () => {
    const o = (events) => C.buildOutcomes([chat], events);
    expect(o({ opens: [{ company_id: 135, at: at(end + 24 * 3600e3), source: 'advisor' }] })).toMatchObject({ card_opened: 1, card_opened_from_chat: 1 });
    expect(o({ opens: [{ company_id: 135, at: at(end + 24 * 3600e3 + 1) }] }).card_opened).toBe(0);
    expect(o({ opens: [{ company_id: 135, at: at(start - 1) }] }).card_opened).toBe(0);
    expect(o({ opens: [{ company_id: 135, at: at(start) }] }).card_opened).toBe(1);
    expect(o({ saves: [{ company_id: 135, at: at(end + 3600e3) }], goals: [{ company_id: 135, at: at(end + 23 * 3600e3) }] }))
      .toMatchObject({ watchlist_save: 1, goal_created: 1, any: 1, share: { any: 100 } });
    // Another company's action doesn't count.
    expect(o({ opens: [{ company_id: 999, at: at(end) }] }).card_opened).toBe(0);
  });
  test('a chat with no company is counted but not in the share', () => {
    const o = C.buildOutcomes([chat, { id: 2, company_id: null, startMs: start, endMs: end }], { opens: [{ company_id: 135, at: at(end) }] });
    expect(o).toMatchObject({ chats: 2, linked_chats: 1, card_opened: 1, share: { card_opened: 100 } });
  });
  test('the SQL reads naive app timestamps as UTC', () => {
    expect(C.SAVES_AFTER_SQL).toContain("wg.created_at AT TIME ZONE 'UTC'");
    expect(C.GOALS_AFTER_SQL).toContain("created_at AT TIME ZONE 'UTC'");
  });
});

describe('chat search', () => {
  const messages = [
    { role: 'user', content: 'Do you have loan programs?' },
    { role: 'assistant', content: [{ type: 'text', text: 'Thinking about it.' }, use('s', 'search_grants', { query: 'microloan' })] },
    result('s', { results: [{ id: 5, grant_name: 'Microloan Fund' }] }),
    { role: 'assistant', content: [{ type: 'text', text: 'We cover grants; a Canada Small Business Financing loan is outside that.' }] }
  ];
  test('finds the word in client messages and in assistant text', () => {
    expect(C.searchHits(messages, 'LOAN')).toEqual({ client: 'Do you have loan programs?', assistant: expect.stringContaining('Financing loan') });
    expect(C.searchHits(messages, 'outside')).toMatchObject({ client: null, assistant: expect.stringContaining('outside') });
  });
  test('never matches tool calls or tool output', () => {
    expect(C.searchHits(messages, 'microloan')).toEqual({ client: null, assistant: null });
  });

  test('the SQL searches client strings and assistant text blocks, not the raw messages', async () => {
    const opsQuery = jest.fn(async () => ({ rows: [{ id: 289, user_id: 'user_x', updated_at: '2026-10-13T17:54:41Z', messages, cards_shown: false }] }));
    const appQuery = jest.fn(async (sql) => (/FROM companies/.test(sql) ? { rows: [{ id: 135, name: 'NYA Ventures' }] }
      : /users_clerk/.test(sql) ? { rows: [{ clerk_id: 'user_x', user_id: 1, company_id: 135, primary: true }] } : { rows: [] }));
    const r = await C.chatSearch({ q: 'loan', from: '2026-10-13', to: '2026-10-13', cards: 'none' },
      { opsQuery, appQuery, internalClerkIds: async () => new Set(['user_staff']), now: () => new Date('2026-10-19T20:00:00Z') });
    const [sql, params] = opsQuery.mock.calls[0];
    expect(sql).toContain("m->>'role' = 'user' AND jsonb_typeof(m->'content') = 'string' AND m->>'content' ILIKE $3");
    expect(sql).toContain("b->>'type' = 'text' AND b->>'text' ILIKE $3");
    expect(sql).not.toMatch(/messages::text/);
    expect(sql).toContain('AND NOT (EXISTS (SELECT 1 FROM chat_turns t');
    expect(params.slice(0, 4)).toEqual(['2026-10-13', '2026-10-13', '%loan%', ['user_staff']]);
    expect(r.results[0]).toMatchObject({ conversation_id: 289, client_snippet: 'Do you have loan programs?', cards_shown: false });
  });

  test('a word under 2 letters, or a backwards range, is refused', async () => {
    await expect(C.chatSearch({ q: 'a' })).rejects.toMatchObject({ status: 400 });
    await expect(C.chatSearch({ q: 'loan', from: '2026-10-10', to: '2026-10-01' }, { now: () => new Date() })).rejects.toMatchObject({ status: 400 });
  });
});

describe('sections from the stored rows', () => {
  const rows = [
    row({ conversation_id: 1, turn_index: 0, theme: 'Eligibility', unanswered_reason: 'no_answer', cards_shown: [5] }),
    row({ conversation_id: 2, turn_index: 3, theme: 'Eligibility', unanswered_reason: 'left_after_bad_reply', grants_named: [9] }),
    row({ conversation_id: 3, turn_index: 0, theme: 'Loans and financing', unanswered_reason: 'left_after_bad_reply' }),
    row({ conversation_id: 3, turn_index: 1, theme: 'Loans and financing', unanswered_reason: 'left_after_bad_reply' }),
    row({ conversation_id: 4, turn_index: 0, theme: 'Hiring and training', unmet_need: null })
  ];
  test('unanswered groups by theme, with left-after counts, chats and grants', () => {
    const g = C.buildUnanswered(rows);
    // Equal counts: more left-after first.
    expect(g.map((x) => [x.theme, x.count, x.left_after])).toEqual([['Loans and financing', 2, 2], ['Eligibility', 2, 1]]);
    expect(g[1].grants.sort()).toEqual([5, 9]);
    expect(g[0].chats).toHaveLength(1);
  });
  test('unmet needs group by label', () => {
    expect(C.buildUnmet(rows)).toEqual([expect.objectContaining({ need: 'Loans', count: 4, chats: 3 })]);
  });
  test('themes: current vs previous window and the weekly trend', () => {
    const t = C.buildThemes([...rows, row({ day: '2026-10-05', theme: 'Eligibility' })],
      { current: { from: '2026-10-07', to: '2026-10-13' }, previous: { from: '2026-09-30', to: '2026-10-06' }, trendWeeks: ['2026-10-05', '2026-10-12'] });
    expect(t[0]).toMatchObject({ theme: 'Eligibility', current: 2, previous: 1, delta: 1, weeks: [{ week: '2026-10-05', n: 1 }, { week: '2026-10-12', n: 2 }] });
    expect(C.mondayOf('2026-10-18')).toBe('2026-10-12');
  });
  test('internal accounts drop out of the clients variant, by company or Clerk id', () => {
    const keep = C.variants(new Set(['user_staff'])).clients;
    expect(keep({ company_id: 81 })).toBe(false); // an internal company
    expect(keep({ company_id: null, clerk_id: 'user_staff' })).toBe(false);
    expect(keep({ company_id: 135, clerk_id: 'user_x' })).toBe(true);
  });
});

describe('routes', () => {
  async function serve(overrides) {
    const app = express();
    app.use((req, res, next) => { req.user = { email: 'steph@granted.ca' }; next(); });
    app.use('/chat', createChatRouter(overrides));
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const b = `http://127.0.0.1:${server.address().port}/chat`;
    return { get: async (p) => { const r = await fetch(b + p); return { status: r.status, body: await r.json() }; }, close: () => new Promise((r) => server.close(r)) };
  }
  test('overview, search and transcript pass through; the viewer is the signed-in staff member', async () => {
    const s = await serve({
      chatOverview: jest.fn(async (range) => ({ range })),
      chatSearch: jest.fn(async (p) => p),
      chatTranscript: jest.fn(async (id, viewer) => ({ id, viewer }))
    });
    expect((await s.get('/?range=month')).body).toEqual({ range: 'month' });
    expect((await s.get('/search?q=loan&cards=none')).body).toMatchObject({ q: 'loan', cards: 'none' });
    expect((await s.get('/289')).body).toEqual({ id: '289', viewer: 'steph@granted.ca' });
    await s.close();
    const real = await serve({});
    expect((await real.get('/?range=decade')).status).toBe(400);
    expect((await real.get('/?range=2026-10-15..2026-09-01')).status).toBe(400);
    expect((await real.get('/search?q=a')).status).toBe(400);
    await real.close();
  });

  test('a custom range passes through to the overview', async () => {
    const chatOverview = jest.fn(async (range) => ({ range }));
    const s = await serve({ chatOverview });
    expect((await s.get('/?range=2026-09-01..2026-10-15')).body).toEqual({ range: '2026-09-01..2026-10-15' });
    await s.close();
  });
});

describe('chatOverview: theme changes only when the previous window was stored', () => {
  test('a previous window wholly after the first stored day compares', async () => {
    const storeQuery = jest.fn(async (sql) => {
      if (sql === C.QUESTIONS_SQL) return { rows: [] };
      if (sql === C.LAST_RUN_SQL) return { rows: [{ day: '2026-10-19' }] };
      if (sql === C.FIRST_DAY_SQL) return { rows: [{ day: '2026-09-21' }] };
      throw new Error('unexpected');
    });
    const out = await C.chatOverview('week', {
      storeQuery, opsQuery: async () => ({ rows: [] }), hubQuery: async () => ({ rows: [] }), appQuery: async () => ({ rows: [] }),
      internalClerkIds: async () => new Set(), now: () => new Date('2026-10-20T18:00:00Z'), noCache: true
    });
    expect(out.tracking).toEqual({ from: '2026-09-21', comparable: true });
    expect(C.FIRST_DAY_SQL).toMatch(/^SELECT min\(day\)/);
  });
});

describe('chatOverview on a custom range', () => {
  test('the window is from..to, the previous window the same length before it; themes compare the two', async () => {
    const storeQuery = jest.fn(async (sql) => {
      if (sql === C.QUESTIONS_SQL) return { rows: [
        row({ day: '2026-10-10', theme: 'Eligibility' }), row({ day: '2026-10-11', conversation_id: 2, theme: 'Eligibility' }),
        row({ day: '2026-09-25', conversation_id: 3, theme: 'Eligibility' })
      ] };
      if (sql === C.LAST_RUN_SQL) return { rows: [{ day: '2026-10-19' }] };
      if (sql === C.FIRST_DAY_SQL) return { rows: [{ day: '2026-09-21' }] };
      throw new Error('unexpected');
    });
    const out = await C.chatOverview('2026-10-01..2026-10-14', {
      storeQuery, opsQuery: async () => ({ rows: [] }), hubQuery: async () => ({ rows: [] }), appQuery: async () => ({ rows: [] }),
      internalClerkIds: async () => new Set(), now: () => new Date('2026-10-20T18:00:00Z'), noCache: true
    });
    expect(out.current).toEqual({ from: '2026-10-01', to: '2026-10-14' });
    expect(out.previous).toEqual({ from: '2026-09-17', to: '2026-09-30' });
    expect(out.themes[0]).toMatchObject({ theme: 'Eligibility', current: 2, previous: 1, delta: 1 });
    // Sep 17 – Sep 30 starts before the daily review's first day (Sep 21): no change is shown for themes.
    expect(out.tracking).toEqual({ from: '2026-09-21', comparable: false });
    await expect(C.chatOverview('2026-10-14..2026-10-01', { now: () => new Date('2026-10-20T18:00:00Z'), noCache: true }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('Oracle chat modes (the tab\'s own functions)', () => {
  const overview = {
    current: { from: '2026-09-20', to: '2026-10-19' }, store: { ok: true, last_run_day: '2026-10-18' },
    definitions: { outcome_hours: 24, unanswered: C.UNANSWERED_WORDS }, themes: [{ theme: 'Eligibility', current: 3, previous: 1, examples: [{ question: 'Am I eligible?', conversation_id: 7 }] }],
    companies: { 135: { name: 'NYA Ventures', internal: false } }, grants: { 5: 'Fund A' },
    clients_variant: {
      unanswered: [{ theme: 'Loans and financing', count: 2, left_after: 2, by_reason: { left_after_bad_reply: 2 }, grants: [5],
        chats: [{ conversation_id: 3, company_id: 135, day: '2026-10-13', questions: [{ question: 'Any loans?', reason: 'left_after_bad_reply' }] }] },
      { theme: 'Eligibility', count: 3, left_after: 0, by_reason: { no_answer: 3 }, grants: [], chats: [] }],
      unmet_needs: [{ need: 'Loans', count: 4, chats: 3, examples: [{ question: 'Any loans?', conversation_id: 3 }] }],
      outcomes: { chats: 10, linked_chats: 8, card_opened: 4, card_opened_from_chat: 2, watchlist_save: 1, goal_created: 0, any: 4,
        share: { card_opened: 50, card_opened_from_chat: 25, watchlist_save: 12.5, goal_created: 0, any: 50 } },
      health: { chats: 10 }, rule_cards: [{ id: 77, title: 'Funding ask, no grant cards shown — NYA Ventures', issue: 'no_cards_for_funding_ask', status: 'new', conversation_id: 289 }],
      grants_discussed: [{ grant_id: 5, carded: 3, mentioned_only: 1, chats: 2 }]
    },
    all_variant: { unanswered: [], unmet_needs: [], outcomes: {}, health: {}, rule_cards: [], grants_discussed: [] }
  };
  const deps = () => ({ env: { PUBLIC_URL: 'https://hub.test' }, chatOverview: jest.fn(async () => overview),
    chatSearch: jest.fn(async (p) => ({ q: p.q, from: '2026-09-20', to: '2026-10-19', cards: 'any', include_internal: false,
      results: [{ conversation_id: 289, company_id: 135, company_name: 'NYA Ventures', internal: false, last_active: '2026-10-13T17:54:41Z', cards_shown: false,
        client_snippet: 'What about loan programs', assistant_snippet: null }] })),
    latestDigest: jest.fn(async () => null) });
  const run = (input, d) => T.runControlCentre(input, { deps: d });

  test('the four modes are offered', () => {
    expect(T.CONTROL_CENTRE_MODES).toEqual(expect.arrayContaining(['unanswered', 'unmet_needs', 'chat_outcomes', 'chat_search']));
  });
  test('unanswered: groups in words with chat and grant links; sort by left after', async () => {
    const out = await run({ mode: 'unanswered', sort: 'left_after' }, deps());
    expect(out.groups[0]).toMatchObject({ theme: 'Loans and financing', left_after_bad_reply: 2,
      chats: [{ company: 'NYA Ventures', chat: 'https://hub.test/control-centre#chat/3', questions: [{ why: 'left after a bad reply' }] }],
      grants_involved: [{ grant: 'Fund A', link: 'https://hub.test/control-centre#grants/5' }] });
    expect(out.total).toBe(5);
  });
  test('unmet needs, outcomes and search', async () => {
    expect((await run({ mode: 'unmet_needs' }, deps())).needs[0]).toMatchObject({ need: 'Loans', questions: 4 });
    const o = await run({ mode: 'chat_outcomes' }, deps());
    expect(o.followed_by.grant_card_opened).toEqual({ chats: 4, share_pct: 50 });
    expect(o.new_card_types[0]).toMatchObject({ link: 'https://hub.test/control-centre#review/77', chat: 'https://hub.test/control-centre#chat/289' });
    const d = deps();
    const s = await run({ mode: 'chat_search', word: 'loan', cards: 'none' }, d);
    expect(d.chatSearch).toHaveBeenCalledWith(expect.objectContaining({ q: 'loan', cards: 'none', internal: false }));
    expect(s.results[0]).toMatchObject({ company: 'NYA Ventures', client_wrote: 'What about loan programs', chat: 'https://hub.test/control-centre#chat/289' });
  });
  test('chat_themes with a range adds the daily themes', async () => {
    const out = await run({ mode: 'chat_themes', range: 'month' }, deps());
    expect(out.daily_themes.themes[0]).toMatchObject({ theme: 'Eligibility', questions: 3, examples: [{ chat: 'https://hub.test/control-centre#chat/7' }] });
  });
});
