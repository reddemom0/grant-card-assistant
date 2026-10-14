/**
 * control-centre db + health: read-only transaction wrapper, pool guards,
 * and the health probe's response shape.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/control-centre-db.test.js
 */

import { jest } from '@jest/globals';

const poolConfigs = [];
const clientQueries = [];
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();

jest.unstable_mockModule('pg', () => ({
  default: {
    Pool: class {
      constructor(config) { poolConfigs.push(config); }
      on() {}
      connect() {
        return Promise.resolve({
          query: (...args) => { clientQueries.push(args[0]); return mockClientQuery(...args); },
          release: mockRelease
        });
      }
      query() { throw new Error('pool.query must not be used; go through runReadOnly'); }
      end() { return Promise.resolve(); }
    }
  }
}));

const {
  appQuery,
  opsQuery,
  getAppReadPool,
  runReadOnly,
  NotConfiguredError,
  CONTROL_CENTRE_TIMEOUT_MS,
  _resetForTests
} = await import('../../src/control-centre/db.js');
const { _resetGg3OpsForTests } = await import('../../src/services/gg3-ops-db.js');
const { checkDatabases, controlCentreHealthEndpoint } = await import('../../src/control-centre/health.js');

const APP_URL = 'postgresql://read_user:s3cret@db.example.net:5432/railway';
const OPS_URL = 'postgresql://oracle_readonly:s3cret@ops.example.net:5432/railway';

let errorSpy;
let warnSpy;

beforeEach(async () => {
  await _resetForTests();
  await _resetGg3OpsForTests();
  poolConfigs.length = 0;
  clientQueries.length = 0;
  mockClientQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockRelease.mockReset();
  delete process.env.APP_DB_READONLY_URL;
  delete process.env.GG3_OPS_DB_READONLY_URL;
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('app pool', () => {
  test('not configured throws NotConfiguredError', async () => {
    expect(() => getAppReadPool()).toThrow(NotConfiguredError);
    await expect(appQuery('SELECT 1')).rejects.toMatchObject({ code: 'not_configured', db: 'app' });
  });

  test('refuses a postgres superuser URL', () => {
    process.env.APP_DB_READONLY_URL = 'postgresql://postgres:pw@db.example.net:5432/railway';
    expect(() => getAppReadPool()).toThrow(/read-only role/);
    expect(poolConfigs).toHaveLength(0);
  });

  test('session is read-only with a 10s statement timeout', () => {
    process.env.APP_DB_READONLY_URL = APP_URL;
    getAppReadPool();
    expect(poolConfigs).toHaveLength(1);
    const cfg = poolConfigs[0];
    expect(cfg.options).toContain('default_transaction_read_only=on');
    expect(cfg.options).toContain(`statement_timeout=${CONTROL_CENTRE_TIMEOUT_MS}`);
    expect(cfg.statement_timeout).toBe(10_000);
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
  });
});

describe('runReadOnly', () => {
  test('wraps the statement in BEGIN READ ONLY / SET LOCAL / COMMIT', async () => {
    process.env.APP_DB_READONLY_URL = APP_URL;
    mockClientQuery.mockImplementation((text) =>
      Promise.resolve(text === 'SELECT 42 AS n' ? { rows: [{ n: 42 }], rowCount: 1 } : { rows: [] }));

    const res = await appQuery('SELECT 42 AS n');

    expect(res).toEqual({ rows: [{ n: 42 }], rowCount: 1 });
    expect(clientQueries).toEqual([
      'BEGIN READ ONLY',
      'SET LOCAL statement_timeout = 10000',
      'SELECT 42 AS n',
      'COMMIT'
    ]);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  test('rolls back and releases on error, logs no params or message', async () => {
    process.env.APP_DB_READONLY_URL = APP_URL;
    const err = Object.assign(new Error('relation secret_table does not exist'), { code: '42P01' });
    mockClientQuery.mockImplementation((text) =>
      text.startsWith('SELECT') ? Promise.reject(err) : Promise.resolve({ rows: [] }));

    await expect(appQuery('SELECT * FROM companies WHERE id = $1', ['private-param'])).rejects.toBe(err);

    expect(clientQueries).toContain('ROLLBACK');
    expect(clientQueries).not.toContain('COMMIT');
    expect(mockRelease).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('42P01');
    expect(logged).toContain('SELECT companies');
    expect(logged).not.toContain('private-param');
    expect(logged).not.toContain('secret_table');
  });

  test('works with any pool-like object', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ ok: 1 }], rowCount: 1 }), release: jest.fn() };
    const res = await runReadOnly({ connect: async () => client }, 'SELECT 1 AS ok');
    expect(res.rows).toEqual([{ ok: 1 }]);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN READ ONLY');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('ops pool', () => {
  test('not configured rejects with NotConfiguredError', async () => {
    await expect(opsQuery('SELECT 1')).rejects.toMatchObject({ code: 'not_configured', db: 'ops' });
  });

  test('reuses the oracle_readonly pool and the same read-only wrapper', async () => {
    process.env.GG3_OPS_DB_READONLY_URL = OPS_URL;
    await opsQuery('SELECT 1');
    expect(poolConfigs).toHaveLength(1);
    expect(poolConfigs[0].connectionString).toBe(OPS_URL);
    expect(clientQueries.slice(0, 2)).toEqual(['BEGIN READ ONLY', 'SET LOCAL statement_timeout = 10000']);
  });
});

describe('health', () => {
  const okQuery = async () => ({ rows: [{ ok: 1, server_time: '2026-10-14T20:00:00Z' }] });

  test('both ok', async () => {
    const r = await checkDatabases({ app: okQuery, ops: okQuery });
    expect(r.app).toMatchObject({ ok: true, server_time: '2026-10-14T20:00:00Z' });
    expect(r.ops.ok).toBe(true);
    expect(typeof r.app.ms).toBe('number');
    expect(r.checked_at).toEqual(expect.any(String));
  });

  test('errors report a code only, never the message', async () => {
    const failing = async () => {
      throw Object.assign(new Error('password authentication failed for user "read_user" at db.example.net'), { code: '28P01' });
    };
    const r = await checkDatabases({ app: failing, ops: okQuery });
    expect(r.app).toEqual({ ok: false, error: '28P01' });
    expect(JSON.stringify(r)).not.toMatch(/read_user|example\.net|password/);
  });

  test('endpoint: 503 with not_configured when env is unset, no secrets', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controlCentreHealthEndpoint({}, res);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.app).toEqual({ ok: false, error: 'not_configured' });
    expect(body.ops).toEqual({ ok: false, error: 'not_configured' });
  });

  test('endpoint: 200 when both DBs answer', async () => {
    process.env.APP_DB_READONLY_URL = APP_URL;
    process.env.GG3_OPS_DB_READONLY_URL = OPS_URL;
    mockClientQuery.mockImplementation((text) =>
      Promise.resolve(text.startsWith('SELECT 1') ? { rows: [{ ok: 1, server_time: 't' }], rowCount: 1 } : { rows: [] }));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controlCentreHealthEndpoint({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('s3cret');
  });
});
