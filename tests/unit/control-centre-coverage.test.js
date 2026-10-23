/**
 * control-centre Coverage & changes tab: the industry rows (restricted vs open
 * to every industry, clients, ran matching, average grant matches, the thin
 * flag), both Not matching rules, wrong-industry cut counts, the internal
 * toggle, the breakdowns' goal-track gaps, deadline parsing and the passed /
 * due-soon flags, catalogue transitions, the routes and Oracle's two modes.
 * Fixtures and injected deps only — no DB, no network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-coverage.test.js
 */

import { jest } from '@jest/globals';
import express from 'express';

const C = await import('../../src/control-centre/coverage.js');
const { createCoverageRouter } = await import('../../src/control-centre/coverage-routes.js');
const O = await import('../../src/control-centre/overview.js');
const T = await import('../../src/tools/control-centre-tools.js');

beforeEach(() => { C._clearCacheForTests(); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

const INTERNAL = new Set([81]);
const isInternal = (id) => INTERNAL.has(id);
const DAYS = ['2026-10-13', '2026-10-14', '2026-10-15'];
const live = (id, extra = {}) => ({ root_id: id, title: `Grant ${id}`, grantor: 'Funder', deadline: null, ...extra });
const tag = (id, level, industries = [], extra = {}) => ({ id, grant_name: `Grant ${id}`, grant_type: 'Hiring', regions: ['All of Canada'],
  industry: { restriction_level: level, industries }, ...extra });
const shown = (company, grant, extra = {}) => ({ day: '2026-10-14', company_id: company, grant_id: grant, section: 'Hire or Train People',
  times_computed: 1, times_shown: 1, ai_review_action: null, ...extra });
const computed = (company, grant) => shown(company, grant, { times_shown: 0 });

/** shown rows for `n` distinct grants to one company. */
const shownN = (company, n, from = 900) => Array.from({ length: n }, (_, i) => shown(company, from + i));

function input(over = {}) {
  return {
    range: 'week', from: DAYS[0], to: DAYS[2], days: DAYS,
    grants: [live(1), live(2), live(3), live(4)],
    tagRows: [
      tag(1, 'umbrella', ['Agriculture', 'Agriculture - Dairy']),
      tag(2, 'specific', ['Tech - AI']),
      tag(3, 'agnostic'),
      tag(4, 'agnostic', [], { grant_type: 'Loan', regions: ['Alberta'] })
    ],
    clients: [], metadata: new Map(), names: new Map(), matches: [], cuts: [], tracks: [], cards: [],
    data: { last_rolled_day: '2026-10-14', live_days: 1 }, now: Date.parse('2026-10-15T20:00:00Z'),
    ...over
  };
}
const withClients = (list) => ({
  clients: list.map(([id]) => ({ id })),
  metadata: new Map(list.map(([id, industries, provinces = ['British Columbia']]) => [id, { industries, provinces }])),
  names: new Map(list.map(([id]) => [id, `Company ${id}`]))
});
const ind = (cov, name, variant = 'clients_variant') => cov[variant].industries.flatMap((r) => [r, ...r.specifics]).find((r) => r.industry === name);

describe('industry rows', () => {
  test('restricted vs open to every industry, by main and by exact token', () => {
    const cov = C.buildCoverage(input(), { isInternal });
    expect(cov.catalogue).toMatchObject({ live_grants: 4, in_hub_copy: 4, open_to_all: 2, restricted: 2, not_in_hub_copy: [] });
    expect(ind(cov, 'Agriculture')).toMatchObject({ level: 'main', restricted: 1, restricted_ids: [1], open_to_all: 2 });
    expect(ind(cov, 'Software')).toMatchObject({ restricted: 1, restricted_ids: [2] });
    expect(ind(cov, 'Tech - AI')).toMatchObject({ level: 'specific', main: 'Software', restricted: 1 });
    expect(ind(cov, 'Agriculture - Dairy').restricted).toBe(1);
    expect(ind(cov, 'Agriculture - Crop').restricted).toBe(0);
    // The main name is itself a tag token: its "general" row counts grants tagged with it.
    expect(ind(cov, 'Agriculture, general')).toMatchObject({ general: true, restricted: 1 });
    expect(cov.clients_variant.industries).toHaveLength(16);
  });

  test('a grant missing from the Hub copy is counted apart, not as open to every industry', () => {
    const cov = C.buildCoverage(input({ grants: [live(1), live(77)] }), { isInternal });
    expect(cov.catalogue).toMatchObject({ live_grants: 2, in_hub_copy: 1, not_in_hub_copy: [77], open_to_all: 0 });
  });

  test('clients map like the engine: alias, main name ("general"), token; unknown values go to Not mapped', () => {
    const cov = C.buildCoverage(input(withClients([
      [10, ['Software and IT']], [11, ['Tech - AI']], [12, ['Software']], [13, ['Other']], [14, ['Real Estate', 'Accounting']]
    ])), { isInternal });
    expect(ind(cov, 'Software').clients).toBe(3);
    expect(ind(cov, 'Software, general').client_ids).toEqual([10, 12]);
    expect(ind(cov, 'Tech - AI').client_ids).toEqual([11]);
    expect(ind(cov, 'Professional Services').client_ids).toEqual([14]);
    expect(cov.clients_variant.not_mapped.client_ids).toEqual([13]);
  });

  test('average grant matches: distinct grants shown ÷ clients who ran matching; dormant clients are not averaged in', () => {
    const cov = C.buildCoverage(input({
      ...withClients([[10, ['Retail']], [11, ['Retail']], [12, ['Retail']]]),
      matches: [...shownN(10, 4), shown(10, 900), computed(11, 5), shown(10, 1, { day: '2026-10-01' })]
    }), { isInternal });
    expect(ind(cov, 'Retail')).toMatchObject({ clients: 3, ran_matching: 2, grant_matches: 4, avg_matches: 2 });
  });
});

describe('thin flag', () => {
  const thinOf = (clients) => {
    const list = clients.map((n, i) => [100 + i, ['Construction']]);
    const matches = clients.flatMap((n, i) => (n === 0 ? [computed(100 + i, 5)] : shownN(100 + i, n)));
    return ind(C.buildCoverage(input({ ...withClients(list), matches }), { isInternal }), 'Construction');
  };
  test('one client who ran matching is never thin, however few matches', () => {
    expect(C.THIN_MIN_CLIENTS).toBe(2);
    expect(thinOf([0])).toMatchObject({ ran_matching: 1, thin: false });
  });
  test('two clients averaging exactly 3 are not thin; 2.9 is', () => {
    expect(C.THIN_MAX_AVG).toBe(3);
    expect(thinOf([3, 3])).toMatchObject({ avg_matches: 3, thin: false });
    expect(thinOf([3, 2, 4, 3, 3, 3, 2, 3, 3, 3])).toMatchObject({ avg_matches: 2.9, thin: true });
    expect(thinOf([1, 0])).toMatchObject({ avg_matches: 0.5, thin: true });
  });
});

describe('not matching', () => {
  test('(a) zero matches split: ran matching and got none (a gap) vs not run matching yet (not a gap); (b) no restricted grants', () => {
    const cov = C.buildCoverage(input({
      ...withClients([[10, ['Finance']], [11, ['Finance']], [12, ['Education']], [13, ['Agriculture']], [14, ['Agriculture']],
        [15, ['Retail']], [16, ['Retail']], [17, ['Health']]]),
      // Finance: one client ran matching and got nothing, one didn't run. Retail: two ran, nothing. Health: one ran, nothing.
      matches: [computed(10, 5), shown(13, 1), computed(15, 5), computed(16, 6), computed(17, 7)]
    }), { isInternal });
    const nm = C.applyCoverageView(cov.clients_variant.industries, 'not_matching');
    expect(nm.no_matches).toBeUndefined();
    const ranZero = nm.ran_zero.map((r) => r.industry);
    const notRun = nm.not_run.map((r) => r.industry);
    // Most clients who ran matching first.
    expect(ranZero.slice(0, 2)).toEqual(['Retail', 'Retail, general']);
    expect(ranZero).toEqual(expect.arrayContaining(['Finance', 'Health']));
    // Some of Finance's clients didn't run, but one ran and got nothing: it is a gap, listed once.
    expect(notRun).not.toContain('Finance');
    expect(notRun).toContain('Education');
    expect(ranZero).not.toContain('Education');
    // An industry with any match is in neither list, even if some of its clients haven't run matching.
    expect(ranZero).not.toContain('Agriculture');
    expect(notRun).not.toContain('Agriculture');
    expect(nm.ran_zero.every((r) => r.ran_matching > 0 && r.grant_matches === 0)).toBe(true);
    expect(nm.not_run.every((r) => r.clients > 0 && r.ran_matching === 0)).toBe(true);
    const b = new Map(nm.no_restricted.map((x) => [x.row.industry, x]));
    expect(b.get('Finance').main_has_none).toBe(true);
    expect(b.get('Clean Technology')).toMatchObject({ main_has_none: true });
    expect(b.get('Clean Technology').row.clients).toBe(0);
    // Agriculture has a restricted grant, but some of its specific industries have none.
    expect(b.get('Agriculture').main_has_none).toBe(false);
    expect(b.get('Agriculture').specifics.map((s) => s.industry)).toContain('Agriculture - Crop');
    expect(b.get('Agriculture').specifics.map((s) => s.industry)).not.toContain('Agriculture - Dairy');
    expect(C.applyCoverageView(cov.clients_variant.industries, 'all')).toBe(cov.clients_variant.industries);
  });
});

describe('wrong-industry cuts', () => {
  test('one per client and grant; a client in two main industries counts in both; the grants are listed', () => {
    const cov = C.buildCoverage(input({
      ...withClients([[10, ['Tech - Video Game']], [11, ['Software']]]),
      cuts: [{ company_id: 10, grant_id: 1 }, { company_id: 10, grant_id: 1 }, { company_id: 10, grant_id: 4 }, { company_id: 11, grant_id: 1 }]
    }), { isInternal });
    expect(ind(cov, 'Software')).toMatchObject({ wrong_industry_cuts: 3, cut_grants: [{ grant_id: 1, clients: 2 }, { grant_id: 4, clients: 1 }] });
    expect(ind(cov, 'Digital Media')).toMatchObject({ wrong_industry_cuts: 2 });
    expect(ind(cov, 'Tech - Video Game').wrong_industry_cuts).toBe(2);
  });

  test('only wrong_industry cuts are read, keyed to the company through the match row, in the Vancouver window', () => {
    expect(C.WRONG_INDUSTRY_CUTS_SQL).toContain("a.action = 'cut' AND a.category = 'wrong_industry'");
    expect(C.WRONG_INDUSTRY_CUTS_SQL).toContain('m.result_set_id = a.result_set_id AND m.grant_id = a.grant_id AND m.section = a.track');
    expect(C.WRONG_INDUSTRY_CUTS_SQL).toContain("AT TIME ZONE 'America/Vancouver'");
    expect(C.WRONG_INDUSTRY_CUTS_SQL).toMatch(/SELECT DISTINCT m\.company_id, a\.grant_id/);
  });
});

describe('internal toggle', () => {
  test('clients variant drops internal accounts; all keeps them; an internal-only industry is empty without them', () => {
    const cov = C.buildCoverage(input({
      ...withClients([[81, ['Energy']], [10, ['Retail']]]),
      matches: [shown(81, 1), shown(10, 2)],
      cuts: [{ company_id: 81, grant_id: 3 }]
    }), { isInternal });
    expect(ind(cov, 'Energy')).toMatchObject({ clients: 0, ran_matching: 0, wrong_industry_cuts: 0 });
    expect(ind(cov, 'Energy', 'all_variant')).toMatchObject({ clients: 1, ran_matching: 1, grant_matches: 1, wrong_industry_cuts: 1 });
    expect(ind(cov, 'Retail')).toEqual(ind(cov, 'Retail', 'all_variant'));
    expect(cov.clients[81]).toMatchObject({ internal: true });
    const nmClients = C.applyCoverageView(cov.clients_variant.industries, 'not_matching');
    expect([...nmClients.ran_zero, ...nmClients.not_run].map((r) => r.industry)).not.toContain('Energy');
  });
});

describe('breakdowns', () => {
  test('province: province-only vs national grants; a Canada-wide client counts everywhere; gaps link their empty-track card', () => {
    const cov = C.buildCoverage(input({
      ...withClients([[10, ['Retail'], ['BC- Lower Mainland']], [11, ['Retail'], ['All of Canada']]]),
      tracks: [
        { company_id: 10, run_at: '2026-10-14T18:00:00Z', section: 'Hire or Train People', shown: 0 },
        { company_id: 10, run_at: '2026-10-14T18:00:00Z', section: 'funding_matches', shown: 2 },
        { company_id: 11, run_at: '2026-10-14T18:00:00Z', section: 'Hire or Train People', shown: 7 }
      ],
      cards: [{ id: '44', company_id: 10, goal_track: 'Hire or Train People', status: 'new' }]
    }), { isInternal });
    const b = cov.clients_variant.breakdowns;
    const ab = b.province.find((p) => p.province === 'Alberta');
    const bc = b.province.find((p) => p.province === 'British Columbia');
    expect(ab).toMatchObject({ restricted: 1, national: 3, clients: 1 });
    expect(bc).toMatchObject({ restricted: 0, clients: 2, empty_tracks: 1, few_tracks: 1 });
    expect(bc.gaps[0]).toMatchObject({ company_id: 10, gap: 'empty', card: { id: 44, link: expect.stringContaining('#review/44') } });
    const hire = b.goal_tracks.find((t) => t.section === 'Hire or Train People');
    expect(hire).toMatchObject({ clients: 2, empty_tracks: 1, few_tracks: 0, avg_shown_latest_run: 3.5 });
    expect(b.goal_tracks.at(-1).label).toBe('All goals');
  });

  test('grant types and grant vs loan from the grant-type label', () => {
    expect(C.fundingOf('Hiring, Training')).toBe('grant');
    expect(C.fundingOf('Loan')).toBe('loan');
    expect(C.fundingOf('Loan, Investment')).toBe('both');
    expect(C.fundingOf(null)).toBe('untagged');
    const cov = C.buildCoverage(input(), { isInternal });
    expect(cov.clients_variant.breakdowns.funding).toEqual({ grant: 3, loan: 1, both: 0, untagged: 0 });
    expect(cov.clients_variant.breakdowns.grant_types).toEqual([{ type: 'Hiring', live_grants: 3 }, { type: 'Loan', live_grants: 1 }]);
  });

  test('regions: sub-regions roll up; every province listed counts as national', () => {
    expect(C.provinceOf('BC- Interior (Thompson/Okanagan + Kootenay)')).toBe('British Columbia');
    expect(C.provinceOf('Ontario - Northern')).toBe('Ontario');
    expect(C.provinceOf('All of Canada')).toBe('national');
    expect(C.provinceOf('Atlantis')).toBeNull();
    expect(C.grantProvinces(C.PROVINCES).national).toBe(true);
    expect(C.grantProvinces(['Alberta', 'BC- Lower Mainland'])).toEqual({ national: false, provinces: new Set(['Alberta', 'British Columbia']) });
  });
});

describe('deadlines', () => {
  test('one parser (src/tools/deadline.js): the formats on record, French months, ordinals; rolling, blank and ambiguous are no date', () => {
    expect(C.parseDeadline('2026-07-15')).toBe('2026-07-15');
    expect(C.parseDeadline('15/04/2021')).toBe('2021-04-15');
    expect(C.parseDeadline('09/09/2026')).toBe('2026-09-09');
    expect(C.parseDeadline('May 27, 2026')).toBe('2026-05-27');
    expect(C.parseDeadline('August 13 2026')).toBe('2026-08-13');
    expect(C.parseDeadline('6 November 2026')).toBe('2026-11-06');
    expect(C.parseDeadline('1st December 2026')).toBe('2026-12-01');
    expect(C.parseDeadline('15 mars 2027')).toBe('2027-03-15');
    expect(C.parseDeadline('Open Until Filled')).toBeNull();
    expect(C.parseDeadline('Ouvert jusqu’à épuisement des fonds')).toBeNull();
    expect(C.parseDeadline('en tout temps')).toBeNull();
    expect(C.parseDeadline('31/02/2026')).toBeNull();
    // Day and month could swap: never guessed (the old coverage parser read it day-first).
    expect(C.parseDeadline('04/09/2026')).toBeNull();
    expect(C.parseDeadline(null)).toBeNull();
  });

  test('deadline passed (before today) and due within 30 days; today itself is due, not passed; days signed from today', () => {
    const f = C.deadlineFlags([
      live(1, { deadline: '2026-10-18' }), live(2, { deadline: '2026-10-19' }), live(3, { deadline: '6 November 2026' }),
      live(4, { deadline: '2026-11-18' }), live(5, { deadline: '2026-11-19' }), live(6, { deadline: 'Open Until Filled' })
    ], '2026-10-19');
    expect(f.passed.map((x) => x.grant_id)).toEqual([1]);
    expect(f.passed[0]).toMatchObject({ grant_id: 1, deadline: '2026-10-18', deadline_text: '2026-10-18', days: -1 });
    expect(f.due_soon.map((x) => [x.grant_id, x.days])).toEqual([[2, 0], [3, 18], [4, 30]]);
    expect(f.no_date).toBe(1);
    expect(C.DUE_SOON_DAYS).toBe(30);
    expect(C.daysFrom('2026-10-19', '2026-10-07')).toBe(-12);
  });

  test('blank, rolling and unreadable deadlines are kept apart (and all count as no date)', () => {
    const grants = [
      live(1, { deadline: '2026-10-18' }), live(2, { deadline: '2026-10-19' }), live(3, { deadline: '2027-01-17' }),
      live(4, { deadline: '2027-01-18' }), live(5, { deadline: '' }), live(6, { deadline: null }),
      live(7, { deadline: 'Open Until Filled' }), live(8, { deadline: 'open until filled' }), live(9, { deadline: 'Ouvert jusqu’à épuisement des fonds' }),
      live(10, { deadline: 'Spring intake' })
    ];
    const f = C.deadlineFlags(grants, '2026-10-19');
    expect(f.passed.map((x) => x.grant_id)).toEqual([1]);
    expect(f.due_soon.map((x) => x.grant_id)).toEqual([2]);
    expect(f.blank.map((x) => x.grant_id)).toEqual([5, 6]);
    expect(f.blank.map((x) => x.deadline_text)).toEqual([null, null]);
    expect(f.rolling.map((x) => x.grant_id)).toEqual([7, 8, 9]);
    expect(f.unreadable.map((x) => x.grant_id)).toEqual([10]);
    expect(f.unreadable[0]).toMatchObject({ deadline: null, deadline_text: 'Spring intake', days: null });
    expect(f.no_date).toBe(6);
  });
});

describe('changes', () => {
  const t = (action, grant, prev, next, at = '2026-10-10T12:00:00Z', extra = {}) => ({ action, grant_id: grant, created_at: at, ...extra,
    ...(action === 'version.publish' ? { prev_status: prev, new_status: next } : { previous_value: prev, new_value: next }) });

  test('went live, closed and removed from version statuses and status changes; live state decides', () => {
    const m = C.catalogueTransitions([
      t('version.publish', 1, 'inactive', 'active'),
      t('version.publish', 2, 'active', 'active'),
      t('version.publish', 3, 'active', 'archived'),
      t('status.amend', 4, 'active', 'inactive'),
      t('status.amend', 5, '', '3405'),
      t('version.publish', 6, null, 'active'),
      t('grant.delete', 7, null, null),
      t('version.publish', 8, 'active', 'inactive', '2026-10-10T12:00:00Z'),
      t('version.publish', 8, 'inactive', 'active', '2026-10-12T12:00:00Z')
    ], [{ grant_id: 9, deleted_at: '2026-10-11T00:00:00Z' }], new Set([1, 2, 6, 8]));
    expect(m.added.map((x) => x.grant_id).sort()).toEqual([1, 6, 8]);
    expect(m.closed.map((x) => [x.grant_id, x.status]).sort()).toEqual([[3, 'archived'], [4, 'inactive']]);
    expect(m.removed.map((x) => x.grant_id).sort()).toEqual([7, 9]);
  });

  test('edits group per grant, newest first, with the editor as on the Grants tab', () => {
    const e = C.editsByGrant([
      { id: 3, grant_id: 1, action: 'field.update', created_at: '2026-10-12T10:00:00Z', user_id: 126, email: 'admin@granted.ca' },
      { id: 2, grant_id: 2, action: 'tags.sync', created_at: '2026-10-11T10:00:00Z', user_id: 5 },
      { id: 1, grant_id: 1, action: 'field.update', created_at: '2026-10-10T10:00:00Z', user_id: 3 }
    ]);
    expect(e.map((x) => x.grant_id)).toEqual([1, 2]);
    expect(e[0]).toMatchObject({ edits: 2, kinds: [{ what: 'Changed a card field', n: 2 }], last_by: { user_id: 126, email: 'admin@granted.ca' } });
    expect(C.RANGE_EDITS_SQL).toContain("a.action NOT LIKE 'version.fork%'");
  });

  test('changes(): the window, titles for grants that are no longer live, links, deadline flags', async () => {
    const appQuery = jest.fn(async (sql) => {
      if (sql === C.TRANSITIONS_SQL) return { rows: [t('version.publish', 50, 'active', 'inactive')] };
      if (sql === C.ROOT_TITLES_SQL) return { rows: [{ root_id: 50, title: 'Old grant', grantor: 'Funder' }] };
      return { rows: [] };
    });
    const out = await C.changes('week', { appQuery, liveGrants: async () => [live(1, { deadline: '2026-10-01' })],
      now: () => new Date('2026-10-19T20:00:00Z'), noCache: true });
    expect(out.current).toEqual({ from: '2026-10-13', to: '2026-10-19' });
    expect(out.closed[0]).toMatchObject({ grant_id: 50, title: 'Old grant', live: false, status: 'inactive', link: expect.stringContaining('#grants/50') });
    expect(out.deadline_passed[0]).toMatchObject({ grant_id: 1, deadline: '2026-10-01', live: true });
    expect(appQuery.mock.calls.find(([s]) => s === C.TRANSITIONS_SQL)[1]).toEqual(['2026-10-13', '2026-10-19']);
  });

  test('changes() on a custom range reads that window, not one ending today; deadline flags stay today\'s', async () => {
    const appQuery = jest.fn(async () => ({ rows: [] }));
    const out = await C.changes('2026-09-01..2026-10-15', { appQuery, liveGrants: async () => [live(1, { deadline: '2026-10-17' })],
      now: () => new Date('2026-10-19T20:00:00Z'), noCache: true });
    expect(out.current).toEqual({ from: '2026-09-01', to: '2026-10-15' });
    for (const sql of [C.TRANSITIONS_SQL, C.DELETED_LIVE_SQL, C.RANGE_EDITS_SQL]) {
      expect(appQuery.mock.calls.find(([s]) => s === sql)[1]).toEqual(['2026-09-01', '2026-10-15']);
    }
    expect(out.deadline_passed[0]).toMatchObject({ grant_id: 1 });
    await expect(C.changes('2026-10-15..2026-09-01', { appQuery, noCache: true })).rejects.toMatchObject({ status: 400 });
    await expect(C.coverage('2025-01-01..2026-10-15', { noCache: true, now: () => new Date('2026-10-19T20:00:00Z') })).rejects.toMatchObject({ status: 400 });
  });
});

describe('coverage() reads', () => {
  test('reads through the injected (read-only) deps and returns both variants', async () => {
    const hubQuery = jest.fn(async (sql) => {
      if (sql === O.LAST_ROLLED_SQL) return { rows: [{ day: '2026-10-14' }] };
      if (sql === O.ROLLED_MATCHES_SQL) return { rows: [shown(135, 1)] };
      if (sql === C.GRANT_TAG_ROWS_SQL) return { rows: [tag(1, 'umbrella', ['Retail'])] };
      return { rows: [] };
    });
    const appQuery = jest.fn(async (sql) => {
      if (/FROM companies c\s+WHERE c.deleted_at IS NULL/.test(sql)) return { rows: [{ id: 135 }, { id: 81 }] };
      if (sql === O.COMPANY_METADATA_SQL) return { rows: [{ company_id: 135, primary_industries: ['Retail'], provinces: 'Alberta' }, { company_id: 81, primary_industries: ['Retail'], provinces: 'Alberta' }] };
      if (/FROM companies/.test(sql)) return { rows: [{ id: 135, name: 'NYA Ventures' }, { id: 81, name: 'Maximizer' }] };
      return { rows: [] };
    });
    const opsQuery = jest.fn(async () => ({ rows: [] }));
    const cov = await C.coverage('week', { hubQuery, appQuery, opsQuery, readDay: async () => ({ matches: [], reviews: [], views: [], ratings: [] }),
      liveGrants: async () => [live(1)], now: () => new Date('2026-10-15T20:00:00Z'), noCache: true });
    expect(cov.current).toEqual({ from: '2026-10-09', to: '2026-10-15' });
    expect(ind(cov, 'Retail')).toMatchObject({ clients: 1, ran_matching: 1, restricted: 1 });
    expect(ind(cov, 'Retail', 'all_variant').clients).toBe(2);
    expect(opsQuery.mock.calls.map(([s]) => s)).toEqual(expect.arrayContaining([C.WRONG_INDUSTRY_CUTS_SQL, C.LATEST_TRACKS_SQL]));
    // Nothing here writes.
    for (const fn of [hubQuery, appQuery, opsQuery]) for (const [sql] of fn.mock.calls) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  test('a bad range is refused before anything is read', async () => {
    const hubQuery = jest.fn();
    await expect(C.coverage('decade', { hubQuery })).rejects.toMatchObject({ status: 400 });
    await expect(C.changes('decade', { appQuery: hubQuery })).rejects.toMatchObject({ status: 400 });
    expect(hubQuery).not.toHaveBeenCalled();
  });
});

describe('routes', () => {
  async function serve(overrides) {
    const app = express();
    app.use('/coverage', createCoverageRouter(overrides));
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const b = `http://127.0.0.1:${server.address().port}/coverage`;
    return {
      get: async (p) => { const r = await fetch(b + p); return { status: r.status, body: await r.json() }; },
      close: () => new Promise((r) => server.close(r))
    };
  }

  test('coverage and changes pass through with the range; errors map to 400 / 503', async () => {
    const s = await serve({
      coverage: jest.fn(async (range) => ({ range })),
      changes: jest.fn(async (range) => {
        if (range === 'day') throw Object.assign(new Error('x'), { code: 'not_configured' });
        return { range, changes: true };
      })
    });
    expect((await s.get('/')).body).toEqual({ range: 'week' });
    expect((await s.get('/?range=month')).body).toEqual({ range: 'month' });
    expect((await s.get('/changes?range=year')).body).toEqual({ range: 'year', changes: true });
    expect(await s.get('/changes?range=day')).toEqual({ status: 503, body: { error: 'not_configured' } });
    await s.close();
    const real = await serve({});
    expect((await real.get('/?range=decade')).status).toBe(400);
    expect((await real.get('/changes?range=decade')).status).toBe(400);
    expect((await real.get('/changes?range=2026-10-15..2026-09-01')).body.error).toMatch(/on or before/);
    await real.close();
    const custom = await serve({ coverage: jest.fn(async (range) => ({ range })) });
    expect((await custom.get('/?range=2026-09-01..2026-10-15')).body).toEqual({ range: '2026-09-01..2026-10-15' });
    await custom.close();
  });
});

describe('Oracle: coverage and changes modes (the tab\'s own functions)', () => {
  const cov = C.buildCoverage(input({
    ...withClients([[10, ['Finance']], [81, ['Finance']], [13, ['Agriculture']]]),
    matches: [computed(10, 5), shown(81, 1), shown(13, 1)],
    cuts: [{ company_id: 13, grant_id: 1 }, { company_id: 81, grant_id: 1 }]
  }), { isInternal });
  const deps = () => ({
    env: { PUBLIC_URL: 'https://hub.test' },
    coverage: jest.fn(async () => cov),
    changes: jest.fn(async () => ({
      current: { from: '2026-09-20', to: '2026-10-19' },
      added: [{ grant_id: 1, title: 'Grant 1', at: '2026-10-01T00:00:00Z' }], closed: [], removed: [],
      edited: Array.from({ length: 25 }, (_, i) => ({ grant_id: 100 + i, title: `G${i}`, edits: 1, kinds: [], last_at: '2026-10-01T00:00:00Z', last_by: { user_id: 3, email: null } })),
      deadline_passed: [{ grant_id: 2, title: 'Grant 2', deadline_text: '2026-09-23' }], due_soon: []
    })),
    applyCoverageView: C.applyCoverageView
  });
  const run = (inputArgs, d) => T.runControlCentre(inputArgs, { deps: d });

  test('the modes are offered and read-only', () => {
    expect(T.CONTROL_CENTRE_MODES).toEqual(expect.arrayContaining(['coverage', 'changes']));
  });

  test('coverage not_matching: both lists, client-only with what internal accounts add, linked', async () => {
    const d = deps();
    const out = await run({ mode: 'coverage', view: 'not_matching' }, d);
    expect(d.coverage).toHaveBeenCalledWith('month');
    expect(out.tagging_note).toBe(C.TAGGING_NOTE);
    expect(out.clients_but_no_grant_matches).toBeUndefined();
    const fin = out.ran_matching_got_zero_matches.find((r) => r.industry === 'Finance');
    expect(Array.isArray(out.not_run_matching_yet)).toBe(true);
    expect(out.not_run_matching_yet.map((r) => r.industry)).not.toContain('Finance');
    expect(fin).toMatchObject({ clients: 1, ran_matching: 1, internal_accounts_add: { clients: 1, ran_matching: 1 },
      link: 'https://hub.test/control-centre#coverage/industry/Finance' });
    expect(out.no_restricted_grants.find((x) => x.main_industry === 'Finance').main_has_no_restricted_grants).toBe(true);
  });

  test('coverage with an industry: that industry in full; an unknown one is named back', async () => {
    const out = await run({ mode: 'coverage', industry: 'agriculture' }, deps());
    expect(out.industry).toMatchObject({ industry: 'Agriculture', wrong_industry_cuts: 1,
      cut_grants: [{ grant_id: 1, clients_cut: 1, link: 'https://hub.test/control-centre#grants/1' }],
      client_list: [{ company: 'Company 13', company_id: 13 }] });
    expect(out.industry.specific_industries.length).toBeGreaterThan(3);
    expect((await run({ mode: 'coverage', industry: 'Underwater basket weaving' }, deps())).error).toMatch(/No industry called/);
    expect((await run({ mode: 'coverage', view: 'nope' }, deps())).error).toMatch(/view must be one of/);
  });

  test('changes: lists capped at 20 with "more", each grant linked', async () => {
    const out = await run({ mode: 'changes', range: 'month' }, deps());
    expect(out.added.grants[0]).toMatchObject({ grant: 'Grant 1', link: 'https://hub.test/control-centre#grants/1' });
    expect(out.edited).toMatchObject({ count: 25, more: 5 });
    expect(out.edited.grants).toHaveLength(20);
    expect(out.deadline_passed_still_live.grants[0]).toMatchObject({ grant_id: 2, deadline: '2026-09-23' });
    expect(out.note).toMatch(/no review card is filed/);
  });
});
