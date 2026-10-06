/**
 * pulse_stats: weeks, trends, one grant, validation, registration.
 *
 * The digest's own collect functions run for real (that is the point: the tool
 * reuses them); only the two query functions are fakes, answering by SQL shape
 * and week.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/pulse-stats.test.js
 */

import { jest } from '@jest/globals';
import fs from 'fs';

process.env.GG3_INTERNAL_USER_IDS = '';

const { runPulseStats, resolveGrant, MAX_WEEKS } = await import('../../src/tools/pulse-stats.js');
const { getToolsForAgent } = await import('../../src/tools/definitions.js');
const { ORACLE_DEFERRED_TOOLS } = await import('../../src/claude/client.js');

const NOW = new Date('2026-10-14T18:00:00Z');   // Wed Oct 14, Vancouver

// Per-week data, keyed by the Monday (Vancouver). w0 is the week before the range.
const WEEKS = {
  '2026-09-21': { users: 2, convs: 3, matching: 5, grants: [[1027, 3], [991, 2]] },
  '2026-09-28': { users: 4, convs: 6, matching: 8, grants: [[1027, 4], [1097, 4], [5, 1]] },
  '2026-10-05': { users: 1, convs: 1, matching: 2, grants: [[1097, 1]] },
  '2026-10-12': { users: 1, convs: 1, matching: 1, grants: [] }
};
const NAMES = { 1027: 'Career Ready SWPP', 1097: 'Mitacs BSI (KPU)', 991: 'PLTC Green Jobs', 5: null };

/** Which Monday a query's start bound is. */
const mondayOf = (start) => Object.keys(WEEKS).find(m => {
  const d = new Date(start);
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return local === m;
});

function fakeOps() {
  return jest.fn(async (sql, params) => {
    const w = WEEKS[mondayOf(params[0])] || { users: 0, convs: 0, matching: 0, grants: [] };
    if (/FROM chat_turns/.test(sql)) return { configured: true, rows: [{ n: w.users }] };
    if (/FROM conversations/.test(sql)) return { configured: true, rows: [{ n: w.convs }] };
    if (/GROUP BY grant_id/.test(sql)) return { configured: true, rows: w.grants.map(([grant_id, companies]) => ({ grant_id, companies })) };
    if (/FROM match_results/.test(sql)) return { configured: true, rows: [{ companies: w.matching }] };
    throw new Error(`unexpected ops query: ${sql}`);
  });
}

function fakeOracle() {
  return jest.fn(async (sql, params) => {
    if (/WHERE id = ANY/.test(sql)) return { rows: params[0].filter(id => NAMES[id]).map(id => ({ id, grant_name: NAMES[id] })) };
    if (/WHERE id = \$1/.test(sql)) return { rows: NAMES[params[0]] ? [{ id: params[0], grant_name: NAMES[params[0]] }] : [] };
    if (/ILIKE/.test(sql)) {
      const needle = params[0].replace(/^%|%$/g, '').toLowerCase();
      return { rows: Object.entries(NAMES).filter(([, n]) => n && n.toLowerCase().includes(needle)).map(([id, n]) => ({ id: Number(id), grant_name: n })) };
    }
    throw new Error(`unexpected oracle query: ${sql}`);
  });
}

const deps = () => ({ opsQuery: fakeOps(), oracleQuery: fakeOracle(), isConfigured: () => true, now: () => NOW });

describe('one week', () => {
  test('usage, companies matching, top grants with names and change', async () => {
    const out = await runPulseStats({ start_week: '2026-09-28' }, {}, deps());
    expect(out.success).toBe(true);
    expect(out.weeks).toHaveLength(1);
    const w = out.weeks[0];
    expect(w).toEqual(expect.objectContaining({
      week_start: '2026-09-28', week_end: '2026-10-04', partial: false,
      chat_users: 4, conversations: 6, companies_matching: 8
    }));
    expect(w.grants).toEqual([
      { grant_id: 1027, name: 'Career Ready SWPP', companies: 4, week_before: 3, change: '(+1, +33% vs week before)' },
      { grant_id: 1097, name: 'Mitacs BSI (KPU)', companies: 4, week_before: 0, change: '(new this week)' },
      { grant_id: 5, name: 'grant #5', companies: 1, week_before: 0, change: '(new this week)' }
    ]);
  });

  test('defaults to last full week', async () => {
    const out = await runPulseStats({}, {}, deps());
    expect(out.weeks.map(w => w.week_start)).toEqual(['2026-10-05']);
  });

  test('the week in progress is marked partial', async () => {
    const out = await runPulseStats({ start_week: '2026-10-12' }, {}, deps());
    expect(out.weeks[0].partial).toBe(true);
  });
});

describe('a trend over several weeks', () => {
  test('each week compared with the one before, the first with the week before the range', async () => {
    const out = await runPulseStats({ start_week: '2026-09-28', weeks: 3 }, {}, deps());
    expect(out.weeks.map(w => [w.week_start, w.companies_matching, w.chat_users])).toEqual([
      ['2026-09-28', 8, 4], ['2026-10-05', 2, 1], ['2026-10-12', 1, 1]
    ]);
    expect(out.weeks[1].grants).toEqual([{ grant_id: 1097, name: 'Mitacs BSI (KPU)', companies: 1, week_before: 4, change: '(−3, −75% vs week before)' }]);
    expect(out.weeks[2].grants).toEqual([]);
  });

  test('a range running past this week stops at this week', async () => {
    const out = await runPulseStats({ start_week: '2026-10-05', weeks: 4 }, {}, deps());
    expect(out.weeks.map(w => w.week_start)).toEqual(['2026-10-05', '2026-10-12']);
  });
});

describe('one grant', () => {
  test('by name: only that grant, 0 in a week it wasn\'t matched', async () => {
    const out = await runPulseStats({ start_week: '2026-09-28', weeks: 2, grant: 'swpp' }, {}, deps());
    expect(out.grant).toEqual({ id: 1027, name: 'Career Ready SWPP' });
    expect(out.weeks.map(w => w.grants)).toEqual([
      [{ grant_id: 1027, name: 'Career Ready SWPP', companies: 4, week_before: 3, change: '(+1, +33% vs week before)' }],
      [{ grant_id: 1027, name: 'Career Ready SWPP', companies: 0, week_before: 4, change: '(−4, −100% vs week before)' }]
    ]);
  });

  test('by id', async () => {
    const out = await runPulseStats({ start_week: '2026-09-21', grant: '991' }, {}, deps());
    expect(out.weeks[0].grants[0]).toEqual(expect.objectContaining({ grant_id: 991, companies: 2, week_before: 0 }));
  });

  test('not matched in either week says so', async () => {
    const out = await runPulseStats({ start_week: '2026-10-12', grant: 'PLTC' }, {}, deps());
    expect(out.weeks[0].grants[0].change).toBe('(not matched either week)');
  });

  test('a name matching several grants returns candidates', async () => {
    const r = await resolveGrant('c', fakeOracle());   // Career…, Mitacs…, PLTC…
    expect(r.grant).toBeUndefined();
    expect(r.candidates.length).toBeGreaterThan(1);
    const out = await runPulseStats({ grant: 'c' }, {}, deps());
    expect(out.success).toBe(false);
    expect(out.candidates.length).toBeGreaterThan(1);
  });

  test('an unknown grant is an error', async () => {
    expect((await runPulseStats({ grant: 'nothing like this' }, {}, deps())).success).toBe(false);
  });
});

describe('rejected', () => {
  test.each([[0], [MAX_WEEKS + 1], [2.5], ['3']])('weeks = %p', async (weeks) => {
    const out = await runPulseStats({ start_week: '2026-09-28', weeks }, {}, deps());
    expect(out).toEqual({ success: false, error: 'weeks must be a whole number from 1 to 13.' });
  });

  test('a start that is not a Monday', async () => {
    expect((await runPulseStats({ start_week: '2026-09-29' }, {}, deps())).error).toMatch(/Monday/);
  });

  test('a start in the future', async () => {
    expect((await runPulseStats({ start_week: '2026-10-19' }, {}, deps())).error).toMatch(/hasn't started/);
  });

  test('ops DB not configured', async () => {
    const d = { ...deps(), isConfigured: () => false };
    expect((await runPulseStats({ start_week: '2026-09-28' }, {}, d)).error).toMatch(/not configured/);
    expect(d.opsQuery).not.toHaveBeenCalled();
  });
});

describe('read-only, and only these tables', () => {
  test('the forbidden tables appear nowhere, and nothing writes', () => {
    const source = ['src/tools/pulse-stats.js', 'src/services/pulse-digest.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
    expect(source).not.toMatch(/ai_review_log|ai_review_cache|llm_calls/);
    expect(fs.readFileSync('src/tools/pulse-stats.js', 'utf8')).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  test('every query the tool sends is a SELECT', async () => {
    const d = deps();
    await runPulseStats({ start_week: '2026-09-28', weeks: 2, grant: 'swpp' }, {}, d);
    for (const [sql] of [...d.opsQuery.mock.calls, ...d.oracleQuery.mock.calls]) expect(sql.trim()).toMatch(/^SELECT/);
  });
});

describe('registration', () => {
  test('Oracle has it, deferred; the orchestrator and other agents do not', () => {
    expect(getToolsForAgent('internal-oracle').some(t => t.name === 'pulse_stats')).toBe(true);
    expect(ORACLE_DEFERRED_TOOLS).toContain('pulse_stats');
    for (const agent of ['orchestrator', 'etg-writer', 'canexport-writer', 'lead-gen', 'getgranted-ai']) {
      expect(getToolsForAgent(agent).some(t => t.name === 'pulse_stats')).toBe(false);
    }
  });
});
