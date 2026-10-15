/**
 * control-centre Grants tab: the per-grant counts (clients matched, displayed,
 * shown but never opened, bounces at the 3-second line, saves, removals, AI
 * cuts), the three views (the minimum of 3 for Most ignored, "Never" for Not
 * matching anyone), the internal split, the page's goal tracks / trend / edits,
 * and the routes. Fixtures and injected deps only — no DB, no network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-grants.test.js
 */

import { jest } from '@jest/globals';
import express from 'express';

const G = await import('../../src/control-centre/grants.js');
const { createGrantsRouter } = await import('../../src/control-centre/grants-routes.js');
const O = await import('../../src/control-centre/overview.js');

beforeEach(() => { G._clearCacheForTests(); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

const INTERNAL = new Set([81]);
const isInternal = (id) => INTERNAL.has(id);
const DAYS = ['2026-10-13', '2026-10-14', '2026-10-15'];
const live = (id, title = `Grant ${id}`) => ({ root_id: id, title, grantor: 'Funder' });
const shown = (day, company, grant, extra = {}) => ({ day, company_id: company, grant_id: grant, section: 'Hire or Train People', times_computed: 1, times_shown: 1, ai_review_action: null, ...extra });
const base = (over = {}) => ({
  days: DAYS, grants: [], matches: [], views: [], sessions: [], adds: [], removals: [], lastShown: [],
  openedPairs: new Set(), openCards: new Map(), ...over
});
const row = (list, id) => list.find((r) => r.grant_id === id);

describe('counts', () => {
  test('bounce threshold: under 3000 ms visible is a bounce, 3000 ms is not', () => {
    expect(G.BOUNCE_MS).toBe(3000);
    const input = base({
      grants: [live(1)],
      sessions: [
        { day: '2026-10-14', company_id: 135, grant_root_id: 1, visible_ms: 2999 },
        { day: '2026-10-14', company_id: 135, grant_root_id: 1, visible_ms: 3000 },
        { day: '2026-10-14', company_id: 135, grant_root_id: 1, visible_ms: 0 },
        { day: '2026-10-01', company_id: 135, grant_root_id: 1, visible_ms: 100 }   // outside the window
      ]
    });
    expect(row(G.buildGrantList(input, { isInternal }).clients, 1).bounced).toBe(2);
  });

  test('clients matched counts engine-shown (cut included); displayed and never-opened leave cuts out', () => {
    const input = base({
      grants: [live(1)],
      matches: [
        shown('2026-10-14', 135, 1),
        shown('2026-10-14', 136, 1, { ai_review_action: 'cut' }),
        shown('2026-10-15', 137, 1, { times_shown: 0 })            // considered, not shown
      ]
    });
    const r = row(G.buildGrantList(input, { isInternal }).clients, 1);
    expect(r).toMatchObject({ clients_matched: 2, displayed_clients: 1, ignored: 1, cuts: 1, last_matched: '2026-10-14' });
  });

  test('shown but never opened: an open at any time clears it, and displays before open tracking began never count', () => {
    const input = base({
      days: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'],
      grants: [live(1)],
      matches: [
        shown('2026-09-08', 135, 1),          // before OPENS_TRACKED_FROM: unknowable
        shown('2026-09-09', 136, 1),          // never opened
        shown('2026-09-10', 137, 1)           // opened (before or after — any time)
      ],
      openedPairs: new Set(['137|1'])
    });
    expect(G.OPENS_TRACKED_FROM).toBe('2026-09-09');
    expect(row(G.buildGrantList(input, { isInternal }).clients, 1)).toMatchObject({ displayed_clients: 3, ignored: 1 });
  });

  test('opens, saves and removals in the window only; open review cards from the Hub map', () => {
    const input = base({
      grants: [live(1)],
      views: [{ day: '2026-10-14', company_id: 135, grant_root_id: 1, sessions: 3 }, { day: '2026-10-01', company_id: 135, grant_root_id: 1, sessions: 9 }],
      adds: [{ day: '2026-10-15', company_id: 135, grant_root_id: 1 }],
      removals: [{ day: '2026-10-15', company_id: 135, grant_root_id: 1 }, { day: '2026-10-15', company_id: null, grant_root_id: 1 }],
      openCards: new Map([[1, 2]])
    });
    expect(row(G.buildGrantList(input, { isInternal }).clients, 1)).toMatchObject({ opens: 3, saves: 1, removed: 2, open_cards: 2 });
  });

  test('internal split: the clients variant drops internal accounts from every count', () => {
    const input = base({
      grants: [live(1)],
      matches: [shown('2026-10-14', 135, 1), shown('2026-10-14', 81, 1)],
      views: [{ day: '2026-10-14', company_id: 81, grant_root_id: 1, sessions: 4 }],
      sessions: [{ day: '2026-10-14', company_id: 81, grant_root_id: 1, visible_ms: 10 }],
      adds: [{ day: '2026-10-14', company_id: 81, grant_root_id: 1 }],
      lastShown: [{ grant_id: 1, company_id: 81, day: '2026-10-15' }]
    });
    const out = G.buildGrantList(input, { isInternal });
    expect(row(out.clients, 1)).toMatchObject({ clients_matched: 1, opens: 0, bounced: 0, saves: 0, ignored: 1, last_matched: '2026-10-14' });
    expect(row(out.all, 1)).toMatchObject({ clients_matched: 2, opens: 4, bounced: 1, saves: 1, ignored: 2, last_matched: '2026-10-15' });
  });
});

describe('views', () => {
  test('most ignored: only grants displayed to at least 3 clients, most ignored first', () => {
    expect(G.MIN_IGNORED_CLIENTS).toBe(3);
    const input = base({
      grants: [live(1, 'Three'), live(2, 'Two'), live(3, 'Four')],
      matches: [
        ...[135, 136, 137].map((c) => shown('2026-10-14', c, 1)),
        ...[135, 136].map((c) => shown('2026-10-14', c, 2)),
        shown('2026-10-14', 137, 2, { ai_review_action: 'cut' }),      // cut: not displayed, doesn't reach 3
        ...[135, 136, 137, 138].map((c) => shown('2026-10-14', c, 3))
      ],
      openedPairs: new Set(['135|1', '136|1'])
    });
    const list = G.buildGrantList(input, { view: 'most_ignored', isInternal }).clients;
    expect(list.map((r) => [r.grant_id, r.displayed_clients, r.ignored])).toEqual([[3, 4, 4], [1, 3, 1]]);
  });

  test('not matching anyone: zero clients matched in the range, longest since the last match first, "Never" before all', () => {
    const input = base({
      grants: [live(1, 'Matched now'), live(2, 'Last in Sept'), live(3, 'Never'), live(4, 'Last in Oct')],
      matches: [shown('2026-10-14', 135, 1), shown('2026-10-01', 135, 4)],
      lastShown: [{ grant_id: 2, company_id: 135, day: '2026-09-02' }, { grant_id: 4, company_id: 135, day: '2026-09-20' }]
    });
    const list = G.buildGrantList(input, { view: 'not_matching', isInternal }).clients;
    expect(list.map((r) => [r.grant_id, r.last_matched])).toEqual([[3, null], [2, '2026-09-02'], [4, '2026-10-01']]);
    expect(G.lastMatchedWords(list[0].last_matched)).toBe('Never');
  });

  test('a grant matched only to an internal account is "not matching" for clients, not with internal accounts', () => {
    const input = base({ grants: [live(1)], matches: [shown('2026-10-14', 81, 1)] });
    const out = G.buildGrantList(input, { view: 'not_matching', isInternal });
    expect(out.clients.map((r) => [r.grant_id, r.last_matched])).toEqual([[1, null]]);
    expect(out.all).toEqual([]);
  });

  test('all: every live grant, most clients matched first', () => {
    const input = base({ grants: [live(1, 'B'), live(2, 'A')], matches: [shown('2026-10-14', 135, 1)] });
    expect(G.buildGrantList(input, { isInternal }).clients.map((r) => r.grant_id)).toEqual([1, 2]);
  });
});

describe('the page pieces', () => {
  test('goal tracks: companies per track, All goals last, internal after clients, the AI review reason', () => {
    const matches = [
      shown('2026-10-14', 135, 1, { section: 'funding_matches', best_position: 4 }),
      shown('2026-10-13', 135, 1, { best_position: 2, eligibility: 'Likely' }),
      shown('2026-10-14', 135, 1, { best_position: 5, ai_review_action: 'cut' }),
      shown('2026-10-14', 81, 1)
    ];
    const reviews = [{ company_id: 135, section: 'Hire or Train People', action: 'cut', category: 'wrong_region', reason: 'Ontario only.' }];
    const names = new Map([[135, 'NYA Ventures'], [81, 'Maximizer']]);
    const t = G.buildTracks(matches, reviews, names, { isInternal });
    expect(t.map((x) => x.label)).toEqual(['Hire or Train People', 'All goals']);
    expect(t[0].companies.map((c) => [c.company_name, c.internal])).toEqual([['NYA Ventures', false], ['Maximizer', true]]);
    expect(t[0].companies[0]).toMatchObject({ days: 2, last_day: '2026-10-14', best_position: 2, displayed: true,
      ai_review: { action: 'cut', reason: 'Ontario only.' } });
    expect(t[0].companies[0].ai_review.words).toMatch(/^AI review cut it/);
  });

  test('trend: one point per day; never-opened lands on the first day it was displayed', () => {
    const input = base({
      matches: [shown('2026-10-14', 135, 1), shown('2026-10-15', 135, 1), shown('2026-10-15', 81, 1)],
      views: [{ day: '2026-10-15', company_id: 136, grant_root_id: 1, sessions: 2 }],
      sessions: [{ day: '2026-10-15', company_id: 136, grant_root_id: 1, visible_ms: 1200 }]
    });
    const t = G.engagementTrend(input, 1, { isInternal });
    expect(t.clients.map((d) => [d.day, d.opens, d.bounces, d.ignored])).toEqual([
      ['2026-10-13', 0, 0, 0], ['2026-10-14', 0, 0, 1], ['2026-10-15', 2, 1, 0]]);
    expect(t.all.find((d) => d.day === '2026-10-15').ignored).toBe(1);
  });

  test('edits in words: versions by number, HTML stripped and clipped, tag syncs as counts, no names', () => {
    const e = G.shapeEdits([
      { id: 3, created_at: '2026-10-13T16:57:43Z', action: 'version.publish', previous_value: '3777', new_value: '3779', user_id: 126, role: 'Starter', email: 'a@granted.ca' },
      { id: 2, created_at: '2026-10-13T16:55:51Z', action: 'field.save', previous_value: '<p><b>Up to</b>&nbsp;75%</p>', new_value: 'x'.repeat(500), user_id: 3, role: null, email: null },
      { id: 1, created_at: '2026-10-13T15:58:59Z', action: 'tags.sync', previous_value: '{"versionId":1,"tagIds":[1,2]}', new_value: '{"versionId":2,"tagIds":[1,2,3]}', user_id: 3 }
    ]);
    expect(e[0]).toMatchObject({ what: 'Published a version', before: 'version 3777', after: 'version 3779', who: { user_id: 126, email: 'a@granted.ca' } });
    expect(e[1].before).toBe('Up to 75%');
    expect(e[1].after).toHaveLength(200);
    expect(e[2]).toMatchObject({ what: 'Synced tags', before: '2 tags', after: '3 tags' });
  });
});

// A fake world: the Overview's window loader reads these; everything else is ours.
function deps({ grants = [live(1196, 'Agricultural Clean Technology'), live(5)], rolled = [] } = {}) {
  const hubQuery = jest.fn(async (sql, params) => {
    if (sql === O.LAST_ROLLED_SQL) return { rows: [{ day: '2026-10-14' }] };
    if (sql === O.ROLLED_MATCHES_SQL) return { rows: rolled };
    if (sql === G.OPEN_CARDS_BY_GRANT_SQL) return { rows: [{ grant_root_id: 1196, n: 2 }] };
    if (sql === G.GRANT_CARDS_SQL) return { rows: [{ id: '7', kind: 'grant_pattern', status: 'new', grant_root_id: params[0], grant_name: 'Agricultural Clean Technology', pattern_category: 'wrong_region', flag_count: 3 }] };
    if (/FROM gg3_grants/.test(sql)) return { rows: [{ id: params[0], grant_name: 'Agricultural Clean Technology', regions: ['Canada'], industries: ['Agriculture'], field_content: { eligibility: '<p>Farmers only</p>' } }] };
    return { rows: [] };
  });
  const appQuery = jest.fn(async (sql) => {
    if (sql === G.EDITS_SQL) return { rows: [{ id: 1, created_at: '2026-09-29T18:12:27Z', action: 'version.fork', previous_value: '3681', new_value: '3682', user_id: 3 }] };
    if (/FROM companies/.test(sql) && /name/.test(sql)) return { rows: [{ id: 135, name: 'NYA Ventures' }] };
    return { rows: [] };
  });
  return {
    hubQuery, appQuery, opsQuery: jest.fn(async () => ({ rows: [] })),
    readDay: jest.fn(async () => ({ matches: [], reviews: [], views: [], ratings: [] })),
    liveGrants: jest.fn(async () => grants),
    now: () => new Date('2026-10-15T20:00:00Z'),
    noCache: true
  };
}

describe('grantList / grantPage', () => {
  test('list: both variants, the definitions, the window', async () => {
    const d = deps({ rolled: [shown('2026-10-14', 135, 1196)] });
    const l = await G.grantList('week', 'all', d);
    expect(l).toMatchObject({ range: 'week', view: 'all', live_grants: 2, current: { from: '2026-10-09', to: '2026-10-15' },
      definitions: { bounce_ms: 3000, min_ignored_clients: 3, opens_tracked_from: '2026-09-09' } });
    expect(l.clients[0]).toMatchObject({ grant_id: 1196, clients_matched: 1, open_cards: 2 });
    expect(row(l.clients, 5).last_matched).toBeNull();
  });

  test('bad view or range → 400; a grant with no live version → 404', async () => {
    await expect(G.grantList('week', 'popular', deps())).rejects.toMatchObject({ status: 400 });
    await expect(G.grantList('fortnight', 'all', deps())).rejects.toMatchObject({ status: 400 });
    await expect(G.grantPage('999', 'week', deps())).rejects.toMatchObject({ status: 404 });
    await expect(G.grantPage('abc', 'week', deps())).rejects.toMatchObject({ status: 400 });
  });

  test('page: tracks, tags beside card text, edits, review cards with links', async () => {
    const d = deps({ rolled: [shown('2026-10-14', 135, 1196)] });
    const p = await G.grantPage('1196', 'week', d);
    expect(p.grant).toMatchObject({ root_id: 1196, link: expect.stringMatching(/#grants\/1196$/) });
    expect(p.tracks[0].companies[0]).toMatchObject({ company_id: 135, company_name: 'NYA Ventures' });
    expect(p.tags).toMatchObject({ regions: ['Canada'], card: [{ section: 'Eligibility', text: 'Farmers only' }] });
    expect(p.edits[0]).toMatchObject({ what: 'Started a new draft' });
    expect(p.cards[0]).toMatchObject({ id: 7, title: expect.stringMatching(/cut for several companies/), link: expect.stringMatching(/#review\/7$/) });
    expect(p.trend.clients).toHaveLength(7);
  });

  test('reads only: no write statement anywhere in the module', () => {
    const writes = Object.entries(G).filter(([, v]) => typeof v === 'string' && /\b(INSERT|UPDATE|DELETE)\b/.test(v)).map(([k]) => k);
    expect(writes).toEqual([]);
  });
});

describe('routes', () => {
  async function serve(overrides) {
    const app = express();
    app.use('/grants', createGrantsRouter(overrides));
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const b = `http://127.0.0.1:${server.address().port}/grants`;
    return {
      get: async (p) => { const r = await fetch(b + p); return { status: r.status, body: await r.json() }; },
      close: () => new Promise((r) => server.close(r))
    };
  }

  test('list and page pass through with defaults; errors map to 400 / 404 / 503', async () => {
    const s = await serve({
      grantList: jest.fn(async (range, view) => ({ range, view })),
      grantPage: jest.fn(async (id, range) => {
        if (id === '404') throw new G.GrantsError(404, 'grant 404 is not live');
        if (id === '503') throw Object.assign(new Error('x'), { code: 'not_configured' });
        return { id: Number(id), range };
      })
    });
    expect((await s.get('/')).body).toEqual({ range: 'week', view: 'all' });
    expect((await s.get('/?range=month&view=most_ignored')).body).toEqual({ range: 'month', view: 'most_ignored' });
    expect((await s.get('/1196?range=day')).body).toEqual({ id: 1196, range: 'day' });
    expect((await s.get('/404')).status).toBe(404);
    expect(await s.get('/503')).toEqual({ status: 503, body: { error: 'not_configured' } });
    await s.close();
    const real = await serve({ grantList: (r, v) => G.grantList(r, v, deps()) });
    expect((await real.get('/?view=nope')).status).toBe(400);
    await real.close();
  });
});
