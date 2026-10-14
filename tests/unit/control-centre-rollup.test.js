/**
 * control-centre rollup: aggregation, Vancouver day boundaries, upsert SQL,
 * dry-run vs write, per-day failure isolation, scheduler gate. Fixtures only.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-rollup.test.js
 */

import { jest } from '@jest/globals';
import {
  vancouverDay,
  addDays,
  dayRange,
  median,
  aggregateMatches,
  aggregateViews,
  aggregateRatings,
  MATCH_SQL,
  REVIEW_SQL,
  VIEWS_SQL,
  RATINGS_SQL,
  UPSERT_MATCHES_SQL,
  UPSERT_VIEWS_SQL,
  UPSERT_RATINGS_SQL,
  upsertDay,
  readDay,
  runRollup,
  lastNDays,
  startControlCentreRollup
} from '../../src/control-centre/rollup.js';

const ENV_KEYS = ['CC_ROLLUP_ENABLED', 'APP_DB_READONLY_URL', 'GG3_OPS_DB_READONLY_URL', 'GG3_INTERNAL_USER_IDS'];
const saved = {};
let logSpy, warnSpy, errorSpy;

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore();
});

describe('Vancouver days', () => {
  test('PDT boundary is 07:00Z', () => {
    expect(vancouverDay('2026-10-14T06:59:59Z')).toBe('2026-10-13');
    expect(vancouverDay('2026-10-14T07:00:00Z')).toBe('2026-10-14');
  });

  test('PST boundary is 08:00Z after DST ends (2026-11-01)', () => {
    expect(vancouverDay('2026-11-03T07:59:59Z')).toBe('2026-11-02');
    expect(vancouverDay('2026-11-03T08:00:00Z')).toBe('2026-11-03');
  });

  test('the 25-hour DST day keeps every hour on Nov 1', () => {
    // 2026-11-01 runs 07:00Z (PDT midnight) to 08:00Z next day (PST midnight).
    expect(vancouverDay('2026-11-01T07:00:00Z')).toBe('2026-11-01');
    expect(vancouverDay('2026-11-02T07:30:00Z')).toBe('2026-11-01');
    expect(vancouverDay('2026-11-02T08:00:00Z')).toBe('2026-11-02');
  });

  test('accepts Date objects; dayRange and addDays cross months', () => {
    expect(vancouverDay(new Date('2026-08-26T17:08:07Z'))).toBe('2026-08-26');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(dayRange('2026-08-30', '2026-09-02')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
    expect(dayRange('2026-09-02', '2026-09-01')).toEqual([]);
  });

  test('lastNDays ends on today in Vancouver', () => {
    expect(lastNDays(3, new Date('2026-10-14T05:00:00Z'))).toEqual({ from: '2026-10-11', to: '2026-10-13' });
  });
});

describe('median', () => {
  test('odd, even, empty', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('aggregateMatches', () => {
  const base = { company_id: 48, grant_id: 1711, section: 'funding_matches', eligibility: 'Likely' };
  const rows = [
    { ...base, occurred_at: '2026-10-13T17:00:00Z', result_set_id: 'rs1', shown: true, position: 3, match_score: '12.5', eligibility: 'Needs confirmation' },
    { ...base, occurred_at: '2026-10-13T17:00:00Z', result_set_id: 'rs1', shown: false, position: null, match_score: '9' }, // dup in same set
    { ...base, occurred_at: '2026-10-13T20:00:00Z', result_set_id: 'rs2', shown: true, position: 1, match_score: '11', eligibility: 'Likely' },
    { ...base, occurred_at: '2026-10-13T21:00:00Z', result_set_id: 'rs3', shown: false, position: null, match_score: '30' },
    { ...base, company_id: null, occurred_at: '2026-10-13T21:00:00Z', result_set_id: 'rs4', shown: false, position: null, match_score: '1' },
    { ...base, occurred_at: '2026-10-14T07:00:00Z', result_set_id: 'rs5', shown: true, position: 0, match_score: '2' } // next Vancouver day
  ];

  test('one record per key; distinct result sets; best position among shown; best score over all', () => {
    const out = aggregateMatches(rows);
    const main = out.find((r) => r.day === '2026-10-13' && r.company_id === 48);
    expect(main).toEqual({
      day: '2026-10-13', company_id: 48, grant_id: 1711, section: 'funding_matches',
      times_computed: 3, times_shown: 2, best_position: 1, best_score: 30,
      eligibility: 'Likely', ai_review_action: null
    });
    expect(out).toHaveLength(3);
    expect(out.find((r) => r.company_id === null)).toMatchObject({ day: '2026-10-13', times_computed: 1, times_shown: 0, best_position: null });
    expect(out.find((r) => r.day === '2026-10-14')).toMatchObject({ best_position: 0 });
  });

  test('eligibility is the latest by occurred_at', () => {
    const out = aggregateMatches([
      { ...base, occurred_at: '2026-10-13T22:00:00Z', result_set_id: 'b', shown: false, match_score: '1', eligibility: 'Likely' },
      { ...base, occurred_at: '2026-10-13T18:00:00Z', result_set_id: 'a', shown: false, match_score: '1', eligibility: 'Needs confirmation' }
    ]);
    expect(out[0].eligibility).toBe('Likely');
  });

  test('ai_review_action: latest wins, keyed by the match row day; orphans dropped', () => {
    const matches = [{ ...base, occurred_at: '2026-10-14T06:50:00Z', result_set_id: 'rs', shown: true, position: 0, match_score: '5' }];
    const reviews = [
      { company_id: 48, grant_id: 1711, section: 'funding_matches', match_occurred_at: '2026-10-14T06:50:00Z', occurred_at: '2026-10-14T07:05:00Z', action: 'moved_up' },
      { company_id: 48, grant_id: 1711, section: 'funding_matches', match_occurred_at: '2026-10-14T06:50:00Z', occurred_at: '2026-10-14T06:55:00Z', action: 'cut' },
      { company_id: 99, grant_id: 1, section: 'x', match_occurred_at: '2026-10-14T06:50:00Z', occurred_at: '2026-10-14T06:55:00Z', action: 'flag' }
    ];
    const out = aggregateMatches(matches, reviews);
    expect(out).toHaveLength(1);
    // review happened after Vancouver midnight but lands on its match's day
    expect(out[0]).toMatchObject({ day: '2026-10-13', ai_review_action: 'moved_up' });
  });
});

describe('aggregateViews', () => {
  test('caps each session at 600s; median over capped; distinct users; source in key', () => {
    const v = (visible_ms, user_id, source = 'matches', started_at = '2026-10-13T18:00:00Z') =>
      ({ started_at, company_id: 48, grant_root_id: 1711, user_id, source, visible_ms });
    const out = aggregateViews([
      v(5_107_166, 1), // 5107s → 600
      v(20_000, 1),
      v(700_000, 2), // → 600
      v(10_000, 3, 'watchlist'),
      v(1_000, 3, null)
    ]);
    const m = out.find((r) => r.source === 'matches');
    expect(m).toEqual({
      day: '2026-10-13', company_id: 48, grant_root_id: 1711, source: 'matches',
      sessions: 3, visible_seconds_capped: 1220, median_visible_seconds: 600, users: 2
    });
    expect(out.find((r) => r.source === 'watchlist')).toMatchObject({ sessions: 1, visible_seconds_capped: 10, median_visible_seconds: 10 });
    expect(out.find((r) => r.source === null)).toMatchObject({ sessions: 1, visible_seconds_capped: 1 });
  });
});

describe('aggregateRatings', () => {
  test('ups, downs, changed per day', () => {
    const r = (rating, previous_rating, created_at = '2026-10-13T18:00:00Z') =>
      ({ created_at, company_id: 48, grant_root_id: 1711, rating, previous_rating });
    const out = aggregateRatings([r('up', null), r('down', 'up'), r('up', 'down'), r('up', null, '2026-10-14T06:59:00Z'), r('down', null, '2026-10-14T07:00:00Z')]);
    expect(out).toEqual([
      { day: '2026-10-13', company_id: 48, grant_root_id: 1711, ups: 3, downs: 1, changed: 2 },
      { day: '2026-10-14', company_id: 48, grant_root_id: 1711, ups: 0, downs: 1, changed: 0 }
    ]);
  });
});

describe('source SQL', () => {
  test('ops reads keep real Clerk users only (drops smoke/probe/profile/stability ids)', () => {
    expect(MATCH_SQL).toContain("user_id LIKE 'user\\_%'");
    expect(REVIEW_SQL).toContain("m.user_id LIKE 'user\\_%'");
    expect(REVIEW_SQL).toContain('m.section = a.track');
  });

  test('staff are NOT excluded: GG3_INTERNAL_USER_IDS is ignored (blended during beta)', async () => {
    process.env.GG3_INTERNAL_USER_IDS = 'user_staff1,user_staff2';
    for (const sql of [MATCH_SQL, REVIEW_SQL, VIEWS_SQL, RATINGS_SQL]) {
      expect(sql).not.toContain('user_staff1');
      expect(sql).not.toContain('ANY(');
      expect(sql).not.toContain('$2');
    }
    const ops = jest.fn(async () => ({ rows: [] }));
    const app = jest.fn(async () => ({ rows: [] }));
    await readDay('2026-10-13', { ops, app });
    for (const call of [...ops.mock.calls, ...app.mock.calls]) expect(call[1]).toEqual(['2026-10-13']);
  });

  test('every read is a single-param Vancouver-day window', () => {
    for (const sql of [MATCH_SQL, REVIEW_SQL, VIEWS_SQL, RATINGS_SQL]) {
      expect(sql).toContain("AT TIME ZONE 'America/Vancouver'");
      expect(sql).toContain('($1::date + 1)');
    }
  });
});

describe('upsert', () => {
  test('upsert keys are the named unique constraints; no DELETE', () => {
    expect(UPSERT_MATCHES_SQL).toContain('ON CONFLICT ON CONSTRAINT cc_daily_matches_key DO UPDATE');
    expect(UPSERT_VIEWS_SQL).toContain('ON CONFLICT ON CONSTRAINT cc_daily_views_key DO UPDATE');
    expect(UPSERT_RATINGS_SQL).toContain('ON CONFLICT ON CONSTRAINT cc_daily_ratings_key DO UPDATE');
    for (const sql of [UPSERT_MATCHES_SQL, UPSERT_VIEWS_SQL, UPSERT_RATINGS_SQL]) {
      expect(sql).toContain('updated_at = NOW()');
      expect(sql).not.toMatch(/DELETE/i);
    }
  });

  test('one transaction per day, column arrays aligned, empty tables skipped', async () => {
    const client = { query: jest.fn().mockResolvedValue({}) };
    const hubTransaction = jest.fn(async (cb) => cb(client));
    await upsertDay({
      matches: [
        { day: '2026-10-13', company_id: 48, grant_id: 1, section: 's', times_computed: 2, times_shown: 1, best_position: 0, best_score: 5, eligibility: 'Likely', ai_review_action: null },
        { day: '2026-10-13', company_id: null, grant_id: 2, section: 's', times_computed: 1, times_shown: 0, best_position: null, best_score: 1, eligibility: 'Likely', ai_review_action: 'cut' }
      ],
      views: [],
      ratings: [{ day: '2026-10-13', company_id: 48, grant_root_id: 1, ups: 1, downs: 0, changed: 0 }]
    }, { hubTransaction });
    expect(hubTransaction).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledTimes(2);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toBe(UPSERT_MATCHES_SQL);
    expect(params).toHaveLength(10);
    expect(params[1]).toEqual([48, null]);
    expect(params[9]).toEqual([null, 'cut']);
    expect(client.query.mock.calls[1][0]).toBe(UPSERT_RATINGS_SQL);
  });
});

describe('runRollup', () => {
  const src = (n) => ({
    matches: Array.from({ length: n }, (_, i) => ({ occurred_at: '2026-10-13T18:00:00Z', company_id: 48, grant_id: i, section: 's', result_set_id: 'r', shown: false, match_score: '1', eligibility: 'Likely' })),
    reviews: [], views: [], ratings: [],
    sourceRows: { match_results: n, ai_review_log: 0, grant_view_sessions: 0, rating_events: 0 }
  });

  test('dry run never writes and counts rows', async () => {
    const upsert = jest.fn();
    const s = await runRollup({ from: '2026-10-13', to: '2026-10-13', write: false, log: () => {},
      deps: { readDay: async () => src(3), upsertDay: upsert} });
    expect(upsert).not.toHaveBeenCalled();
    expect(s.rows.cc_daily_matches).toBe(3);
    expect(s.sourceRows.match_results).toBe(3);
  });

  test('a failing day is recorded and later days still run and write', async () => {
    const upsert = jest.fn();
    const readDay = jest.fn(async (day) => {
      if (day === '2026-10-12') throw Object.assign(new Error('boom'), { code: '57014' });
      return day === '2026-10-13' ? src(2) : { ...src(0), matches: [] };
    });
    const s = await runRollup({ from: '2026-10-12', to: '2026-10-13', write: true, log: () => {},
      deps: { readDay, upsertDay: upsert} });
    expect(s.failed).toBe(1);
    expect(s.days[0]).toEqual({ day: '2026-10-12', ok: false, error: '57014' });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(s.rows.cc_daily_matches).toBe(2);
    expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('boom');
  });

  test('rows outside the day being processed are dropped', async () => {
    const s = await runRollup({ from: '2026-10-14', to: '2026-10-14', log: () => {},
      deps: { readDay: async () => src(2), upsertDay: jest.fn()} });
    expect(s.rows.cc_daily_matches).toBe(0);
  });
});

describe('startControlCentreRollup', () => {
  const cron = () => ({ schedule: jest.fn() });

  test('off unless CC_ROLLUP_ENABLED=true', () => {
    const c = cron();
    expect(startControlCentreRollup(c)).toBe(false);
    process.env.CC_ROLLUP_ENABLED = 'yes';
    expect(startControlCentreRollup(c)).toBe(false);
    expect(c.schedule).not.toHaveBeenCalled();
  });

  test('enabled but sources not configured: not scheduled', () => {
    process.env.CC_ROLLUP_ENABLED = 'true';
    const c = cron();
    expect(startControlCentreRollup(c)).toBe(false);
    expect(c.schedule).not.toHaveBeenCalled();
  });

  test('enabled + configured: 03:00 America/Vancouver, no overlap', () => {
    process.env.CC_ROLLUP_ENABLED = 'true';
    process.env.APP_DB_READONLY_URL = 'postgresql://read_user:x@h:5432/d';
    process.env.GG3_OPS_DB_READONLY_URL = 'postgresql://oracle_readonly:x@h:5432/d';
    const c = cron();
    expect(startControlCentreRollup(c)).toBe(true);
    const [expr, fn, opts] = c.schedule.mock.calls[0];
    expect(expr).toBe('0 3 * * *');
    expect(typeof fn).toBe('function');
    expect(opts).toEqual({ name: 'cc-rollup', timezone: 'America/Vancouver', noOverlap: true });
  });
});
