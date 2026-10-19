/**
 * Token refresh persistence (getUserOAuth2Client in src/tools/google-docs.js):
 * a refresh token Google rotates is saved, and a refresh without one never
 * erases the stored token.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/google-token-refresh.test.js
 */

import { jest } from '@jest/globals';

const query = jest.fn();
jest.unstable_mockModule('../../src/database/connection.js', () => ({ query }));

const { getUserOAuth2Client } = await import('../../src/tools/google-docs.js');

const flush = () => new Promise(r => setImmediate(r));
const STORED = { google_access_token: 'old-access', google_refresh_token: 'old-refresh', google_token_expiry: new Date('2026-10-19T10:00:00Z') };

function updateCall() {
  return query.mock.calls.find(([sql]) => /^UPDATE users/.test(sql));
}

beforeEach(() => {
  query.mockReset();
  query.mockImplementation(async (sql) => (/^SELECT/.test(sql) ? { rows: [STORED] } : { rows: [] }));
});

test('a rotated refresh token is persisted', async () => {
  const client = await getUserOAuth2Client(7);
  client.emit('tokens', { access_token: 'new-access', refresh_token: 'new-refresh', expiry_date: Date.parse('2026-10-19T11:00:00Z') });
  await flush();
  const [sql, params] = updateCall();
  expect(sql).toMatch(/google_refresh_token = COALESCE\(\$3, google_refresh_token\)/);
  expect(params).toEqual(['new-access', new Date('2026-10-19T11:00:00Z'), 'new-refresh', 7]);
});

test('a refresh without a new refresh token keeps the stored one (never nulls it)', async () => {
  const client = await getUserOAuth2Client(7);
  client.emit('tokens', { access_token: 'new-access', expiry_date: Date.parse('2026-10-19T11:00:00Z') });
  await flush();
  const [sql, params] = updateCall();
  expect(params[0]).toBe('new-access');
  // Either the stored value is passed back, or null with COALESCE keeping it.
  expect(params[2] === 'old-refresh' || (params[2] === null && /COALESCE\(\$3/.test(sql))).toBe(true);
  expect(params[2]).not.toBe(undefined);
});

test('a failed save does not throw out of the refresh', async () => {
  const client = await getUserOAuth2Client(7);
  query.mockImplementation(async () => { throw new Error('db down'); });
  expect(() => client.emit('tokens', { access_token: 'a', refresh_token: 'r' })).not.toThrow();
  await flush();
});
