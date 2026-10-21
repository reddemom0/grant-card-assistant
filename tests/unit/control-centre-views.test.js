/**
 * control-centre Department views: each item's shaping (headline, counts, at
 * most five rows, See all), the internal-accounts variants, a failing source
 * failing only its own items, reads only, and the route. Fixtures and
 * injected deps only — no DB, no network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-views.test.js
 */

import { jest } from '@jest/globals';
import express from 'express';

const V = await import('../../src/control-centre/views.js');
const { createViewsRouter } = await import('../../src/control-centre/views-routes.js');

beforeEach(() => { V._clearCacheForTests(); jest.spyOn(console, 'error').mockImplementation(() => {}); });

const internal = (id) => id === 81;
const rowsOf = (b) => b.groups.flatMap((g) => g.rows);

describe('capRows', () => {
  test('at most five rows across groups, handed out in turn', () => {
    const g = (n) => ({ title: 't', rows: Array.from({ length: n }, (_, i) => ({ title: String(i) })), see_all: { label: 'x', hash: '#x' } });
    expect(V.capRows([g(10)]).map((x) => x.rows.length)).toEqual([5]);
    expect(V.capRows([g(10), g(10)]).map((x) => x.rows.length)).toEqual([3, 2]);
    expect(V.capRows([g(10), g(10), g(10)]).map((x) => x.rows.length)).toEqual([2, 2, 1]);
    expect(V.capRows([g(1), g(10)]).map((x) => x.rows.length)).toEqual([1, 4]);
    expect(V.capRows([g(0), g(2)]).map((x) => x.rows.length)).toEqual([0, 2]);
  });
});

describe('Research', () => {
  test('deadline hygiene: passed headline, due in 90 days and blank/unreadable counts, rolling as a sub-line', () => {
    const grants = [
      { root_id: 1, title: 'Old', deadline: '2026-10-01' }, { root_id: 2, title: 'Soon', deadline: '2026-12-01' },
      { root_id: 3, title: 'Blank', deadline: '' }, { root_id: 4, title: 'Rolling', deadline: 'Open Until Filled' },
      { root_id: 5, title: 'Odd', deadline: 'Spring intake' }
    ];
    const it = V.deadlineItem(grants, '2026-10-21');
    expect(it.clients).toBe(it.all);
    expect(it.clients.headline).toEqual({ n: 1, words: 'live grants past their deadline' });
    expect(it.clients.counts.map((c) => c.n)).toEqual([1, 2]);
    expect(it.clients.sub).toMatch(/^1 grant with a rolling deadline/);
    expect(rowsOf(it.clients)).toEqual([
      { title: 'Old', meta: 'Deadline was Oct 1, 2026', hash: '#grants/1' },
      { title: 'Soon', meta: 'Due Dec 1, 2026', hash: '#grants/2' },
      { title: 'Blank', meta: 'Blank', hash: '#grants/3' },
      { title: 'Odd', meta: 'Says "Spring intake"', hash: '#grants/5' }
    ]);
  });

  const items = [
    { id: '1', kind: 'grant_pattern', owner: 'research', status: 'diagnosed', grant_name: 'Green Corps', pattern_category: 'wrong_industry', stuck: true, idle_days: 6, company_id: null },
    { id: '2', kind: 'match', owner: 'research', status: 'new', grant_name: 'Voucher', company_id: 81, company_name: 'Maximizer', stuck: true, idle_days: 4 },
    { id: '3', kind: 'match', owner: 'research', status: 'closed', grant_name: 'Closed one', company_id: 83, stuck: false },
    { id: '4', kind: 'chat', owner: 'chris', status: 'new', company_id: 83, stuck: true, idle_days: 9 }
  ];

  test('cards that look wrong: open Research cards (internal left out by default) and most-ignored grants', () => {
    const ignored = { clients: [{ grant_id: 9, title: 'Ignored', ignored: 4, displayed_clients: 5 }], all: [] };
    const it = V.cardsLookWrongItem(items, ignored, internal);
    expect(it.clients.headline.n).toBe(1);
    expect(it.all.headline.n).toBe(2);
    expect(it.clients.groups[0].rows[0]).toEqual({ title: 'Green Corps — cut for several companies (wrong industry)', meta: 'Grant pattern · diagnosed', hash: '#review/1' });
    expect(it.clients.groups[1].rows[0]).toMatchObject({ title: 'Ignored', meta: '4 of 5 clients never opened it', hash: '#grants/9' });
    expect(it.clients.groups.map((g) => g.see_all.hash)).toEqual(['#review?owner=research', '#grants?view=most_ignored']);
  });

  test('stuck: open Research cards with no activity for 3+ days, longest first', () => {
    const it = V.stuckItem(items, internal);
    expect(rowsOf(it.all).map((r) => r.hash)).toEqual(['#review/1', '#review/2']);
    expect(rowsOf(it.clients).map((r) => r.meta)).toEqual(['No activity for 6 days · diagnosed']);
  });

  test('coverage gaps: thin rows (mains and specifics) and grants matching no one', () => {
    const variant = { industries: [
      { industry: 'Agriculture', thin: true, avg_matches: 1.5, ran_matching: 2, clients: 3, specifics: [
        { industry: 'Aquaculture', thin: true, avg_matches: 0.5, ran_matching: 2, clients: 2 }] },
      { industry: 'Energy', thin: false, avg_matches: 9, ran_matching: 4, clients: 4, specifics: [] }
    ] };
    const it = V.coverageGapsItem({ clients_variant: variant, all_variant: variant }, { clients: [{ grant_id: 7, title: 'Nobody', last_matched: null }], all: [] });
    expect(it.clients.headline.n).toBe(2);
    expect(it.clients.groups[0].rows.map((r) => r.title)).toEqual(['Aquaculture', 'Agriculture']);
    expect(it.clients.groups[0].rows[0].hash).toBe('#coverage/industry/Aquaculture');
    expect(it.clients.groups[1].rows[0]).toMatchObject({ meta: 'Never matched', hash: '#grants/7' });
    expect(it.all.counts[0].n).toBe(0);
  });
});

describe('Consulting/Sales', () => {
  test('quiet clients: matches and no client action for 14+ days; shown matches but no opens', () => {
    const list = { current: { from: '2026-09-22', to: '2026-10-21' }, companies: [
      { id: 83, name: 'Quiet', last_active: '2026-10-01', grant_matches: 4, cards_opened: 2 },
      { id: 84, name: 'Busy', last_active: '2026-10-20', grant_matches: 3, cards_opened: 0 },
      { id: 85, name: 'Edge', last_active: '2026-10-07', grant_matches: 1, cards_opened: 0 },
      { id: 86, name: 'No matches', last_active: '2026-01-01', grant_matches: 0, cards_opened: 0 },
      { id: 81, name: 'Internal', last_active: '2026-01-01', grant_matches: 5, cards_opened: 0 }
    ] };
    const it = V.quietClientsItem(list, internal);
    expect(it.clients.headline.n).toBe(2); // 83, and 85 exactly 14 days back
    expect(it.clients.groups[0].rows.map((r) => r.title)).toEqual(['Quiet', 'Edge']);
    expect(it.clients.counts[0].n).toBe(2); // 84, 85
    expect(it.all.headline.n).toBe(3);
    expect(it.clients.groups[0].see_all).toEqual({ label: 'Companies, least recently active', hash: '#companies?sort=last_active&dir=asc', range: 'month' });
  });

  test('paid work: unanswered and unmet grouped by company; internal by company or Clerk id', () => {
    const rows = [
      { company_id: 83, clerk_id: 'user_a', question: 'Can you write my CanExport application?', unanswered_reason: 'no_answer', unmet_need: 'application writing' },
      { company_id: 83, clerk_id: 'user_a', question: 'Second', unanswered_reason: 'no_answer', unmet_need: null },
      { company_id: 81, clerk_id: 'user_m', question: 'Internal', unanswered_reason: 'no_answer', unmet_need: null },
      { company_id: null, clerk_id: 'user_staff', question: 'Staff test', unanswered_reason: null, unmet_need: 'x' },
      { company_id: null, clerk_id: 'user_z', question: 'Unknown', unanswered_reason: 'no_answer', unmet_need: null }
    ];
    const it = V.paidWorkItem(rows, new Map([[83, 'NYA Ventures']]), new Set(['user_staff']), internal);
    expect(it.clients.headline.n).toBe(1);
    expect(it.clients.counts.map((c) => c.n)).toEqual([3, 1]);
    expect(it.clients.groups[0].rows[0]).toEqual({ title: 'NYA Ventures', meta: '2 unanswered questions · 1 unmet need (application writing)',
      detail: '“Can you write my CanExport application?”', hash: '#companies/83' });
    expect(it.clients.groups[0].rows[1]).toMatchObject({ title: 'Company not recorded', hash: '#chat' });
    expect(it.all.headline.n).toBe(2);
  });

  test('new grants: clients reached by the industry tag; open to all = every client; untagged says so', () => {
    expect(V.clientsForGrant({ level: 'agnostic', tokens: [] }, [{ industries: [] }, { industries: [] }])).toEqual({ n: 2, open_to_all: true });
    expect(V.clientsForGrant({ level: null }, [])).toBeNull();
    expect(V.clientsForGrant(undefined, [])).toBeNull();
    const cov = {
      grants: { 1: { level: 'agnostic', tokens: [] }, 2: { level: null, tokens: [] } },
      clients: { 83: { internal: false, industries: [] }, 81: { internal: true, industries: [] } }
    };
    const changed = { added: [{ grant_id: 2, title: 'Untagged', at: '2026-10-20T10:00:00Z' }, { grant_id: 1, title: 'Open', at: '2026-10-19T10:00:00Z' }] };
    const it = V.newGrantsItem(changed, cov);
    expect(it.clients.headline.n).toBe(2);
    expect(rowsOf(it.clients).map((r) => r.meta)).toEqual(['Went live Oct 19, 2026 · open to every industry, all 1 client', 'Went live Oct 20, 2026 · industry not tagged yet']);
    expect(rowsOf(it.all)[0].meta).toMatch(/all 2 clients/);
  });
});

describe('Marketing', () => {
  const chat = {
    store: { ok: true },
    themes: [{ theme: 'Hiring', current: 4, examples: [{ question: 'Wage subsidies for a junior dev?' }] }, { theme: 'Old', current: 0, examples: [] }],
    grants: { 12: 'CanExport SMEs' },
    clients_variant: { unanswered: [{ count: 3 }], unmet_needs: [{ count: 1 }], grants_discussed: [{ grant_id: 12, chats: 2, carded: 2, mentioned_only: 0 }] },
    all_variant: { unanswered: [{ count: 3 }, { count: 2 }], unmet_needs: [], grants_discussed: [] }
  };

  test('asked: unanswered and unmet totals, themes with an example', () => {
    const it = V.askedItem(chat);
    expect(it.clients.headline.n).toBe(3);
    expect(it.all.headline.n).toBe(5);
    expect(rowsOf(it.clients)).toEqual([{ title: 'Hiring', meta: '4 questions', detail: '“Wage subsidies for a junior dev?”', hash: '#chat' }]);
    expect(V.askedItem({ ...chat, store: { ok: false }, themes: [] }).clients.sub).toMatch(/isn't set up/);
  });

  test('engagement: most opened with how it was found, discussed in chat, shown never opened', () => {
    const win = {
      days: ['2026-10-20', '2026-10-21'], grants: [{ root_id: 12, title: 'CanExport SMEs' }, { root_id: 13, title: 'Voucher' }],
      matches: [], views: [
        { day: '2026-10-21', company_id: 83, grant_root_id: 12, source: 'suggested', sessions: 3 },
        { day: '2026-10-21', company_id: 83, grant_root_id: 12, source: 'advisor', sessions: 1 },
        { day: '2026-10-21', company_id: 81, grant_root_id: 13, source: 'browse', sessions: 2 }
      ],
      sessions: [], adds: [], removals: [], openedPairs: new Set(), lastShown: [], openCards: new Map()
    };
    const sources = V.sourcesByGrant(win.views, (id) => !internal(id));
    expect(V.foundWords(sources.get(12))).toBe('found through Goal tracks (3), Chat (1)');
    expect(sources.has(13)).toBe(false);
    const it = V.engagementItem(win, chat, internal);
    expect(it.clients.groups[1].rows[0]).toMatchObject({ title: 'CanExport SMEs', meta: '2 chats · found through Goal tracks (3), Chat (1)', hash: '#grants/12' });
    expect(it.clients.groups.map((g) => g.title)).toEqual(['Most opened', 'Most discussed in chat', 'Shown, never opened']);
    expect(rowsOf(it.clients).length).toBeLessThanOrEqual(V.MAX_ROWS);
  });

  test("don't line up: many industry grants and few clients, and the reverse; open-to-all and general rows left out", () => {
    const variant = { industries: [
      { industry: 'Fisheries', restricted: 5, clients: 0, specifics: [{ industry: 'Fisheries, general', general: true, restricted: 9, clients: 0 }] },
      { industry: 'Retail', restricted: 1, clients: 6, specifics: [] },
      { industry: 'Energy', restricted: 4, clients: 4, specifics: [] }
    ] };
    const it = V.mismatchItem({ clients_variant: variant, all_variant: variant });
    expect(it.clients.headline.n).toBe(2);
    expect(it.clients.groups[0].rows).toEqual([{ title: 'Fisheries', meta: '5 industry grants · 0 clients', hash: '#coverage/industry/Fisheries' }]);
    expect(it.clients.groups[1].rows[0].title).toBe('Retail');
  });

  test('what changed this week: one line', () => {
    const it = V.changedLine({ added: [1], closed: [], removed: [1, 2], edited: [1] });
    expect(it.clients.line).toBe('This week: 1 went live, 0 closed, 2 removed, 1 grant edited.');
  });
});

describe('departmentViews', () => {
  const deps = () => ({
    now: () => new Date('2026-10-21T18:00:00Z'),
    appQuery: jest.fn(async () => ({ rows: [] })),
    storeQuery: jest.fn(async () => ({ rows: [] })),
    liveGrants: jest.fn(async () => [{ root_id: 1, title: 'Old', deadline: '2026-01-01' }]),
    coverage: jest.fn(async () => { const e = new Error('nc'); e.code = 'not_configured'; throw e; }),
    changes: jest.fn(async () => ({ added: [], closed: [], removed: [], edited: [] })),
    loadGrantWindow: jest.fn(async () => ({ days: [], grants: [], matches: [], views: [], sessions: [], adds: [], removals: [], openedPairs: new Set(), lastShown: [], openCards: new Map() })),
    chatOverview: jest.fn(async () => { const e = new Error('missing'); e.code = '42P01'; throw e; }),
    listItems: jest.fn(async () => []),
    companyList: jest.fn(async () => ({ current: { from: '2026-09-22', to: '2026-10-21' }, companies: [] })),
    internalClerkIds: async () => new Set(),
    isInternal: internal
  });

  test('three departments; a failing source fails only its items; reads only; cached per range', async () => {
    const d = deps();
    const out = await V.departmentViews('week', d);
    expect(Object.keys(out.departments)).toEqual(['research', 'consulting', 'marketing']);
    const byKey = Object.fromEntries(Object.values(out.departments).flat().map((i) => [i.key, i]));
    expect(byKey.deadlines.clients.headline.n).toBe(1);
    expect(byKey.coverage_gaps.error).toBe('not_configured');
    expect(byKey.new_grants.error).toBe('not_configured');
    expect(byKey.mismatch.error).toBe('not_configured');
    expect(byKey.asked.error).toBe('migration_missing');
    expect(byKey.engagement.error).toBe('migration_missing');
    expect(byKey.quiet_clients.clients.headline.n).toBe(0);
    expect(byKey.changed.clients.line).toMatch(/^This week: 0 went live/);
    for (const it of Object.values(byKey)) expect(typeof it.label).toBe('string');
    expect(d.storeQuery).toHaveBeenCalledWith(V.CHAT_SIGNALS_SQL, ['2026-10-15', '2026-10-21']);
    expect(d.changes).toHaveBeenCalledWith('week');
    expect(d.companyList).toHaveBeenCalledWith('month');
    expect(d.listItems).toHaveBeenCalledWith({ owner: 'research' });
    for (const q of [d.appQuery, d.storeQuery]) expect(q.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
    // A response with a failed item isn't cached: the next load tries again.
    await V.departmentViews('week', d);
    expect(d.liveGrants).toHaveBeenCalledTimes(2);
    await expect(V.departmentViews('decade', d)).rejects.toMatchObject({ status: 400 });
  });

  test('the window readers run one after another; a clean load is cached per range', async () => {
    const d = deps();
    const order = [];
    const slow = (name, value) => jest.fn(async () => { order.push(`${name}:start`); await new Promise((r) => setTimeout(r, 5)); order.push(`${name}:end`); return value; });
    const variant = { unanswered: [], unmet_needs: [], grants_discussed: [], industries: [] };
    d.coverage = slow('coverage', { clients_variant: variant, all_variant: variant, grants: {}, clients: {} });
    d.loadGrantWindow = slow('window', { days: [], grants: [], matches: [], views: [], sessions: [], adds: [], removals: [], openedPairs: new Set(), lastShown: [], openCards: new Map() });
    d.companyList = slow('companies', { current: { from: '2026-09-22', to: '2026-10-21' }, companies: [] });
    d.chatOverview = slow('chat', { store: { ok: true }, themes: [], grants: {}, clients_variant: variant, all_variant: variant });
    const out = await V.departmentViews('week', d);
    expect(Object.values(out.departments).flat().filter((i) => i.error)).toEqual([]);
    expect(order).toEqual(['coverage:start', 'coverage:end', 'window:start', 'window:end', 'companies:start', 'companies:end', 'chat:start', 'chat:end']);
    await V.departmentViews('week', d);
    expect(d.coverage).toHaveBeenCalledTimes(1);
  });

  test('a custom range is its own window; a bad one is a 400', async () => {
    const d = deps();
    const out = await V.departmentViews('2026-09-01..2026-10-15', d);
    expect(out).toMatchObject({ range: '2026-09-01..2026-10-15', current: { from: '2026-09-01', to: '2026-10-15' } });
    expect(d.coverage).toHaveBeenCalledWith('2026-09-01..2026-10-15');
    expect(d.storeQuery).toHaveBeenCalledWith(V.CHAT_SIGNALS_SQL, ['2026-09-01', '2026-10-15']);
    await expect(V.departmentViews('2026-10-15..2026-09-01', d)).rejects.toMatchObject({ status: 400 });
    await expect(V.departmentViews('2026-10-01..2026-10-30', d)).rejects.toMatchObject({ status: 400 }); // ends after today
  });

  test('no write SQL in the module', () => {
    const sql = Object.values(V).filter((v) => typeof v === 'string' && /\bSELECT\b/i.test(v));
    expect(sql.length).toBeGreaterThan(0);
    for (const s of sql) expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
  });
});

describe('routes', () => {
  const call = async (router, path) => {
    const app = express();
    app.use('/v', router);
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/v${path}`);
      return { status: res.status, body: await res.json() };
    } finally { server.close(); }
  };

  test('passes the range through; 400 bad range; 503 not configured; 500 otherwise', async () => {
    const departmentViews = jest.fn(async (range) => ({ range }));
    expect(await call(createViewsRouter({ departmentViews }), '/?range=month')).toEqual({ status: 200, body: { range: 'month' } });
    expect(departmentViews).toHaveBeenCalledWith('month');
    await call(createViewsRouter({ departmentViews }), '/');
    expect(departmentViews).toHaveBeenLastCalledWith('week');
    expect((await call(createViewsRouter(), '/?range=decade')).status).toBe(400);
    const nc = Object.assign(new Error('x'), { code: 'not_configured' });
    expect(await call(createViewsRouter({ departmentViews: async () => { throw nc; } }), '/')).toEqual({ status: 503, body: { error: 'not_configured' } });
    expect((await call(createViewsRouter({ departmentViews: async () => { throw new Error('boom'); } }), '/')).status).toBe(500);
  });
});
