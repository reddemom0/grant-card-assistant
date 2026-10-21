/**
 * control-centre overview (step 6): range maths in Vancouver days, the
 * previous-period comparison, empty days, distinct-vs-sum, the live tail after
 * the last rolled-up day, the exclusion rule, movers, trends, cache, search.
 * Fixtures only — injected Hub / app / ops queries, no DB.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-overview.test.js
 */

import { jest } from '@jest/globals';
import {
  windowsFor, liveTail, compare, buildOverview, computeOverview, getOverview, search, shiftingTrends,
  _clearCacheForTests, OverviewError, CACHE_TTL_MS, MAX_LIVE_DAYS,
  ROLLED_MATCHES_SQL, ROLLED_VIEWS_SQL, ROLLED_RATINGS_SQL, LAST_ROLLED_SQL, NEED_ACTION_SQL,
  SIGNUPS_SQL, WATCHLIST_ADDS_SQL, CHATS_SQL, COMPANY_METADATA_SQL, COMPANY_SEARCH_SQL,
  OPEN_SOURCES, openSourceKey, openSources, chatStats,
  rangeError, parseCustomRange, customRange, spanLabel, MAX_CUSTOM_DAYS, trimCache,
  trackingFor, trackingStarts, HUB_TRACKING_SQL, APP_TRACKING_SQL, OPS_TRACKING_SQL, TRACKED_BY
} from '../../src/control-centre/overview.js';
import { askedForWindow, QUESTIONS_SQL, FIRST_DAY_SQL } from '../../src/control-centre/chat-themes.js';
import { MATCH_SQL } from '../../src/control-centre/rollup.js';
import { INTERNAL_COMPANY_IDS, internalCompanySet, isInternalCompany } from '../../src/control-centre/internal-accounts.js';
import { namedItems } from '../../src/control-centre/review-routes.js';

// 2026-10-15 10:00 Vancouver (PDT, UTC−7)
const NOW = new Date('2026-10-15T17:00:00Z');

describe('windowsFor', () => {
  test('week = last 7 Vancouver days incl. today vs the 7 before', () => {
    const w = windowsFor('week', NOW);
    expect(w.current).toMatchObject({ from: '2026-10-09', to: '2026-10-15' });
    expect(w.previous).toMatchObject({ from: '2026-10-02', to: '2026-10-08' });
    expect(w.current.days).toHaveLength(7);
    expect(w.previous.days).toHaveLength(7);
  });

  test.each([['day', 1, '2026-10-15', '2026-10-14'], ['month', 30, '2026-09-16', '2026-08-17'], ['year', 365, '2025-10-16', '2024-10-16']])(
    '%s: %i days, equal previous period', (range, n, curFrom, prevFrom) => {
      const w = windowsFor(range, NOW);
      expect(w.current.days).toHaveLength(n);
      expect(w.previous.days).toHaveLength(n);
      expect(w.current.from).toBe(curFrom);
      expect(w.previous.from).toBe(prevFrom);
      expect(w.previous.to < w.current.from).toBe(true);
    });

  test('the day follows Vancouver, not UTC', () => {
    // 2026-10-16 05:30 UTC is still Oct 15 in Vancouver
    expect(windowsFor('day', new Date('2026-10-16T05:30:00Z')).today).toBe('2026-10-15');
  });

  test('a DST-end day (Nov 1, 25 hours) is still one day in the window', () => {
    const w = windowsFor('week', new Date('2026-11-03T20:00:00Z'));
    expect(w.current.days).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  });

  test('a bad range is a 400', () => {
    expect(() => windowsFor('decade', NOW)).toThrow(OverviewError);
  });
});

describe('custom ranges', () => {
  test('from..to is its own window; the previous window has the same number of days just before it', () => {
    const w = windowsFor('2026-09-01..2026-10-15', NOW);
    expect(w).toMatchObject({ days: 45, custom: true, ends_today: true });
    expect(w.current).toMatchObject({ from: '2026-09-01', to: '2026-10-15', label: 'Sep 1 – Oct 15' });
    expect(w.previous).toMatchObject({ from: '2026-07-18', to: '2026-08-31', label: 'Jul 18 – Aug 31' });
    expect(w.previous.days).toHaveLength(45);
  });

  test('a range that ended before today is complete; one day compares with the day before', () => {
    const w = windowsFor('2026-10-01..2026-10-01', NOW);
    expect(w).toMatchObject({ days: 1, ends_today: false });
    expect(w.previous).toMatchObject({ from: '2026-09-30', to: '2026-09-30', label: 'Sep 30' });
  });

  test('labels carry the year only when the windows cross into another year', () => {
    expect(windowsFor('year', NOW).previous.label).toBe('Oct 16, 2024 – Oct 15, 2025');
    expect(spanLabel('2025-12-20', '2026-01-05', '2026')).toBe('Dec 20, 2025 – Jan 5, 2026');
    expect(windowsFor('week', NOW).previous.label).toBe('Oct 2 – Oct 8');
  });

  test('named windows are unchanged and labelled', () => {
    expect(windowsFor('month', NOW)).toMatchObject({ days: 30, custom: false, ends_today: true,
      current: { from: '2026-09-16', to: '2026-10-15', label: 'Sep 16 – Oct 15' }, previous: { from: '2026-08-17', to: '2026-09-15' } });
  });

  test.each([
    ['2026-10-10..2026-10-01', /on or before/],
    ['2026-10-01..2026-10-16', /after today/],
    ['2026-02-30..2026-03-02', /real dates/],
    ['2025-01-01..2026-10-01', /at most 365 days/],
    ['2026-9-1..2026-10-1', /range must be one of/],
    ['', /range must be one of/]
  ])('%s is refused', (range, why) => {
    expect(rangeError(range, NOW)).toMatch(why);
    expect(() => windowsFor(range, NOW)).toThrow(OverviewError);
  });

  test('exactly MAX_CUSTOM_DAYS is allowed; named ranges are fine; the token round-trips', () => {
    expect(MAX_CUSTOM_DAYS).toBe(365);
    expect(rangeError('2025-10-16..2026-10-15', NOW)).toBeNull();
    expect(rangeError('week', NOW)).toBeNull();
    expect(parseCustomRange(customRange('2026-09-01', '2026-10-15'))).toEqual({ from: '2026-09-01', to: '2026-10-15' });
    expect(parseCustomRange('week')).toBeNull();
  });

  test('the payload names both windows for "vs …" wording', () => {
    const o = buildOverview(windowsFor('2026-09-01..2026-10-14', NOW), base());
    expect(o).toMatchObject({ days: 44, custom: true, today_partial: false,
      current: { from: '2026-09-01', to: '2026-10-14', label: 'Sep 1 – Oct 14' }, previous: { label: 'Jul 19 – Aug 31' } });
  });

  test('getOverview refuses a bad custom range with a 400', async () => {
    await expect(getOverview('2026-10-10..2026-10-01', deps())).rejects.toMatchObject({ status: 400 });
  });

  test('per-range caches drop their oldest keys past the limit', () => {
    const m = new Map(Array.from({ length: 23 }, (_, i) => [`k${i}`, i]));
    trimCache(m, 20);
    expect([...m.keys()][0]).toBe('k3');
    expect(m.size).toBe(20);
  });
});

describe('liveTail', () => {
  test('days after the last rolled-up day are read live', () => {
    expect(liveTail('2026-10-02', '2026-10-15', '2026-10-14')).toEqual({ days: ['2026-10-15'], stale: false });
  });
  test('no roll-up at all → newest MAX_LIVE_DAYS live, flagged stale', () => {
    const t = liveTail('2026-09-16', '2026-10-15', null);
    expect(t.days).toHaveLength(MAX_LIVE_DAYS);
    expect(t.days.at(-1)).toBe('2026-10-15');
    expect(t.stale).toBe(true);
  });
  test('fully rolled up → nothing live', () => {
    expect(liveTail('2026-10-02', '2026-10-08', '2026-10-14')).toEqual({ days: [], stale: false });
  });
});

describe('compare', () => {
  test('delta and percent; previous 0 has no percent', () => {
    expect(compare(12, 8)).toEqual({ current: 12, previous: 8, delta: 4, delta_pct: 50 });
    expect(compare(3, 0)).toEqual({ current: 3, previous: 0, delta: 3, delta_pct: null });
    expect(compare(0, 0).delta).toBe(0);
  });
});

// --- buildOverview -------------------------------------------------------------

const W = windowsFor('week', NOW);
const base = () => ({
  matches: [], views: [], ratings: [], signups: [], watchlist: [], chats: [],
  chatCompany: new Map(), titles: new Map([[1196, 'Ag Clean Tech'], [1516, 'CareerLaunch']]),
  metadata: new Map(), needAction: 5
});
const m = (day, company_id, grant_id, shown = 1, computed = 1) => ({ day, company_id, grant_id, times_shown: shown, times_computed: computed });

describe('buildOverview', () => {
  test('every day in both windows is present; empty days are 0', () => {
    const o = buildOverview(W, { ...base(), views: [{ day: '2026-10-12', company_id: 1, grant_root_id: 1196, sessions: 3 }] });
    const s = o.metrics.grants_opened;
    expect(s.series.map((p) => p.day)).toEqual(W.current.days);
    expect(s.previous_series.map((p) => p.day)).toEqual(W.previous.days);
    expect(s.series.map((p) => p.value)).toEqual([0, 0, 0, 3, 0, 0, 0]);
    expect(s).toMatchObject({ current: 3, previous: 0, delta: 3 });
  });

  test('matches shown and active companies are distinct over the window, not summed days', () => {
    const o = buildOverview(W, { ...base(), matches: [
      m('2026-10-10', 81, 1196), m('2026-10-11', 81, 1196), // same pair two days
      m('2026-10-11', 83, 1196),
      m('2026-10-12', 84, 1516, 0, 1) // computed, not shown
    ] });
    expect(o.metrics.matches_shown.current).toBe(2);
    expect(o.metrics.matches_shown.series.map((p) => p.value)).toEqual([0, 1, 2, 0, 0, 0, 0]);
    expect(o.metrics.active_companies.current).toBe(3); // 81, 83 and 84 (computed counts as active)
  });

  test('rows outside both windows are ignored; previous window counted separately', () => {
    const o = buildOverview(W, { ...base(), matches: [m('2026-10-05', 81, 1196), m('2026-09-01', 81, 1516)],
      ratings: [{ day: '2026-10-03', company_id: 81, grant_root_id: 1196, ups: 1, downs: 2 }] });
    expect(o.metrics.matches_shown).toMatchObject({ current: 0, previous: 1, delta: -1 });
    expect(o.metrics.ratings_down).toMatchObject({ current: 0, previous: 2 });
  });

  test('chats count companies through the Clerk identity map; unknown Clerk ids still count as chats', () => {
    const o = buildOverview(W, { ...base(),
      chats: [{ day: '2026-10-13', clerk_id: 'user_a' }, { day: '2026-10-13', clerk_id: 'user_b' }],
      chatCompany: new Map([['user_a', 90]]) });
    expect(o.metrics.chats.current).toBe(2);
    expect(o.metrics.active_companies.current).toBe(1);
  });

  test('most matched, movers and popular per grant', () => {
    const o = buildOverview(W, { ...base(),
      matches: [m('2026-10-10', 1, 1196), m('2026-10-10', 2, 1196), m('2026-10-10', 3, 1196), m('2026-10-04', 1, 1196),
        m('2026-10-04', 1, 1516), m('2026-10-04', 2, 1516), m('2026-10-10', 1, 1516), m('2026-10-10', 1, 777)],
      views: [{ day: '2026-10-10', company_id: 1, grant_root_id: 1516, sessions: 4 }],
      watchlist: [{ day: '2026-10-11', grant_root_id: 1516, company_id: 1 }] });
    // no internal accounts: both views are the same
    expect(o.rankings.all).toEqual(o.rankings.clients);
    const r = o.rankings.clients;
    expect(r.most_matched.map((g) => [g.grant_id, g.companies, g.change])).toEqual([[1196, 3, 2], [1516, 1, -1], [777, 1, 1]]);
    expect(r.most_matched[2].title).toBe('Grant #777');
    expect(r.movers.risers.map((g) => g.grant_id)).toEqual([1196, 777]);
    expect(r.movers.drops.map((g) => g.grant_id)).toEqual([1516]);
    expect(r.movers).toMatchObject({ up_count: 2, down_count: 1 });
    expect(r.popular[0]).toMatchObject({ grant_id: 1516, opens: 4, saves: 1 });
    expect(o.need_action).toBe(5);
  });
});

describe('chat numbers', () => {
  const chats = [
    { day: '2026-10-10', company_id: 90, questions: 3 },
    { day: '2026-10-11', company_id: 90, questions: 1 },
    { day: '2026-10-12', company_id: null, questions: 2 }, // Clerk id with no company: a chat, not a client
    { day: '2026-10-04', company_id: 91, questions: 4 }
  ];
  const views = [
    { day: '2026-10-10', source: 'advisor', sessions: 2 },
    { day: '2026-10-10', source: 'browse', sessions: 5 },
    { day: '2026-10-03', source: 'advisor', sessions: 1 }
  ];

  test('chats, clients who chatted, questions, average, cards opened from chat — now vs before', () => {
    expect(chatStats(chats, views, W.current.days, W.previous.days)).toEqual({
      chats_started: { current: 3, previous: 1, delta: 2, delta_pct: 200 },
      clients_chatted: { current: 1, previous: 1, delta: 0, delta_pct: 0 },
      questions_asked: { current: 6, previous: 4, delta: 2, delta_pct: 50 },
      avg_questions_per_chat: { current: 2, previous: 4, delta: -2, delta_pct: -50 },
      cards_opened_from_chat: { current: 2, previous: 1, delta: 1, delta_pct: 100 }
    });
  });

  test('no chats → zeros, no division by zero', () => {
    expect(chatStats([], [], W.current.days, W.previous.days).avg_questions_per_chat).toEqual({ current: 0, previous: 0, delta: 0, delta_pct: null });
  });

  test('in both rankings; clients-only leaves internal accounts out', () => {
    const o = buildOverview(W, { ...base(),
      internalCompanies: internalCompanySet([81]),
      chats: [{ day: '2026-10-10', clerk_id: 'user_staff', questions: 5 }, { day: '2026-10-10', clerk_id: 'user_c', questions: 1 }],
      chatCompany: new Map([['user_staff', 81], ['user_c', 90]]) });
    expect(o.rankings.all.chat.questions_asked.current).toBe(6);
    expect(o.rankings.clients.chat.questions_asked.current).toBe(1);
    expect(o.rankings.clients.chat.clients_chatted.current).toBe(1);
  });

  test('questions are the client\'s own messages (string content), not tool results', () => {
    expect(CHATS_SQL).toMatch(/m->>'role' = 'user' AND jsonb_typeof\(m->'content'\) = 'string'/);
  });

  test('a missing themes table never fails the overview', async () => {
    _clearCacheForTests();
    const d = { ...deps(), askedForWindow: async () => { throw Object.assign(new Error('x'), { code: '42P01' }); } };
    const o = await computeOverview('week', d);
    expect(o.asked).toBeNull();
    expect(o.asked_error).toBe('42P01');
  });

  test('"What clients asked about" is read for the overview\'s own window', async () => {
    _clearCacheForTests();
    const askedForWindow = jest.fn(async (w) => ({ from: w.current.from, to: w.current.to, themes: [], recent_questions: [] }));
    const o = await computeOverview('2026-09-01..2026-10-15', { ...deps(), askedForWindow });
    expect(askedForWindow.mock.calls[0][0].current).toMatchObject({ from: '2026-09-01', to: '2026-10-15' });
    expect(o.asked).toMatchObject({ from: '2026-09-01', to: '2026-10-15' });
  });
});

describe('how clients found grant cards', () => {
  test('source values map to goal tracks / browse / chat / watchlist / other', () => {
    expect(OPEN_SOURCES.map((s) => s.key)).toEqual(['goal_tracks', 'browse', 'chat', 'watchlist', 'other']);
    expect(openSourceKey('suggested')).toBe('goal_tracks');
    expect(openSourceKey('browse')).toBe('browse');
    expect(openSourceKey('advisor')).toBe('chat');
    expect(openSourceKey('Advisor')).toBe('chat');
    expect(openSourceKey('watchlist')).toBe('watchlist');
    expect(openSourceKey('direct')).toBe('other');
    expect(openSourceKey(null)).toBe('other');
    expect(openSourceKey('something-new')).toBe('other');
  });

  test('opens per source, this period vs previous, every source listed', () => {
    const views = [
      { day: '2026-10-10', source: 'suggested', sessions: 3 },
      { day: '2026-10-11', source: 'advisor', sessions: 2 },
      { day: '2026-10-11', source: 'direct', sessions: 1 },
      { day: '2026-10-04', source: 'suggested', sessions: 5 },
      { day: '2026-10-04', source: 'browse', sessions: 1 },
      { day: '2026-09-01', source: 'browse', sessions: 9 } // outside both windows
    ];
    expect(openSources(views, W.current.days, W.previous.days)).toEqual([
      { key: 'goal_tracks', label: 'Goal tracks', current: 3, previous: 5, delta: -2, delta_pct: -40 },
      { key: 'browse', label: 'Browse', current: 0, previous: 1, delta: -1, delta_pct: -100 },
      { key: 'chat', label: 'Chat', current: 2, previous: 0, delta: 2, delta_pct: null },
      { key: 'watchlist', label: 'Watchlist', current: 0, previous: 0, delta: 0, delta_pct: null },
      { key: 'other', label: 'Other (direct links)', current: 1, previous: 0, delta: 1, delta_pct: null }
    ]);
  });

  test('in both rankings; clients-only leaves internal accounts out; sums match the opens tile', () => {
    const o = buildOverview(W, { ...base(),
      internalCompanies: internalCompanySet([81]),
      views: [
        { day: '2026-10-10', company_id: 81, grant_root_id: 1, source: 'advisor', sessions: 4 },
        { day: '2026-10-10', company_id: 90, grant_root_id: 1, source: 'browse', sessions: 2 }
      ] });
    const sum = (list) => list.reduce((a, s) => a + s.current, 0);
    expect(sum(o.rankings.all.open_sources)).toBe(o.metrics.grants_opened.current);
    expect(o.rankings.clients.open_sources.find((s) => s.key === 'chat').current).toBe(0);
    expect(o.rankings.all.open_sources.find((s) => s.key === 'chat').current).toBe(4);
  });

  test('the roll-up read includes source', () => {
    expect(ROLLED_VIEWS_SQL).toMatch(/\bsource\b/);
  });
});

describe('internal accounts', () => {
  test('the confirmed list: 28 companies including 81, no duplicates, frozen', () => {
    expect(INTERNAL_COMPANY_IDS).toEqual([1, 5, 7, 8, 9, 10, 11, 13, 15, 18, 20, 23, 24, 25, 27, 33, 34, 35, 48, 50, 51, 58, 71, 73, 81, 82, 85, 126]);
    expect(new Set(INTERNAL_COMPANY_IDS).size).toBe(INTERNAL_COMPANY_IDS.length);
    expect(Object.isFrozen(INTERNAL_COMPANY_IDS)).toBe(true);
    expect(isInternalCompany(81)).toBe(true);
    expect(isInternalCompany('81')).toBe(true);
    expect(isInternalCompany(83)).toBe(false);
    expect(isInternalCompany(null)).toBe(false);
  });

  const fixture = () => buildOverview(W, { ...base(),
    internalCompanies: internalCompanySet([81]),
    matches: [m('2026-10-10', 81, 1196), m('2026-10-10', 82, 1516), m('2026-10-04', 81, 1516)],
    views: [{ day: '2026-10-10', company_id: 81, grant_root_id: 1196, sessions: 5 }],
    ratings: [{ day: '2026-10-10', company_id: 81, grant_root_id: 1196, ups: 1, downs: 2 }],
    watchlist: [{ day: '2026-10-10', grant_root_id: 1196, company_id: 81 }],
    signups: [{ day: '2026-10-10', company_id: 81 }],
    chats: [{ day: '2026-10-10', clerk_id: 'user_staff' }, { day: '2026-10-10', clerk_id: 'user_client' }],
    chatCompany: new Map([['user_staff', 81], ['user_client', 82]]),
    metadata: new Map([[81, { industries: ['Wood'], provinces: ['BC'] }], [82, { industries: ['Tech'], provinces: ['ON'] }]])
  });

  test('tiles count everything and say how much came from internal accounts', () => {
    const o = fixture();
    expect(o.metrics.matches_shown).toMatchObject({ current: 2, internal: { current: 1, previous: 1 } });
    expect(o.metrics.grants_opened).toMatchObject({ current: 5, internal: { current: 5, previous: 0 } });
    expect(o.metrics.active_companies).toMatchObject({ current: 2, internal: { current: 1 } });
    expect(o.metrics.signups).toMatchObject({ current: 1, internal: { current: 1 } });
    expect(o.metrics.watchlist_adds).toMatchObject({ current: 1, internal: { current: 1 } });
    expect(o.metrics.ratings_up).toMatchObject({ current: 1, internal: { current: 1 } });
    expect(o.metrics.ratings_down).toMatchObject({ current: 2, internal: { current: 2 } });
    expect(o.metrics.chats).toMatchObject({ current: 2, internal: { current: 1 } });
  });

  test('rankings.clients leaves them out; rankings.all keeps them', () => {
    const o = fixture();
    const c = o.rankings.clients;
    expect(c.most_matched.map((g) => g.grant_id)).toEqual([1516]);
    expect(c.popular).toEqual([]);
    expect(c.movers.risers.map((g) => [g.grant_id, g.change])).toEqual([[1516, 1]]); // 81's prev-week match on 1516 ignored
    expect(c.movers.drops).toEqual([]);
    expect(c.trends.industries.map((t) => t.name)).toEqual(['Tech']);
    expect(c.trends.provinces.map((t) => t.name)).toEqual(['ON']);

    const a = o.rankings.all;
    expect(a.most_matched.map((g) => g.grant_id).sort()).toEqual([1196, 1516]);
    expect(a.popular.map((g) => [g.grant_id, g.opens, g.saves])).toEqual([[1196, 5, 1]]);
    expect(a.movers.risers.map((g) => g.grant_id)).toEqual([1196]); // 1516: 81 before, 82 now → no change
    expect(a.trends.industries.map((t) => t.name).sort()).toEqual(['Tech', 'Wood']);
  });

  test('the payload lists internal accounts by name, id second', async () => {
    _clearCacheForTests();
    const d = { ...deps(), internalCompanyIds: [81] };
    const app = d.appQuery;
    d.appQuery = jest.fn(async (sql, p) => (/FROM companies WHERE id = ANY/.test(sql) ? { rows: [{ id: 81, name: 'Maximizer' }] } : app(sql, p)));
    const o = await computeOverview('week', d);
    expect(o.internal_accounts).toEqual([{ id: 81, name: 'Maximizer', internal: true }]);
  });

  test('search marks internal companies', async () => {
    _clearCacheForTests();
    const r = await search('81', { ...deps(), appQuery: async () => ({ rows: [{ id: 81, name: 'Maximizer' }, { id: 810, name: 'Client 810' }] }), liveGrants: async () => [] });
    expect(r.companies).toEqual([
      { type: 'company', id: 81, name: 'Maximizer', internal: true },
      { type: 'company', id: 810, name: 'Client 810', internal: false }
    ]);
  });
});

describe('company names on the review list', () => {
  test('every item gets company_name beside company_id; chat items without a company get null', async () => {
    const query = jest.fn(async () => ({ rows: [{ id: 81, name: 'Maximizer' }] }));
    const out = await namedItems([{ id: 1, company_id: 81 }, { id: 2, company_id: null, kind: 'chat' }], { query });
    expect(out.items).toEqual([
      { id: 1, company_id: 81, company_name: 'Maximizer', company_internal: true },
      { id: 2, company_id: null, kind: 'chat', company_name: null, company_internal: false }
    ]);
    expect(query.mock.calls[0][1]).toEqual([[81]]);
  });

  test('a names failure still returns the list', async () => {
    const out = await namedItems([{ id: 1, company_id: 81 }], { query: async () => { throw Object.assign(new Error('x'), { code: 'not_configured' }); } });
    // the Internal tag needs no database, so it survives a names failure
    expect(out).toEqual({ items: [{ id: 1, company_id: 81, company_name: null, company_internal: true }], names_error: 'not_configured' });
  });
});

describe('shiftingTrends', () => {
  test('industries and provinces from company metadata, moving ones only', () => {
    const metadata = new Map([[1, { industries: ['Agriculture'], provinces: ['BC'] }], [2, { industries: ['Tech'], provinces: ['BC'] }]]);
    const t = shiftingTrends({ curPairs: new Set(['1:10', '1:11']), prevPairs: new Set(['2:10']), curSignups: new Set([2]), prevSignups: new Set(), metadata });
    expect(t.industries).toEqual([
      { name: 'Agriculture', matches: 2, previous_matches: 0, signups: 0, previous_signups: 0, matches_change: 2, signups_change: 0 },
      { name: 'Tech', matches: 0, previous_matches: 1, signups: 1, previous_signups: 0, matches_change: -1, signups_change: 1 }
    ]);
    expect(t.provinces).toEqual([{ name: 'BC', matches: 2, previous_matches: 1, signups: 1, previous_signups: 0, matches_change: 1, signups_change: 1 }]);
  });
});

// --- computeOverview with injected reads ------------------------------------------

function deps({ lastRolled = '2026-10-14' } = {}) {
  const hub = jest.fn(async (sql) => {
    if (sql === LAST_ROLLED_SQL) return { rows: [{ day: lastRolled }] };
    if (sql === ROLLED_MATCHES_SQL) return { rows: [
      { day: '2026-10-10', company_id: 81, grant_id: 1196, times_computed: '2', times_shown: '1' },
      { day: '2026-10-15', company_id: 99, grant_id: 1, times_computed: '1', times_shown: '1' } // a partial today row: must be replaced by the live read
    ] };
    if (sql === ROLLED_VIEWS_SQL) return { rows: [{ day: '2026-10-10', company_id: 81, grant_root_id: 1196, sessions: 2 }] };
    if (sql === ROLLED_RATINGS_SQL) return { rows: [] };
    if (sql === NEED_ACTION_SQL) return { rows: [{ n: 3 }] };
    throw new Error(`hub: unexpected ${sql.slice(0, 40)}`);
  });
  const app = jest.fn(async (sql) => {
    if (sql === SIGNUPS_SQL) return { rows: [{ day: '2026-10-12', company_id: 120 }] };
    if (sql === WATCHLIST_ADDS_SQL) return { rows: [] };
    if (sql === COMPANY_METADATA_SQL) return { rows: [{ company_id: 81, primary_industries: ['Agriculture'], provinces: 'BC, Alberta' }] };
    if (/users_clerk/.test(sql)) return { rows: [] }; // identity lookup
    throw new Error(`app: unexpected ${sql.slice(0, 40)}`);
  });
  const ops = jest.fn(async (sql) => {
    if (sql === CHATS_SQL) return { rows: [{ day: '2026-10-15', clerk_id: 'user_x' }] };
    throw new Error(`ops: unexpected ${sql.slice(0, 40)}`);
  });
  const readDay = jest.fn(async (day) => ({
    matches: [{ occurred_at: `${day}T18:00:00Z`, company_id: 81, grant_id: 1516, section: 'funding_matches', result_set_id: 'r1', shown: true, position: 0, match_score: 30, eligibility: 'Likely' }],
    reviews: [], views: [], ratings: []
  }));
  const liveGrants = jest.fn(async () => [{ root_id: 1196, title: 'Ag Clean Tech' }, { root_id: 1516, title: 'CareerLaunch' }]);
  // No internal accounts by default: these fixtures use company 81 as a normal company.
  return { hubQuery: hub, appQuery: app, opsQuery: ops, readDay, liveGrants, now: () => NOW, internalCompanyIds: [] };
}

describe('computeOverview', () => {
  test('history from roll-ups; days after the last rolled-up day read live and replace stored rows', async () => {
    const d = deps();
    const o = await computeOverview('week', d);
    expect(d.readDay).toHaveBeenCalledTimes(1);
    expect(d.readDay.mock.calls[0][0]).toBe('2026-10-15');
    expect(o.sources).toEqual({ last_rolled_day: '2026-10-14', live_days: ['2026-10-15'], stale_rollup: false });
    // 81×1196 (rolled, Oct 10) + 81×1516 (live, Oct 15); the stored partial 99×1 row is dropped
    expect(o.metrics.matches_shown.current).toBe(2);
    expect(o.rankings.clients.most_matched.map((g) => g.title).sort()).toEqual(['Ag Clean Tech', 'CareerLaunch']);
    expect(o.metrics.signups.current).toBe(1);
    expect(o.metrics.chats.current).toBe(1);
    expect(o.need_action).toBe(3);
    expect(o.rankings.clients.trends.provinces.map((p) => p.name).sort()).toEqual(['Alberta', 'BC']);
  });

  test('reads are bounded to previous.from … current.to', async () => {
    const d = deps();
    await computeOverview('week', d);
    expect(d.hubQuery).toHaveBeenCalledWith(ROLLED_MATCHES_SQL, ['2026-10-02', '2026-10-15']);
    expect(d.appQuery).toHaveBeenCalledWith(SIGNUPS_SQL, ['2026-10-02', '2026-10-15']);
    expect(d.opsQuery).toHaveBeenCalledWith(CHATS_SQL, ['2026-10-02', '2026-10-15']);
  });

  test('exclusion rule: ops reads keep real Clerk users only, the same rule as the roll-ups', () => {
    expect(MATCH_SQL).toMatch(/user_id LIKE 'user\\_%'/); // live tail goes through rollup.readDay
    expect(CHATS_SQL).toMatch(/user_id LIKE 'user\\_%'/);
    expect(CHATS_SQL).toMatch(/jsonb_array_length\(messages\) > 0/);
    expect(SIGNUPS_SQL).toMatch(/clerk_id LIKE 'user\\_%'/);
    // staff are blended: nothing filters internal users
    for (const sql of [CHATS_SQL, SIGNUPS_SQL, WATCHLIST_ADDS_SQL, ROLLED_MATCHES_SQL]) expect(sql).not.toMatch(/INTERNAL|internal/);
  });

  test('a day counts as rolled up only if it was written after it ended (Vancouver)', () => {
    expect(LAST_ROLLED_SQL).toMatch(/max\(updated_at\)/);
    expect(LAST_ROLLED_SQL).toMatch(/written >= \(day \+ 1\)::timestamp AT TIME ZONE 'America\/Vancouver'/);
    for (const t of ['cc_daily_matches', 'cc_daily_views', 'cc_daily_ratings']) expect(LAST_ROLLED_SQL).toContain(t);
  });

  test('every read is a SELECT', () => {
    for (const sql of [ROLLED_MATCHES_SQL, ROLLED_VIEWS_SQL, ROLLED_RATINGS_SQL, LAST_ROLLED_SQL, NEED_ACTION_SQL,
      SIGNUPS_SQL, WATCHLIST_ADDS_SQL, CHATS_SQL, COMPANY_METADATA_SQL, COMPANY_SEARCH_SQL]) {
      expect(sql.trim()).toMatch(/^SELECT/i);
    }
  });
});

describe('getOverview cache', () => {
  beforeEach(() => _clearCacheForTests());

  test('a second call within 5 minutes is cached; after 5 minutes it recomputes', async () => {
    let t = NOW.getTime();
    const d = { ...deps(), now: () => new Date(t) };
    const a = await getOverview('week', d);
    expect(a.cached).toBe(false);
    t += CACHE_TTL_MS - 1000;
    const b = await getOverview('week', d);
    expect(b.cached).toBe(true);
    expect(d.readDay).toHaveBeenCalledTimes(1);
    t += 2000;
    const c = await getOverview('week', d);
    expect(c.cached).toBe(false);
    expect(d.readDay).toHaveBeenCalledTimes(2);
  });

  test('ranges cache separately; a failure is not cached', async () => {
    const d = deps();
    const failing = { ...d, hubQuery: jest.fn(async () => { throw Object.assign(new Error('x'), { code: 'not_configured' }); }) };
    await expect(getOverview('month', failing)).rejects.toMatchObject({ code: 'not_configured' });
    expect((await getOverview('month', d)).cached).toBe(false);
    expect((await getOverview('week', d)).cached).toBe(false);
  });

  test('a bad range is a 400 before any read', async () => {
    const d = deps();
    await expect(getOverview('fortnight', d)).rejects.toMatchObject({ status: 400 });
    expect(d.hubQuery).not.toHaveBeenCalled();
  });
});

describe('search', () => {
  beforeEach(() => _clearCacheForTests());
  const d = () => ({
    ...deps(),
    appQuery: jest.fn(async () => ({ rows: [{ id: 81, name: 'Acme Vineyards' }] })),
    liveGrants: jest.fn(async () => [{ root_id: 1196, title: 'Agricultural Clean Technology' }, { root_id: 81, title: 'Other' }, { root_id: 5, title: 'Agri Booster' }])
  });

  test('by id: the exact id ranks first, for companies (SQL) and grants', async () => {
    const x = d();
    const r = await search('81', x);
    expect(x.appQuery).toHaveBeenCalledWith(COMPANY_SEARCH_SQL, [81, '%81%']);
    expect(r.grants[0]).toEqual({ type: 'grant', id: 81, name: 'Other' });
    expect(r.companies[0]).toEqual({ type: 'company', id: 81, name: 'Acme Vineyards', internal: true }); // 81 is on the internal list
  });

  test('by name: case-insensitive, LIKE wildcards escaped, no id match', async () => {
    const x = d();
    const r = await search('agri_%', x);
    expect(x.appQuery).toHaveBeenCalledWith(COMPANY_SEARCH_SQL, [-1, '%agri\\_\\%%']);
    expect(r.grants).toEqual([]);
    const r2 = await search('AGRI', x);
    expect(r2.grants.map((g) => g.id)).toEqual([5, 1196]);
  });

  test('empty query reads nothing', async () => {
    const x = d();
    expect(await search('  ', x)).toEqual({ companies: [], grants: [] });
    expect(x.appQuery).not.toHaveBeenCalled();
  });
});

describe('askedForWindow (the daily review\'s stored themes, no model call)', () => {
  const rows = [
    { day: '2026-10-14', occurred_at: '2026-10-14T18:00:00Z', conversation_id: 5, turn_index: 1, clerk_id: 'user_a', company_id: 83, question: 'Hiring subsidies?', theme: 'Hiring' },
    { day: '2026-10-13', occurred_at: '2026-10-13T18:00:00Z', conversation_id: 4, turn_index: 0, clerk_id: 'user_a', company_id: 83, question: 'Wage grants?', theme: 'Hiring' },
    { day: '2026-10-13', occurred_at: '2026-10-13T17:00:00Z', conversation_id: 3, turn_index: 0, clerk_id: 'user_s', company_id: 81, question: 'Staff test', theme: 'Hiring' },
    { day: '2026-10-12', occurred_at: '2026-10-12T17:00:00Z', conversation_id: 2, turn_index: 0, clerk_id: 'user_i', company_id: null, question: 'Internal, no company', theme: 'Export' },
    { day: '2026-10-11', occurred_at: '2026-10-11T17:00:00Z', conversation_id: 1, turn_index: 0, clerk_id: 'user_z', company_id: null, question: 'Export help?', theme: 'Export' }
  ];
  const run = async (w) => {
    const storeQuery = jest.fn(async (sql, p) => {
      if (sql === QUESTIONS_SQL) return { rows: rows.filter((r) => r.day >= p[0] && r.day <= p[1]) };
      if (sql === FIRST_DAY_SQL) return { rows: [{ day: '2026-09-21' }] };
      throw new Error('unexpected');
    });
    const appQuery = jest.fn(async () => ({ rows: [{ id: 83, name: 'NYA Ventures' }, { id: 81, name: 'Maximizer' }] }));
    const out = await askedForWindow(w, { storeQuery, appQuery, internalClerkIds: async () => new Set(['user_i']) });
    return { out, storeQuery, appQuery };
  };

  test('themes are client-only with an internal count; questions newest first, tagged', async () => {
    const { out, storeQuery, appQuery } = await run(windowsFor('week', NOW));
    expect(storeQuery).toHaveBeenCalledWith(QUESTIONS_SQL, ['2026-10-09', '2026-10-15']);
    expect(out).toMatchObject({ from: '2026-10-09', to: '2026-10-15', data_from: '2026-09-21', source: 'daily_review' });
    expect(out.themes).toEqual([
      { name: 'Hiring', count: 2, internal_count: 1, example: 'Hiring subsidies?' },
      { name: 'Export', count: 1, internal_count: 1, example: 'Export help?' }
    ]);
    expect(out.recent_questions.map((q) => [q.text, q.company_name, q.company_internal])).toEqual([
      ['Hiring subsidies?', 'NYA Ventures', false], ['Wage grants?', 'NYA Ventures', false], ['Staff test', 'Maximizer', true],
      ['Internal, no company', null, true], ['Export help?', null, false]
    ]);
    for (const q of [storeQuery, appQuery]) expect(q.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });

  test('a different window gives different themes', async () => {
    const { out } = await run(windowsFor('2026-10-11..2026-10-12', NOW));
    expect(out.themes).toEqual([{ name: 'Export', count: 1, internal_count: 1, example: 'Export help?' }]);
  });
});

describe('no change shown before tracking began', () => {
  // The first day of each source's data, as production had them on 2026-10-21.
  const FROM = { matches: '2026-08-26', views: '2026-09-09', ratings: '2026-09-10', chats: '2026-05-27', signups: '2025-11-28', watchlist: '2026-09-09' };

  test('Sep 1 – Oct 15 vs Jul 18 – Aug 31: matches, opens, ratings, watchlist and active clients have no comparison; chats and sign-ups do', () => {
    const t = trackingFor(FROM, windowsFor('2026-09-01..2026-10-15', NOW).previous.from);
    expect(t.previous_from).toBe('2026-07-18');
    expect(t.metrics).toEqual({ signups: true, active_companies: false, matches_shown: false, grants_opened: false,
      ratings_up: false, ratings_down: false, watchlist_adds: false, chats: true });
    // The tooltip names the start of the source that began latest.
    expect(t.metric_from).toMatchObject({ matches_shown: '2026-08-26', grants_opened: '2026-09-09', active_companies: '2026-09-10', chats: '2026-05-27' });
  });

  test('a window that begins on the first tracked day compares; one day earlier doesn\'t', () => {
    expect(trackingFor(FROM, '2026-08-26').metrics.matches_shown).toBe(true);
    expect(trackingFor(FROM, '2026-08-25').metrics.matches_shown).toBe(false);
    expect(trackingFor(FROM, windowsFor('week', NOW).previous.from).metrics).toEqual(Object.fromEntries(Object.keys(TRACKED_BY).map((k) => [k, true])));
  });

  test('a source that couldn\'t be read keeps its change; a source with no data at all has none', () => {
    const t = trackingFor({ matches: null }, '2026-10-01');
    expect(t.sources).toMatchObject({ matches: false, views: true, chats: true });
    expect(t.metrics.matches_shown).toBe(false);
    expect(t.metrics.grants_opened).toBe(true);
  });

  test('the first days are read once an hour, read-only, from each source', async () => {
    _clearCacheForTests();
    const hubQuery = jest.fn(async () => ({ rows: [{ matches: FROM.matches, views: FROM.views, ratings: FROM.ratings }] }));
    const appQuery = jest.fn(async () => ({ rows: [{ signups: FROM.signups, watchlist: FROM.watchlist }] }));
    const opsQuery = jest.fn(async () => ({ rows: [{ chats: FROM.chats }] }));
    const deps = { hubQuery, appQuery, opsQuery, now: () => NOW };
    expect(await trackingStarts(deps)).toEqual(FROM);
    await trackingStarts(deps);
    expect(hubQuery).toHaveBeenCalledTimes(1);
    expect(hubQuery).toHaveBeenCalledWith(HUB_TRACKING_SQL);
    expect(appQuery).toHaveBeenCalledWith(APP_TRACKING_SQL);
    expect(opsQuery).toHaveBeenCalledWith(OPS_TRACKING_SQL);
    for (const sql of [HUB_TRACKING_SQL, APP_TRACKING_SQL, OPS_TRACKING_SQL]) {
      expect(sql).toMatch(/^\s*SELECT/);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    }
    _clearCacheForTests();
  });

  test('the overview payload carries it for its own previous window', async () => {
    _clearCacheForTests();
    const d = deps();
    const hub = d.hubQuery;
    d.hubQuery = jest.fn(async (sql, p) => (sql === HUB_TRACKING_SQL ? { rows: [{ matches: '2026-10-05', views: '2026-09-09', ratings: '2026-09-10' }] } : hub(sql, p)));
    const o = await computeOverview('week', { ...d, askedForWindow: async () => null });
    expect(o.tracking.previous_from).toBe('2026-10-02');
    expect(o.tracking.metrics.matches_shown).toBe(false);
    expect(o.tracking.metric_from.matches_shown).toBe('2026-10-05');
    expect(o.tracking.metrics.grants_opened).toBe(true);
    _clearCacheForTests();
  });
});
