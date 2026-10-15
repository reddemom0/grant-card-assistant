/**
 * gg3-ops-db: Oracle's read-only pool on the gg3-ai-service ops DB.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/gg3-ops-db.test.js
 */

import { jest } from '@jest/globals';

const poolConfigs = [];
const mockPoolQuery = jest.fn();
jest.unstable_mockModule('pg', () => ({
  default: {
    Pool: class {
      constructor(config) { poolConfigs.push(config); }
      on() {}
      query(...args) { return mockPoolQuery(...args); }
      end() { return Promise.resolve(); }
    }
  }
}));

const {
  gg3OpsQuery,
  getGg3OpsPool,
  isGg3OpsConfigured,
  _resetGg3OpsForTests
} = await import('../../src/services/gg3-ops-db.js');

let warnSpy;
let errorSpy;

beforeEach(async () => {
  await _resetGg3OpsForTests();
  poolConfigs.length = 0;
  mockPoolQuery.mockReset();
  delete process.env.GG3_OPS_DB_READONLY_URL;
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('missing GG3_OPS_DB_READONLY_URL', () => {
  test('returns "not configured", never builds a pool, warns once', async () => {
    expect(isGg3OpsConfigured()).toBe(false);

    const first = await gg3OpsQuery('SELECT 1');
    const second = await gg3OpsQuery('SELECT 1');

    expect(first).toEqual({ configured: false, reason: expect.stringContaining('GG3_OPS_DB_READONLY_URL') });
    expect(second.configured).toBe(false);
    expect(getGg3OpsPool()).toBeNull();
    expect(poolConfigs).toHaveLength(0);
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('whitespace-only URL counts as missing', async () => {
    process.env.GG3_OPS_DB_READONLY_URL = '   ';
    expect((await gg3OpsQuery('SELECT 1')).configured).toBe(false);
  });
});

describe('configured pool', () => {
  beforeEach(() => {
    process.env.GG3_OPS_DB_READONLY_URL = 'postgresql://oracle_readonly:pw@db.example:5432/railway';
  });

  test('is small, read-only per session, 15s timeouts', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ n: 1 }], rowCount: 1 });
    await gg3OpsQuery('SELECT 1');
    await gg3OpsQuery('SELECT 1');

    expect(poolConfigs).toHaveLength(1);
    const cfg = poolConfigs[0];
    expect(cfg.max).toBe(2);
    expect(cfg.options).toContain('default_transaction_read_only=on');
    expect(cfg.options).toContain('statement_timeout=15000');
    expect(cfg.statement_timeout).toBe(15000);
    expect(cfg.query_timeout).toBe(15000);
  });

  test('returns rows on success', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ outcome: 'error', n: 2 }], rowCount: 1 });
    const res = await gg3OpsQuery('SELECT outcome, count(*) FROM chat_turns GROUP BY 1');
    expect(res).toEqual({ configured: true, rows: [{ outcome: 'error', n: 2 }], rowCount: 1 });
  });

  test('a refused write surfaces as an error and logs no params', async () => {
    const err = Object.assign(new Error('cannot execute INSERT in a read-only transaction'), { code: '25006' });
    mockPoolQuery.mockRejectedValue(err);

    await expect(
      gg3OpsQuery('INSERT INTO conversations (user_id) VALUES ($1)', ['user_secret123'])
    ).rejects.toMatchObject({ code: '25006' });

    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('INSERT conversations');
    expect(logged).toContain('25006');
    expect(logged).not.toContain('user_secret123');
  });
});

describe('retired staff filter', () => {
  test('GG3_INTERNAL_USER_IDS helpers are gone (internal accounts come from identity.js internalClerkIds)', async () => {
    const mod = await import('../../src/services/gg3-ops-db.js');
    expect(mod.getInternalUserIds).toBeUndefined();
    expect(mod.excludeInternalUsers).toBeUndefined();
  });
});
