/**
 * control-centre Companies tab (step 7): the list's per-company counts, profile
 * gaps, goals and goal→track aliases, goal tracks with the AI review overlay,
 * the timeline, Why matched? (trimmed, no LLM), transcript ownership + the view
 * log, and the routes. Fixtures and injected deps only — no DB, no network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-companies.test.js
 */

import { jest } from '@jest/globals';
import express from 'express';

const C = await import('../../src/control-centre/companies.js');
const { createCompaniesRouter } = await import('../../src/control-centre/companies-routes.js');

beforeEach(() => { C._clearCacheForTests(); jest.spyOn(console, 'error').mockImplementation(() => {}); });

describe('companyActivity + buildCompanyList', () => {
  const days = ['2026-10-14', '2026-10-15'];
  const rows = {
    matches: [
      { day: '2026-10-14', company_id: 83, grant_id: 1, times_computed: 2, times_shown: 1 },
      { day: '2026-10-15', company_id: 83, grant_id: 1, times_computed: 1, times_shown: 1 },
      { day: '2026-10-15', company_id: 83, grant_id: 2, times_computed: 1, times_shown: 0 },
      { day: '2026-10-01', company_id: 83, grant_id: 9, times_computed: 1, times_shown: 1 } // previous window
    ],
    views: [{ day: '2026-10-14', company_id: 83, grant_root_id: 1, sessions: 3 }, { day: '2026-10-15', company_id: 81, grant_root_id: 1, sessions: 2 }],
    ratings: [{ day: '2026-10-15', company_id: 135, ups: 1, downs: 0 }],
    chats: [{ day: '2026-10-15', clerk_id: 'user_a' }, { day: '2026-10-15', clerk_id: 'user_x' }],
    chatCompany: new Map([['user_a', 83], ['user_x', null]])
  };

  test('distinct grants shown, card opens, chats and last active day, current window only', () => {
    const a = C.companyActivity(rows, days);
    expect(a.get(83)).toEqual({ grant_matches: 1, cards_opened: 3, chats: 1, last_day: '2026-10-15' });
    expect(a.get(81)).toEqual({ grant_matches: 0, cards_opened: 2, chats: 0, last_day: '2026-10-15' });
    expect(a.get(135)).toMatchObject({ last_day: '2026-10-15' });
  });

  test('one row per client: names first, internal tagged, last active = the latest client action, null when there is none', () => {
    const list = C.buildCompanyList({
      clients: [{ id: 83, name: 'Expanding Domestically', created_at: '2026-09-14T17:00:00Z' }, { id: 81, name: 'Maximizer', created_at: '2026-09-14T17:00:00Z' },
        { id: 99, name: '', created_at: '2026-10-01T17:00:00Z' }],
      metadata: new Map([[83, { provinces: ['Alberta'], industries: ['Agriculture'], size: '5-10 employees', revenue: '$500k-$1M CAD' }]]),
      activity: C.companyActivity(rows, days),
      rolledLast: new Map([[83, '2026-10-12'], [81, '2026-10-16']]),
      chatLast: new Map([[83, '2026-10-13']]),
      openCards: new Map([[83, 2]]),
      plans: new Map([[83, { company_id: 83, plan_slug: 'starter', stripe_status: 'active' }]]),
      isInternal: (id) => id === 81
    });
    expect(list[0]).toEqual({ id: 83, name: 'Expanding Domestically', internal: false, provinces: ['Alberta'], industries: ['Agriculture'],
      size: '5-10 employees', revenue: '$500k-$1M CAD', plan: 'starter', plan_status: 'active',
      signed_up: '2026-09-14', last_active: '2026-10-15', grant_matches: 1, cards_opened: 3, chats: 1, open_cards: 2 });
    expect(list[1]).toMatchObject({ internal: true, last_active: '2026-10-16', provinces: [], size: null, revenue: null, plan: null, plan_status: null });
    // No client action on record: no "last active" — the sign-up date never stands in for it.
    expect(list[2]).toMatchObject({ name: 'Company #99', signed_up: '2026-10-01', last_active: null, grant_matches: 0 });
  });

  test('match runs are ours, not client activity: a client with only runs has no last active', () => {
    const runsOnly = { matches: [{ day: '2026-10-15', company_id: 77, grant_id: 1, times_computed: 3, times_shown: 2 }], views: [], ratings: [], chats: [], chatCompany: new Map() };
    const a = C.companyActivity(runsOnly, days);
    expect(a.get(77)).toEqual({ grant_matches: 1, cards_opened: 0, chats: 0, last_day: null });
    const [row] = C.buildCompanyList({ clients: [{ id: 77, name: 'Quiet Co', created_at: '2026-09-01T17:00:00Z' }], metadata: new Map(), activity: a,
      rolledLast: new Map(), chatLast: new Map(), openCards: new Map(), isInternal: () => false });
    expect(row).toMatchObject({ grant_matches: 1, signed_up: '2026-09-01', last_active: null });
    // The rolled history reads opens and ratings only.
    expect(C.LAST_ROLLED_ACTIVITY_SQL).not.toMatch(/cc_daily_matches|times_computed/);
    expect(C.LAST_ROLLED_ACTIVITY_SQL).toMatch(/cc_daily_views/);
    expect(C.LAST_ROLLED_ACTIVITY_SQL).toMatch(/cc_daily_ratings/);
  });

  test('companyList reads only, follows the range, caches per range', async () => {
    const hubQuery = jest.fn(async (sql) => ({ rows: sql === C.OPEN_CARDS_SQL ? [{ company_id: 83, n: 1 }] : [] }));
    const appQuery = jest.fn(async (sql) => ({ rows: sql === C.CLIENTS_SQL ? [{ id: 83, name: 'Expanding Domestically', created_at: '2026-09-14T17:00:00Z' }] : [] }));
    const opsQuery = jest.fn(async () => ({ rows: [] }));
    const deps = { hubQuery, appQuery, opsQuery, readDay: async () => ({ matches: [], reviews: [], views: [], ratings: [] }), now: () => new Date('2026-10-15T18:00:00Z') };
    const out = await C.companyList('week', deps);
    expect(out).toMatchObject({ range: 'week', current: { from: '2026-10-09', to: '2026-10-15' }, companies: [{ id: 83, open_cards: 1 }] });
    for (const q of [hubQuery, appQuery, opsQuery]) expect(q.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
    const calls = appQuery.mock.calls.length;
    await C.companyList('week', deps);
    expect(appQuery.mock.calls.length).toBe(calls); // cached
    await expect(C.companyList('decade', deps)).rejects.toMatchObject({ status: 400 });
  });
});

describe('profile gaps', () => {
  const profile = (engine) => ({ found: true, engine: { industries: ['Agriculture'], provinces: ['Alberta'], employee_count: '2-10', annual_revenue: '$1M-$2M CAD', ...engine } });

  test('none when the engine has what it needs', () => {
    expect(C.profileGaps(profile({}))).toEqual([]);
  });

  test('each gap in plain words, with what it means for matching', () => {
    const gaps = C.profileGaps(profile({ industries: [], provinces: [], employee_count: 'Just me', annual_revenue: null }));
    expect(gaps.map((g) => g.field)).toEqual(['industries', 'provinces', 'employee_count', 'annual_revenue']);
    expect(gaps[0].text).toMatch(/^No industry/);
    expect(gaps[2].text).toBe('Company size "Just me" can\'t be read by matching — size limits are skipped.');
    expect(C.profileGaps(profile({ employee_count: null }))[0].text).toMatch(/^No company size/);
    expect(C.profileGaps({ found: false })[0].field).toBe('profile');
  });

  test('readable sizes', () => {
    for (const v of ['2-10', '11-50', '10-50 employees', '1,001+ employees', '51-100 employees', 12]) expect(C.readableSize(v)).toBe(true);
    for (const v of ['Just me', 'small', '', null]) expect(C.readableSize(v)).toBe(false);
  });
});

describe('goals and goal tracks', () => {
  test('active goals in definition order; archived or deleted ones are earlier; names map to their track', () => {
    const g = C.shapeGoals([
      { id: 1, name: 'Hire and Train People', status: 'active', created_at: '2026-09-14T00:00:00Z', deleted_at: null },
      { id: 2, name: 'Improved Productivity', status: 'active', created_at: '2026-10-13T00:00:00Z', deleted_at: null },
      { id: 3, name: 'Domestic Growth', status: 'archived', created_at: '2026-09-21T00:00:00Z', deleted_at: '2026-10-13T00:00:00Z' }
    ]);
    expect(g.active.map((x) => [x.name, x.track])).toEqual([['Hire and Train People', 'Hire or Train People'], ['Improved Productivity', 'Improve Productivity']]);
    expect(g.earlier.map((x) => x.name)).toEqual(['Domestic Growth']);
    expect(C.sectionFor('Grants for Startups')).toBe('Grants for Startups');
  });

  test('shown grants in order with eligibility; the AI review cut, moves and unshown cuts are marked', () => {
    const t = C.buildGoalTracks({
      goals: [{ name: 'Hire and Train People', track: 'Hire or Train People' }, { name: 'Improve Sustainability', track: 'Improve Sustainability' },
        { name: 'Domestic Growth', track: 'Domestic Growth' }],
      run: { result_set_id: 'rs1', at: '2026-10-13T19:17:14Z' },
      sections: [{ section: 'Hire or Train People', considered: 190, shown: 2 }, { section: 'Improve Sustainability', considered: 190, shown: 0 },
        { section: 'funding_matches', considered: 190, shown: 0 }],
      runRows: [
        { section: 'Hire or Train People', grant_id: 11, shown: true, position: 1, eligibility: 'Likely' },
        { section: 'Hire or Train People', grant_id: 10, shown: true, position: 0, eligibility: 'Likely' },
        { section: 'Hire or Train People', grant_id: 12, shown: false, position: null, eligibility: 'Likely', deleted_at_stage: 'cap' }
      ],
      reviewRows: [
        { track: 'Hire or Train People', grant_id: 11, action: 'moved_up', final_rank: 1, reason: 'Better fit.' },
        { track: 'Hire or Train People', grant_id: 12, action: 'cut', category: 'wrong_industry', reason: 'Natural resources only.' }
      ],
      grantNames: new Map([[10, 'Youth Internship'], [11, 'PLTC Green Jobs']])
    });
    expect(t.as_of).toBe('2026-10-13T19:17:14.000Z');
    const hire = t.tracks[0];
    expect(hire).toMatchObject({ goal: 'Hire and Train People', section: 'Hire or Train People', in_run: true, considered: 190, shown: 2 });
    expect(hire.grants.map((g) => [g.grant_id, g.position, g.review?.label ?? null])).toEqual([
      [10, 1, null], [11, 2, 'AI review moved up to #1'], [12, null, 'AI review cut: wrong industry']
    ]);
    expect(hire.grants[2]).toMatchObject({ shown: false, removed_at: 'cap', grant_name: null, review: { action: 'cut', reason: 'Natural resources only.' } });
    expect(t.tracks[1]).toMatchObject({ goal: 'Improve Sustainability', in_run: true, considered: 190, shown: 0, grants: [] });
    expect(t.tracks[2]).toMatchObject({ goal: 'Domestic Growth', in_run: false });
    expect(t.tracks[3]).toMatchObject({ goal: 'All goals', section: 'funding_matches' });
  });
});

describe('timeline', () => {
  test('one stream, newest first, undated dropped, capped', () => {
    const t = C.buildTimeline([[{ at: '2026-10-01T00:00:00Z', type: 'a' }], [{ at: '2026-10-03T00:00:00Z', type: 'b' }, { at: null, type: 'x' }], [{ at: '2026-10-02T00:00:00Z', type: 'c' }]]);
    expect(t.map((e) => e.type)).toEqual(['b', 'c', 'a']);
    expect(C.buildTimeline([Array.from({ length: 5 }, (_, i) => ({ at: `2026-10-0${i + 1}`, type: i }))], 2)).toHaveLength(2);
  });
});

describe('companyDetail', () => {
  const app = jest.fn(async (sql) => {
    const rows = {
      [C.COMPANY_SQL]: [{ id: 135, name: 'NYA Ventures', created_at: '2026-10-13T19:14:00Z', deleted_at: null, is_client: true,
        business_type: 'Incorporated', incorporation_date: '2020-03-05', goal_answers: 14 }],
      [C.GOALS_SQL]: [{ id: 1, name: 'Hire and Train People', status: 'active', created_at: '2026-10-13T00:00:00Z', deleted_at: null },
        { id: 2, name: 'Improve Sustainability', status: 'active', created_at: '2026-10-13T00:00:00Z', deleted_at: null }],
      [C.OPENS_SQL]: [{ id: 'v1', started_at: '2026-10-13T19:19:00Z', grant_root_id: 10, source: 'advisor', visible_ms: 2400 }],
      [C.OPEN_TOTALS_SQL]: [{ views: 2, grants: 2, visible_ms: 12000 }],
      [C.RATINGS_SQL]: [{ id: 'r1', created_at: '2026-10-13T19:20:00Z', grant_root_id: 10, rating: 'down', previous_rating: 'up' }],
      [C.WATCHLIST_EVENTS_SQL]: [{ id: 1, grant_root_id: 10, created_at: '2026-10-13T19:21:00Z', deleted_at: '2026-10-13T19:22:00Z' }],
      [C.COMPANY_CLERKS_SQL]: [{ clerk_id: 'user_nya', company_id: 135 }]
    }[sql];
    if (!rows) throw new Error(`unexpected app SQL ${sql.slice(0, 40)}`);
    return { rows };
  });
  const ops = jest.fn(async (sql) => {
    const rows = {
      [C.LATEST_RUN_SQL]: [{ result_set_id: 'rs1', at: '2026-10-13T19:17:14Z' }],
      [C.RUNS_SQL]: [{ result_set_id: 'rs1', at: '2026-10-13T19:17:14Z', shown: 5, sections: 1 }],
      [C.CONVERSATIONS_SQL]: [{ id: 290, user_id: 'user_nya', created_at: '2026-10-13T19:15:53Z', updated_at: '2026-10-13T19:31:59Z', first_question: 'Women-led startup grants?', questions: 5 }],
      [C.RUN_ROWS_SQL]: [{ section: 'Hire or Train People', grant_id: 10, shown: true, position: 0, eligibility: 'Likely' }],
      [C.RUN_REVIEW_SQL]: [],
      [C.RUN_SECTIONS_SQL]: [{ section: 'Hire or Train People', considered: 190, shown: 5 }, { section: 'Improve Sustainability', considered: 190, shown: 0 }],
      [C.RUN_STAGES_SQL]: [
        { section: 'Improve Sustainability', stage: 'eligibility', n: 119 }, { section: 'Improve Sustainability', stage: 'genre_floor', n: 39 },
        { section: 'Hire or Train People', stage: 'shown', n: 5 }
      ]
    }[sql];
    if (!rows) throw new Error(`unexpected ops SQL ${sql.slice(0, 40)}`);
    return { rows };
  });
  const hub = jest.fn(async (sql) => {
    if (sql === C.COMPANY_CARDS_SQL) return { rows: [{ id: '110', kind: 'chat', status: 'diagnosed', owner: 'chris', company_id: 135, chat_turn_ref: 'conv:290:left_unanswered', flag_count: 1, created_at: '2026-10-15T05:22:00Z', closed_at: null }] };
    if (sql === C.GRANT_NAMES_SQL) return { rows: [{ id: 10, grant_name: 'Alberta Innovates - Voucher' }] };
    if (sql === C.VIEWS_SQL) return { rows: [{ conversation_id: 290, viewer: 'x@granted.ca', last_viewed_at: '2026-10-15T12:50:00Z', views: 2 }] };
    if (sql === C.STAFF_NAMES_SQL) return { rows: [{ email: 'x@granted.ca', name: 'Local Test' }] };
    if (sql === C.EMPTY_TRACK_CARDS_SQL) return { rows: [{ id: '112', goal_track: 'Improve Sustainability', status: 'new' }] };
    if (sql === C.PATTERN_CARDS_FOR_CLERKS_SQL) return { rows: [
      { id: '110', kind: 'grant_pattern', status: 'diagnosed', grant_root_id: 928, pattern_category: 'wrong_industry', grant_name: 'Green Corps', flag_count: 4, cuts_for_client: 2, created_at: '2026-10-15T05:00:00Z' },
      { id: '19', kind: 'grant_pattern', status: 'diagnosed', grant_root_id: 928, pattern_category: 'wrong_industry', grant_name: 'Green Corps', flag_count: 4, cuts_for_client: 2, created_at: '2026-10-15T05:00:00Z' }
    ] };
    throw new Error(`unexpected hub SQL ${sql.slice(0, 40)}`);
  });
  const deps = {
    appQuery: app, opsQuery: ops, hubQuery: hub, env: { PUBLIC_URL: 'https://hub.test' },
    companyProfile: async () => ({ found: true, engine: { industries: ['Agriculture'], provinces: ['Alberta'], employee_count: '2-10', annual_revenue: null }, also_on_record: {}, differs: {} })
  };

  test('the page: tiles, profile gaps, goals, tracks, timeline, chats with viewers, cards — read only', async () => {
    const d = await C.companyDetail('135', deps);
    expect(d.company).toMatchObject({ id: 135, name: 'NYA Ventures', internal: false, users: 1 });
    expect(d.tiles).toEqual({ grant_views: 2, grants_opened: 2, minutes_on_grants: 0.2, thumbs_up: 0, thumbs_down: 1, chats: 1 });
    expect(d.profile.gaps.map((g) => g.field)).toEqual(['annual_revenue']);
    expect(d.profile).toMatchObject({ business_type: 'Incorporated', incorporation_date: '2020-03-05' });
    expect(d.goals).toMatchObject({ module_answers: 14, active: [{ name: 'Hire and Train People', track: 'Hire or Train People' }, { name: 'Improve Sustainability' }] });
    expect(d.goal_tracks.tracks[0]).toMatchObject({ empty: false });
    expect(d.goal_tracks.tracks[0].grants[0]).toMatchObject({ grant_name: 'Alberta Innovates - Voucher', position: 1 });
    // A track that showed nothing says where the considered grants went.
    expect(d.goal_tracks.tracks[1]).toMatchObject({ goal: 'Improve Sustainability', empty: true, considered: 190, removed: [
      { stage: 'eligibility', words: 'failed eligibility', n: 119 }, { stage: 'genre_floor', words: 'below the topic match floor', n: 39 }],
      card: { id: 112, status: 'new' } });
    expect(d.timeline.map((e) => e.type)).toEqual(['card_filed', 'unsaved', 'saved', 'rated', 'opened', 'matches', 'chat', 'signed_up']);
    expect(d.timeline.find((e) => e.type === 'opened')).toMatchObject({ source: 'Chat', seconds: 2, grant_name: 'Alberta Innovates - Voucher' });
    expect(d.timeline.find((e) => e.type === 'rated').text).toBe('👎 Alberta Innovates - Voucher (changed from 👍)');
    expect(d.chats[0]).toMatchObject({ conversation_id: 290, questions: 5, viewed_by: [{ viewer: 'x@granted.ca', name: 'Local Test', views: 2 }] });
    expect(d.review_cards[0]).toMatchObject({ id: 110, title: 'Question left unanswered (NYA Ventures)', link: 'https://hub.test/control-centre#review/110' });
    // Patterns whose cuts include this client follow, labelled; one already listed as the company's own isn't repeated.
    expect(d.review_cards.slice(1)).toEqual([expect.objectContaining({ id: 19, kind: 'grant_pattern', involves_client: true, cuts_for_client: 2,
      title: 'Green Corps — cut for several companies (wrong industry)' })]);
    expect(hub).toHaveBeenCalledWith(C.PATTERN_CARDS_FOR_CLERKS_SQL, [['user_nya']]);
    for (const q of [app, ops, hub]) expect(q.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });

  test('an empty-track card is titled by its goal track', async () => {
    const hubWithEmpty = jest.fn(async (sql, p) => (sql === C.COMPANY_CARDS_SQL
      ? { rows: [{ id: '112', kind: 'empty_track', status: 'new', company_id: 135, goal_track: 'Improve Sustainability', flag_count: 1, created_at: '2026-10-15T13:10:00Z' }] }
      : hub(sql, p)));
    expect(C.COMPANY_CARDS_SQL).toMatch(/i\.goal_track/);
    const feed = await C.companyFeed('135', { ...deps, hubQuery: hubWithEmpty });
    expect(feed.review_cards[0]).toMatchObject({ id: 112, kind: 'empty_track', title: 'Improve Sustainability track showed NYA Ventures nothing' });
  });

  test('the page loads in two halves: core has no timeline, chats or cards; the feed has them', async () => {
    const core = await C.companyCore('135', deps);
    expect(Object.keys(core).sort()).toEqual(['company', 'goal_tracks', 'goals', 'profile']);
    const feed = await C.companyFeed('135', deps);
    expect(Object.keys(feed).sort()).toEqual(['chats', 'company_id', 'last_active', 'review_cards', 'tiles', 'timeline', 'users']);
  });

  test('last active is the latest client action, not a later match run or review card', async () => {
    const opsLateRun = jest.fn(async (sql, p) => (sql === C.RUNS_SQL
      ? { rows: [{ result_set_id: 'rs2', at: '2026-10-20T10:00:00Z', shown: 5, sections: 1 }] }
      : ops(sql, p)));
    const feed = await C.companyFeed('135', { ...deps, opsQuery: opsLateRun });
    expect(feed.timeline[0].type).toBe('matches');
    expect(feed.last_active).toBe('2026-10-13T19:22:00.000Z'); // the watchlist removal
  });

  test('a company whose only timeline entry is its sign-up has no last active', async () => {
    const quietApp = jest.fn(async (sql, p) => ([C.OPENS_SQL, C.RATINGS_SQL, C.WATCHLIST_EVENTS_SQL].includes(sql) ? { rows: [] } : app(sql, p)));
    const quietOps = jest.fn(async (sql, p) => ([C.RUNS_SQL, C.CONVERSATIONS_SQL].includes(sql) ? { rows: [] } : ops(sql, p)));
    const quietHub = jest.fn(async (sql, p) => (sql === C.COMPANY_CARDS_SQL ? { rows: [] } : hub(sql, p)));
    const feed = await C.companyFeed('135', { ...deps, appQuery: quietApp, opsQuery: quietOps, hubQuery: quietHub });
    expect(feed.timeline.map((e) => e.type)).toEqual(['signed_up']);
    expect(feed.last_active).toBeNull();
  });

  test('bad id 400, unknown company 404', async () => {
    await expect(C.companyDetail('abc', deps)).rejects.toMatchObject({ status: 400 });
    await expect(C.companyDetail('5', { ...deps, appQuery: async () => ({ rows: [] }) })).rejects.toMatchObject({ status: 404 });
  });
});

describe('fileEmptyTrack', () => {
  const core = {
    company: { id: 135, name: 'NYA Ventures' },
    profile: { found: true, engine: { industries: ['Agriculture'], provinces: ['Alberta'], employee_count: '2-10', annual_revenue: null },
      business_type: 'Incorporated', gaps: [{ field: 'annual_revenue', text: 'No revenue — revenue limits are skipped.' }] },
    goal_tracks: { result_set_id: 'rs1', as_of: '2026-10-13T19:17:14.000Z', tracks: [
      { goal: 'Hire and Train People', section: 'Hire or Train People', in_run: true, shown: 5, empty: false, grants: [] },
      { goal: 'Improve Sustainability', section: 'Improve Sustainability', in_run: true, considered: 190, shown: 0, empty: true,
        removed: [{ stage: 'eligibility', words: 'failed eligibility', n: 119 }], grants: [] }
    ] }
  };
  // fileEmptyTrack builds on companyCore; drive it through the same deps with a stubbed core.
  const deps = (addFlag) => ({
    addFlag, env: { PUBLIC_URL: 'https://hub.test' },
    appQuery: async (sql) => ({ rows: sql === C.COMPANY_SQL ? [{ id: 135, name: 'NYA Ventures', created_at: '2026-10-13T19:14:00Z' }]
      : sql === C.GOALS_SQL ? [{ id: 2, name: 'Improve Sustainability', status: 'active', created_at: '2026-10-13T00:00:00Z', deleted_at: null },
        { id: 1, name: 'Hire and Train People', status: 'active', created_at: '2026-10-13T00:00:00Z', deleted_at: null }] : [] }),
    opsQuery: async (sql) => ({ rows: sql === C.LATEST_RUN_SQL ? [{ result_set_id: 'rs1', at: '2026-10-13T19:17:14Z' }]
      : sql === C.RUN_SECTIONS_SQL ? [{ section: 'Improve Sustainability', considered: 190, shown: 0 }, { section: 'Hire or Train People', considered: 190, shown: 5 }]
        : sql === C.RUN_STAGES_SQL ? [{ section: 'Improve Sustainability', stage: 'eligibility', n: 119 }]
          : sql === C.RUN_ROWS_SQL ? [{ section: 'Hire or Train People', grant_id: 10, shown: true, position: 0 }] : [] }),
    hubQuery: async () => ({ rows: [] }),
    companyProfile: async () => core.profile
  });

  test('one click files a staff empty_track card with evidence built server-side', async () => {
    const addFlag = jest.fn(async () => ({ item: { id: '200' }, created: true, reopened: false }));
    const r = await C.fileEmptyTrack('135', 'Improve Sustainability', '', 'x@granted.ca', deps(addFlag));
    expect(r).toEqual({ id: 200, created: true, reopened: false, link: 'https://hub.test/control-centre#review/200' });
    const [input] = addFlag.mock.calls[0];
    expect(input).toMatchObject({ kind: 'empty_track', company_id: 135, goal_track: 'Improve Sustainability', source: 'staff_flag', actor: 'x@granted.ca',
      comment: 'Improve Sustainability: 190 grants considered, none shown.' });
    expect(input.snapshot).toMatchObject({ source: 'empty_track', goal: 'Improve Sustainability', considered: 190,
      removed: [{ words: 'failed eligibility', n: 119 }], profile_gaps: ['No revenue — revenue limits are skipped.'],
      other_goals: [{ goal: 'Hire and Train People', shown: 5 }] });
  });

  test('a track that showed grants is a 409, an unknown track a 404, no staff member a 400', async () => {
    const addFlag = jest.fn();
    await expect(C.fileEmptyTrack('135', 'Hire or Train People', '', 'x@granted.ca', deps(addFlag))).rejects.toMatchObject({ status: 409 });
    await expect(C.fileEmptyTrack('135', 'Space Travel', '', 'x@granted.ca', deps(addFlag))).rejects.toMatchObject({ status: 404 });
    await expect(C.fileEmptyTrack('135', 'Improve Sustainability', '', null, deps(addFlag))).rejects.toMatchObject({ status: 400 });
    expect(addFlag).not.toHaveBeenCalled();
  });
});

describe('whyMatched', () => {
  test('bad_match for the company and grant, trimmed to the checks (no profile, no card text)', async () => {
    const fetchBadMatch = jest.fn(async () => ({ ok: true, body: {
      grant_name: 'G', passes_eligibility_now: true, candidate_cause: { cause: 'NO_CONSTRAINT_TAG' }, axes: [{ axis: 'industry' }],
      lenient_axes: [], review_log: Array.from({ length: 12 }, (_, i) => ({ i })), recorded: { shown_history: { runs: 2 }, latest_run: { rows: [] } },
      profile_used: { secret: 1 }, card: { eligibility_sections: 'long' }, llm_calls: []
    } }));
    const r = await C.whyMatched('81', '1196', { fetchBadMatch });
    expect(fetchBadMatch).toHaveBeenCalledWith({ grantId: 1196, companyId: 81 }, expect.anything());
    expect(Object.keys(r).sort()).toEqual(['axes', 'candidate_cause', 'company_id', 'grant_id', 'grant_name', 'lenient_axes', 'passes_eligibility_now', 'recorded', 'review_log']);
    expect(r.review_log).toHaveLength(8);
    expect(JSON.stringify(r)).not.toMatch(/secret|eligibility_sections|llm_calls/);
  });

  test('not configured → not_configured; a service error → 502 with the code; bad grant 400', async () => {
    await expect(C.whyMatched(81, 1, { fetchBadMatch: async () => ({ ok: false, code: 'not_configured' }) })).rejects.toMatchObject({ code: 'not_configured' });
    await expect(C.whyMatched(81, 1, { fetchBadMatch: async () => ({ ok: false, code: 'explain_422_company_not_resolved' }) }))
      .rejects.toMatchObject({ status: 502, message: 'match explanation unavailable (explain_422_company_not_resolved)' });
    await expect(C.whyMatched(81, 'x', { fetchBadMatch: async () => ({ ok: true, body: {} }) })).rejects.toMatchObject({ status: 400 });
  });
});

describe('transcript', () => {
  const messages = [{ role: 'user', content: 'Women-led grants?' }, { role: 'assistant', content: 'Here are three.' }];
  const deps = (over = {}) => ({
    appQuery: jest.fn(async () => ({ rows: [{ clerk_id: 'user_nya', company_id: 135 }] })),
    opsQuery: jest.fn(async () => ({ rows: [{ id: 290, user_id: 'user_nya', messages }] })),
    hubQuery: jest.fn(async (sql) => (sql === C.VIEWS_SQL ? { rows: [{ conversation_id: 290, viewer: 'x@granted.ca', last_viewed_at: '2026-10-15T13:00:00Z', views: 1 }] }
      : sql === C.STAFF_NAMES_SQL ? { rows: [{ email: 'x@granted.ca', name: 'Local Test' }] } : { rows: [] })),
    ...over
  });

  test('this company\'s conversation: verbatim turns, the view logged with the viewer, who has viewed it', async () => {
    const d = deps();
    const r = await C.transcript('135', '290', 'x@granted.ca', d);
    expect(r.turns).toEqual([expect.objectContaining({ turn_index: 0, client: 'Women-led grants?', assistant: 'Here are three.' })]);
    expect(d.hubQuery).toHaveBeenCalledWith(C.INSERT_VIEW_SQL, [290, 135, 'x@granted.ca']);
    expect(r.viewed_by).toEqual([{ viewer: 'x@granted.ca', name: 'Local Test', last_viewed_at: '2026-10-15T13:00:00.000Z', views: 1 }]);
    expect(d.opsQuery.mock.calls.every(([sql]) => /^\s*SELECT/i.test(sql))).toBe(true);
  });

  test('another company\'s conversation is a 404 and logs nothing; no viewer is a 400', async () => {
    const d = deps({ opsQuery: jest.fn(async () => ({ rows: [{ id: 290, user_id: 'user_someone_else', messages }] })) });
    await expect(C.transcript('83', '290', 'x@granted.ca', d)).rejects.toMatchObject({ status: 404 });
    expect(d.hubQuery).not.toHaveBeenCalledWith(C.INSERT_VIEW_SQL, expect.anything());
    await expect(C.transcript('135', '290', null, deps())).rejects.toMatchObject({ status: 400 });
  });

  test('048 is the only Hub write, and it is an INSERT into cc_transcript_views', () => {
    expect(C.INSERT_VIEW_SQL).toMatch(/^\s*INSERT INTO cc_transcript_views/);
    const writes = Object.entries(C).filter(([, v]) => typeof v === 'string' && /\b(INSERT|UPDATE|DELETE)\b/.test(v)).map(([k]) => k);
    expect(writes).toEqual(['INSERT_VIEW_SQL']);
  });
});

describe('routes', () => {
  async function serve(overrides, user = { email: 'x@granted.ca' }) {
    const app = express();
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/companies', createCompaniesRouter(overrides));
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}/companies`;
    return {
      get: async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; },
      post: async (p, b) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; },
      close: () => new Promise((r) => server.close(r))
    };
  }

  test('list, detail, why and transcript pass through; the transcript gets the signed-in email', async () => {
    const f = {
      companyList: jest.fn(async (range) => ({ range, companies: [] })),
      companyCore: jest.fn(async (id) => ({ company: { id: Number(id) } })),
      companyFeed: jest.fn(async (id) => ({ company_id: Number(id), timeline: [] })),
      fileEmptyTrack: jest.fn(async (id, track, note, actor) => ({ id: 200, created: true, track, actor })),
      whyMatched: jest.fn(async (id, grant) => ({ company_id: Number(id), grant_id: Number(grant) })),
      transcript: jest.fn(async (id, conv, viewer) => ({ conversation_id: Number(conv), viewer }))
    };
    const s = await serve(f);
    expect((await s.get('/?range=month')).body).toEqual({ range: 'month', companies: [] });
    expect((await s.get('/')).body.range).toBe('week');
    expect((await s.get('/135')).body).toEqual({ company: { id: 135 } });
    expect((await s.get('/135/feed')).body).toEqual({ company_id: 135, timeline: [] });
    expect(await s.post('/135/empty-track', { track: 'Improve Sustainability' }))
      .toEqual({ status: 201, body: { id: 200, created: true, track: 'Improve Sustainability', actor: 'x@granted.ca' } });
    expect((await s.get('/81/why?grant=1196')).body).toEqual({ company_id: 81, grant_id: 1196 });
    expect((await s.get('/135/chats/290')).body).toEqual({ conversation_id: 290, viewer: 'x@granted.ca' });
    await s.close();
  });

  test('errors map: 400/404 from the module, 503 not configured or missing migration, 502 from match-explain', async () => {
    const s = await serve({
      companyList: async () => { throw new C.CompaniesError(400, 'range must be one of day, week, month, year'); },
      companyCore: async () => { throw new C.CompaniesError(404, 'company not found'); },
      whyMatched: async () => { throw Object.assign(new Error('x'), { code: 'not_configured' }); },
      transcript: async () => { throw Object.assign(new Error('relation "cc_transcript_views" does not exist'), { code: '42P01' }); }
    });
    expect(await s.get('/?range=x')).toEqual({ status: 400, body: { error: 'range must be one of day, week, month, year' } });
    expect((await s.get('/5')).status).toBe(404);
    expect(await s.get('/81/why?grant=1')).toEqual({ status: 503, body: { error: 'not_configured' } });
    expect(await s.get('/135/chats/290')).toEqual({ status: 503, body: { error: 'migration_missing' } });
    await s.close();
    const s2 = await serve({ whyMatched: async () => { throw new C.CompaniesError(502, 'match explanation unavailable (explain_timeout)'); } });
    expect(await s2.get('/81/why?grant=1')).toEqual({ status: 502, body: { error: 'match explanation unavailable (explain_timeout)' } });
    await s2.close();
  });
});
