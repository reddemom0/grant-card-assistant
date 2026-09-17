/**
 * query() and transaction() logging
 *
 * Parameters carry message text, emails and OAuth access tokens. query() must
 * name the statement and the error code, and transaction() a label and the
 * code — nothing else.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/database-connection-logging.test.js
 */

import { jest } from '@jest/globals';

process.env.DATABASE_URL = 'postgres://user@localhost:5432/test';

const SECRET_TOKEN = 'ya29.secret-access-token';
const SECRET_EMAIL = 'person@granted.ca';

const mockPoolQuery = jest.fn();
const mockClient = { query: jest.fn(), release: jest.fn() };
jest.unstable_mockModule('pg', () => ({
  default: {
    Pool: class {
      on() {}
      query(...args) { return mockPoolQuery(...args); }
      connect() { return Promise.resolve(mockClient); }
    }
  }
}));

const { query, queryLabel, transaction } = await import('../../src/database/connection.js');

let logSpies;
const logged = () => logSpies
  .flatMap(spy => spy.mock.calls)
  .map(args => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  .join('\n');

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockClient.query.mockReset();
  mockClient.query.mockResolvedValue({ rows: [] });
  mockClient.release.mockReset();
  logSpies = ['log', 'warn', 'error'].map(level => jest.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  logSpies.forEach(spy => spy.mockRestore());
  jest.restoreAllMocks();
});

describe('queryLabel', () => {
  test.each([
    ['UPDATE users SET google_access_token = $1 WHERE id = $2', 'UPDATE users'],
    ['INSERT INTO pending_actions (a) VALUES ($1)', 'INSERT pending_actions'],
    ['  SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)', 'SELECT users'],
    ['DELETE FROM chat_space_messages WHERE create_time < $1', 'DELETE chat_space_messages'],
    ['CREATE TABLE IF NOT EXISTS conversation_summaries (id SERIAL)', 'CREATE conversation_summaries'],
    ['-- leading comment\nSELECT count(*) FROM conversation_feedback', 'SELECT conversation_feedback'],
    ['SELECT NOW() as current_time', 'SELECT']
  ])('%s → %s', (sql, label) => {
    expect(queryLabel(sql)).toBe(label);
  });

  test('a value interpolated into the text never survives', () => {
    // Some callers build WHERE clauses into the text rather than parameters.
    const sql = `SELECT COUNT(*) FROM users WHERE email = '${SECRET_EMAIL}'`;
    expect(queryLabel(sql)).toBe('SELECT users');
  });

  test('non-string input does not throw', () => {
    expect(queryLabel(undefined)).toBe('SQL');
  });
});

describe('query() logs', () => {
  test('a failed query logs the label and code — no params, text or driver message', async () => {
    const err = Object.assign(new Error(`duplicate key value, token ${SECRET_TOKEN}`), {
      code: '23505',
      detail: `Key (email)=(${SECRET_EMAIL}) already exists.`
    });
    mockPoolQuery.mockRejectedValue(err);

    await expect(
      query('UPDATE users SET google_access_token = $1 WHERE email = $2', [SECRET_TOKEN, SECRET_EMAIL])
    ).rejects.toBe(err);

    const out = logged();
    expect(out).toContain('Database query error: UPDATE users (code: 23505)');
    expect(out).not.toContain(SECRET_TOKEN);
    expect(out).not.toContain(SECRET_EMAIL);
    expect(out).not.toContain('google_access_token');
  });

  test('an error with no code still logs something useful', async () => {
    mockPoolQuery.mockRejectedValue(new TypeError(`bad ${SECRET_TOKEN}`));
    await expect(query('SELECT 1 FROM users', [SECRET_TOKEN])).rejects.toThrow();

    expect(logged()).toContain('Database query error: SELECT users (code: TypeError)');
    expect(logged()).not.toContain(SECRET_TOKEN);
  });

  test('a slow query logs the label and duration — no params', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(0).mockReturnValueOnce(1500);
    mockPoolQuery.mockResolvedValue({ rows: [] });

    await query('UPDATE users SET google_access_token = $1 WHERE id = $2', [SECRET_TOKEN, 7]);

    const out = logged();
    expect(out).toContain('Slow query detected (1500ms): UPDATE users');
    expect(out).not.toContain(SECRET_TOKEN);
  });

  test('development logging carries no params either', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      mockPoolQuery.mockResolvedValue({ rows: [] });
      await query('SELECT id FROM users WHERE email = $1', [SECRET_EMAIL]);
      expect(logged()).toContain('DB Query');
      expect(logged()).not.toContain(SECRET_EMAIL);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  test('results and errors pass through unchanged', async () => {
    const rows = [{ id: 1 }];
    mockPoolQuery.mockResolvedValue({ rows });
    await expect(query('SELECT id FROM users', [])).resolves.toEqual({ rows });
    expect(mockPoolQuery).toHaveBeenCalledWith('SELECT id FROM users', []);
  });
});

describe('transaction() logs', () => {
  // What Postgres attaches to a check-constraint failure: the whole row.
  const rowError = () => Object.assign(new Error('new row violates check constraint "x"'), {
    code: '23514',
    detail: `Failing row contains (7, ${SECRET_EMAIL}, ${SECRET_TOKEN}).`
  });

  test('a failed transaction logs the default label and code — never the error object', async () => {
    const err = rowError();
    await expect(transaction(async () => { throw err; })).rejects.toBe(err);

    const out = logged();
    expect(out).toContain('Transaction error: transaction (code: 23514)');
    expect(out).not.toContain(SECRET_TOKEN);
    expect(out).not.toContain(SECRET_EMAIL);
    expect(out).not.toContain('Failing row');
    expect(out).not.toContain('check constraint');
  });

  test('a caller-supplied label is used', async () => {
    await expect(transaction(async () => { throw rowError(); }, 'chat backfill page')).rejects.toThrow();
    expect(logged()).toContain('Transaction error: chat backfill page (code: 23514)');
  });

  test('an error with no code falls back to its name', async () => {
    await expect(transaction(async () => { throw new RangeError(`bad ${SECRET_TOKEN}`); })).rejects.toThrow();
    expect(logged()).toContain('Transaction error: transaction (code: RangeError)');
    expect(logged()).not.toContain(SECRET_TOKEN);
  });

  test('behaviour is unchanged: rollback on failure, commit on success, client always released', async () => {
    await expect(transaction(async () => { throw rowError(); })).rejects.toThrow();
    expect(mockClient.query.mock.calls.map(c => c[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(mockClient.release).toHaveBeenCalledTimes(1);

    mockClient.query.mockClear();
    mockClient.release.mockClear();
    await expect(transaction(async (client) => {
      await client.query('UPDATE users SET name = $1', [SECRET_EMAIL]);
      return 'done';
    })).resolves.toBe('done');
    expect(mockClient.query.mock.calls.map(c => c[0])).toEqual(['BEGIN', 'UPDATE users SET name = $1', 'COMMIT']);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(logged()).not.toContain(SECRET_EMAIL);
  });
});
