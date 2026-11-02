/**
 * Grant search — the DB client is released on every path
 *
 * Each function in scripts/create-search-function.js opens its own Pool and
 * ends it in `finally`. pool.end() waits for checked-out clients, so a client
 * released only on success left a failing search awaiting forever — and the
 * visitor's chat with it. These tests pin: an error rejects promptly with the
 * client released and the pool ended; success releases exactly once.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/search-function-release.test.js
 */

import { jest } from '@jest/globals';

const client = { query: jest.fn(), release: jest.fn() };
const pool = { connect: jest.fn(async () => client), end: jest.fn(async () => {}) };

jest.unstable_mockModule('pg', () => ({ default: { Pool: jest.fn(() => pool) } }));
jest.unstable_mockModule('dotenv', () => ({ config: jest.fn() }));

const { searchGrants, searchByGenreScores, getGrantById, getGrantStats } =
  await import('../../scripts/create-search-function.js');

beforeEach(() => {
  client.query.mockReset();
  client.release.mockReset();
  pool.connect.mockClear();
  pool.end.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const missingColumn = Object.assign(new Error('column "recently_changed" does not exist'), { code: '42703' });

describe.each([
  ['searchGrants',        () => searchGrants({ keywords: ['hiring'], regions: ['Ontario'] })],
  ['searchByGenreScores', () => searchByGenreScores('ON', { hiring: 1 }, 15, 'Accounting')],
  ['getGrantById',        () => getGrantById('g-1')],
  ['getGrantStats',       () => getGrantStats()]
])('%s', (name, call) => {
  test('query error: rejects, releases the client, ends the pool', async () => {
    client.query.mockRejectedValue(missingColumn);

    await expect(call()).rejects.toThrow('recently_changed');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  test('success: releases exactly once', async () => {
    client.query.mockResolvedValue({ rows: [{ count: '1' }] });

    await call();
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});

test('connect failure: rejects without a client to release', async () => {
  pool.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

  await expect(searchGrants({ keywords: ['x'] })).rejects.toThrow('ECONNREFUSED');
  expect(client.release).not.toHaveBeenCalled();
  expect(pool.end).toHaveBeenCalledTimes(1);
});
