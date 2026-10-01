/**
 * Pulse chat spike alert: threshold, excluded categories, cooldown, config.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/pulse-spike.test.js
 */

import { jest } from '@jest/globals';

const mockOpsQuery = jest.fn();
let mockConfigured = true;
jest.unstable_mockModule('../../src/services/gg3-ops-db.js', () => ({
  gg3OpsQuery: (...args) => mockOpsQuery(...args),
  isGg3OpsConfigured: () => mockConfigured
}));

const {
  countChatFailures,
  formatSpikeAlert,
  runSpikeCheck,
  startPulseSpike,
  EXCLUDED_CATEGORIES,
  _resetPulseSpikeForTests
} = await import('../../src/services/pulse-spike.js');

const ENV = { PULSE_SPIKE_SUBSCRIBERS: 'chris@granted.ca' };
const NOW = new Date('2026-10-01T15:00:00Z');

function counts(broke, emptyOrRefusal, users = 1) {
  return { broke, emptyOrRefusal, total: broke + emptyOrRefusal, users };
}

function makeDeps({ failures, claimRows = [{ previous: null }], subscribers, postResult = true } = {}) {
  const oracleQuery = jest.fn(async (sql) => {
    if (sql.includes('INSERT INTO pulse_alert_state')) return { rows: claimRows };
    return { rows: [] };
  });
  return {
    countFailures: jest.fn(async () => failures),
    oracleQuery,
    getSubscribers: jest.fn(async () => subscribers ?? [{ email: 'chris@granted.ca', dmSpace: 'spaces/DM1' }]),
    post: jest.fn(async () => postResult)
  };
}

let warnSpy;
let logSpy;
beforeEach(() => {
  mockConfigured = true;
  mockOpsQuery.mockReset();
  _resetPulseSpikeForTests();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  logSpy.mockRestore();
});

describe('threshold', () => {
  test('1 failure: no alert, no cooldown claim', async () => {
    const deps = makeDeps({ failures: counts(1, 0) });
    const res = await runSpikeCheck({ now: NOW, env: ENV, deps });
    expect(res.status).toBe('below_threshold');
    expect(deps.oracleQuery).not.toHaveBeenCalled();
    expect(deps.post).not.toHaveBeenCalled();
  });

  test('2 failures: alert each subscriber once', async () => {
    const deps = makeDeps({
      failures: counts(1, 1, 2),
      subscribers: [
        { email: 'a@granted.ca', dmSpace: 'spaces/A' },
        { email: 'b@granted.ca', dmSpace: 'spaces/B' }
      ]
    });
    const res = await runSpikeCheck({ now: NOW, env: ENV, deps });
    expect(res).toEqual({ status: 'sent', total: 2, sent: 2 });
    expect(deps.post).toHaveBeenCalledTimes(2);
    expect(deps.post).toHaveBeenCalledWith('spaces/A', expect.stringContaining('2 failures'));
    expect(deps.post).toHaveBeenCalledWith('spaces/B', expect.any(String));
  });
});

describe('failure query', () => {
  test('excludes pre-model categories, counts error+max_rounds as broke and no_answer separately', async () => {
    mockOpsQuery.mockResolvedValue({ configured: true, rows: [{ broke: 2, empty_or_refusal: 1, users: 2 }] });
    const res = await countChatFailures(15);

    expect(res).toEqual({ broke: 2, emptyOrRefusal: 1, total: 3, users: 2 });
    const [sql, params] = mockOpsQuery.mock.calls[0];
    expect(sql).toContain('FROM chat_turns');
    expect(sql).toContain('error_category IS NULL OR NOT (error_category = ANY($4::text[]))');
    expect(params[0]).toBe(15);
    expect(params[1]).toEqual(['error', 'max_rounds']);
    expect(params[2]).toEqual(['error', 'max_rounds', 'no_answer']);
    expect(params[3]).toEqual(['missing_message', 'bad_conversation_id', 'missing_grant_id', 'conversation_not_found']);
    expect(EXCLUDED_CATEGORIES).toEqual(params[3]);
  });

  test('does not exclude internal users', async () => {
    mockOpsQuery.mockResolvedValue({ configured: true, rows: [{ broke: 0, empty_or_refusal: 0, users: 0 }] });
    await countChatFailures(15);
    const [sql, params] = mockOpsQuery.mock.calls[0];
    expect(sql).not.toMatch(/user_id\s*=\s*ANY/);
    expect(params).toHaveLength(4);
  });

  test('returns null when the ops DB is not configured', async () => {
    mockOpsQuery.mockResolvedValue({ configured: false, reason: 'x' });
    expect(await countChatFailures(15)).toBeNull();
  });
});

describe('cooldown', () => {
  test('claim refused (alert within 60 min): no posts', async () => {
    const deps = makeDeps({ failures: counts(3, 0), claimRows: [] });
    const res = await runSpikeCheck({ now: NOW, env: ENV, deps });
    expect(res.status).toBe('cooldown');
    expect(deps.getSubscribers).not.toHaveBeenCalled();
    expect(deps.post).not.toHaveBeenCalled();
  });

  test('claim SQL only takes the row when the last send is 60+ minutes old', async () => {
    const deps = makeDeps({ failures: counts(2, 0) });
    await runSpikeCheck({ now: NOW, env: ENV, deps });
    const [sql, params] = deps.oracleQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (alert_key) DO UPDATE');
    expect(sql).toContain('last_sent_at <= EXCLUDED.last_sent_at - make_interval(mins => $3::int)');
    expect(params).toEqual(['chat_spike', NOW, 60]);
  });

  test('nobody reached: claim released so the next run can retry', async () => {
    const previous = new Date('2026-10-01T12:00:00Z');
    const deps = makeDeps({ failures: counts(2, 0), claimRows: [{ previous }], postResult: false });
    const res = await runSpikeCheck({ now: NOW, env: ENV, deps });
    expect(res.status).toBe('undelivered');
    const [sql, params] = deps.oracleQuery.mock.calls[1];
    expect(sql).toContain('UPDATE pulse_alert_state SET last_sent_at = $3');
    expect(params).toEqual(['chat_spike', NOW, previous]);
  });

  test('nobody reached on a first-ever claim: row deleted', async () => {
    const deps = makeDeps({ failures: counts(2, 0), subscribers: [] });
    await runSpikeCheck({ now: NOW, env: ENV, deps });
    const [sql, params] = deps.oracleQuery.mock.calls[1];
    expect(sql).toContain('DELETE FROM pulse_alert_state');
    expect(params).toEqual(['chat_spike', NOW]);
  });

  test('missing pulse_alert_state table: no alert, warns once', async () => {
    const deps = makeDeps({ failures: counts(5, 0) });
    deps.oracleQuery.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    expect((await runSpikeCheck({ now: NOW, env: ENV, deps })).status).toBe('no_state_table');
    expect((await runSpikeCheck({ now: NOW, env: ENV, deps })).status).toBe('no_state_table');
    expect(deps.post).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('missing env vars', () => {
  test('runSpikeCheck skips without subscribers', async () => {
    const deps = makeDeps({ failures: counts(5, 0) });
    expect((await runSpikeCheck({ now: NOW, env: {}, deps })).status).toBe('skipped');
    expect(deps.countFailures).not.toHaveBeenCalled();
  });

  test('runSpikeCheck skips without the ops DB URL', async () => {
    mockConfigured = false;
    const deps = makeDeps({ failures: counts(5, 0) });
    expect((await runSpikeCheck({ now: NOW, env: ENV, deps })).status).toBe('skipped');
    expect(deps.countFailures).not.toHaveBeenCalled();
  });

  test('startPulseSpike never schedules without the ops DB URL', () => {
    mockConfigured = false;
    const cron = { schedule: jest.fn() };
    expect(startPulseSpike(cron, ENV)).toBe(false);
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  test('startPulseSpike never schedules with an empty subscriber list', () => {
    const cron = { schedule: jest.fn() };
    expect(startPulseSpike(cron, { PULSE_SPIKE_SUBSCRIBERS: '  ' })).toBe(false);
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  test('startPulseSpike schedules every 5 minutes when configured', () => {
    const cron = { schedule: jest.fn() };
    expect(startPulseSpike(cron, ENV)).toBe(true);
    expect(cron.schedule).toHaveBeenCalledWith(
      '*/5 * * * *', expect.any(Function), expect.objectContaining({ name: 'pulse-spike', noOverlap: true })
    );
  });
});

describe('formatSpikeAlert', () => {
  test('matches the agreed wording', () => {
    expect(formatSpikeAlert(counts(2, 1, 2))).toBe(
      '⚠️ GetGranted chat: 3 failures in the last 15 minutes — 2 chat broke, 1 empty reply/refusal — across 2 clients. Ask me about it for details.'
    );
  });

  test('omits zero parts and uses singular forms', () => {
    expect(formatSpikeAlert(counts(2, 0, 1))).toBe(
      '⚠️ GetGranted chat: 2 failures in the last 15 minutes — 2 chat broke — across 1 client. Ask me about it for details.'
    );
  });

  test('a week-long window reads as days', () => {
    expect(formatSpikeAlert(counts(0, 4, 3), 10080)).toContain('in the last 7 days');
  });
});
