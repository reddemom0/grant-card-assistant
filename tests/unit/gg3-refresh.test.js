/**
 * GG3 grant copy — the refresh guard
 *
 * The SQL the refresh sends is recorded, not run, and search-context is a fake
 * fetch returning fixtures. What must hold: an empty pull, a pull below 80% of
 * the last success, or a failed call keeps the old copy (no DELETE); a pull at
 * the 700-row limit replaces it but is recorded capped with a loud warning; a
 * normal pull replaces it inside one transaction. Every run is one
 * gg3_refresh_runs row, and the token never reaches it.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/gg3-refresh.test.js
 */

import { jest } from '@jest/globals';

const sent = [];
let previousCount = null;
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async (text, params = []) => {
    sent.push({ text: text.replace(/\s+/g, ' ').trim(), params, inTx: false });
    if (/SELECT row_count FROM gg3_refresh_runs/.test(text)) {
      return { rows: previousCount === null ? [] : [{ row_count: previousCount }] };
    }
    return { rows: [] };
  },
  transaction: async (callback) => {
    sent.push({ text: 'BEGIN', inTx: true });
    const client = {
      query: async (text, params = []) => {
        sent.push({ text: text.replace(/\s+/g, ' ').trim(), params, inTx: true });
        return { rows: [] };
      }
    };
    const result = await callback(client);
    sent.push({ text: 'COMMIT', inTx: true });
    return result;
  }
}));

const { runGg3Refresh, decideRefresh } = await import('../../src/services/gg3-refresh.js');

const TOKEN = 'test-token-never-logged';
const ENV = { AI_API_BACKEND_URL: 'https://backend.example/', AI_API_BACKEND_TOKEN: TOKEN };

function grants(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 1000 + i,
    grant_name: `Grant ${i}`,
    status: 'active',
    grant_amount: i % 2 ? 5000 : 'Up to $5,000 – $7,000',
    regions: ['British Columbia'],
    field_content: { grant_overview_2: '<p>x</p>' },
    not_a_column: 'dropped'
  }));
}

function fetchReturning(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

const deletes = () => sent.filter(s => /^DELETE FROM gg3_grants/.test(s.text));
const inserts = () => sent.filter(s => /^INSERT INTO gg3_grants/.test(s.text));
const runRows = () => sent.filter(s => /^INSERT INTO gg3_refresh_runs/.test(s.text));
// params: started_at, finished_at, row_count, previous_count, status, capped, error
const recorded = () => {
  const [, , row_count, previous_count, status, capped, error] = runRows()[0].params;
  return { row_count, previous_count, status, capped, error };
};

let errorSpy;
beforeEach(() => {
  sent.length = 0;
  previousCount = null;
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('the guard keeps the old copy', () => {
  test('0 rows → failed, nothing deleted', async () => {
    previousCount = 681;
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchReturning({ grants: [] }) });
    expect(r).toMatchObject({ status: 'failed', row_count: 0, error: '0 rows returned' });
    expect(deletes()).toHaveLength(0);
    expect(runRows()).toHaveLength(1);
    expect(recorded()).toMatchObject({ status: 'failed', row_count: 0, previous_count: 681 });
  });

  test('below 80% of the last success → failed, nothing deleted, both counts recorded', async () => {
    previousCount = 681;
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchReturning({ grants: grants(500) }) });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/500 rows is below 80% of the last successful run \(681\)/);
    expect(deletes()).toHaveLength(0);
    expect(recorded()).toMatchObject({ status: 'failed', row_count: 500, previous_count: 681 });
  });

  test('exactly 80% passes', () => {
    expect(decideRefresh({ count: 80, previousCount: 100 })).toMatchObject({ ok: true });
    expect(decideRefresh({ count: 79, previousCount: 100 })).toMatchObject({ ok: false });
  });

  test('a failed call → failed, nothing deleted, token not in the recorded error', async () => {
    previousCount = 681;
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchReturning({ error: 'nope' }, { ok: false, status: 500 }) });
    expect(r).toMatchObject({ status: 'failed', error: 'Error: search-context HTTP 500' });
    expect(deletes()).toHaveLength(0);
    expect(JSON.stringify(runRows())).not.toContain(TOKEN);
  });
});

describe('replacing the copy', () => {
  test('normal pull → success, DELETE and inserts inside one transaction', async () => {
    previousCount = 681;
    const fetchImpl = fetchReturning({ grants: grants(681) });
    const r = await runGg3Refresh({ env: ENV, fetchImpl });
    expect(r).toMatchObject({ status: 'success', row_count: 681, previous_count: 681, capped: false, error: null });

    const tx = sent.filter(s => s.inTx).map(s => s.text.split(' ')[0]);
    expect(tx[0]).toBe('BEGIN');
    expect(tx[1]).toBe('DELETE');
    expect(tx.at(-1)).toBe('COMMIT');
    expect(inserts()).toHaveLength(7);
    expect(inserts().every(s => s.inTx)).toBe(true);

    const firstChunk = JSON.parse(inserts()[0].params[0]);
    expect(firstChunk).toHaveLength(100);
    expect(firstChunk[0]).toMatchObject({ id: 1000, grant_name: 'Grant 0', grant_type: null });
    expect(firstChunk[0]).not.toHaveProperty('not_a_column');
    // grant_amount goes in as sent, number or free text, into a TEXT column
    expect(firstChunk[0].grant_amount).toBe('Up to $5,000 – $7,000');
    expect(firstChunk[1].grant_amount).toBe(5000);
    expect(inserts()[0].text).toMatch(/grant_amount TEXT/);

    expect(recorded()).toMatchObject({ status: 'success', row_count: 681, capped: false, error: null });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('the call asks for every status at the 700 limit, token only in the header', async () => {
    const fetchImpl = fetchReturning({ grants: grants(10) });
    await runGg3Refresh({ env: ENV, fetchImpl });
    const { url, init } = fetchImpl.calls[0];
    expect(url).toBe('https://backend.example/api/v1/ai/grants/search-context');
    expect(JSON.parse(init.body)).toEqual({ filters: { active_only: false }, limit: 700 });
    expect(init.headers['X-AI-Service-Token']).toBe(TOKEN);
    expect(init.body).not.toContain(TOKEN);
  });

  test('first run ever (no previous success) → only the empty check applies', async () => {
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchReturning({ grants: grants(3) }) });
    expect(r).toMatchObject({ status: 'success', row_count: 3, previous_count: null });
    expect(deletes()).toHaveLength(1);
  });

  test('cap hit → still replaced, recorded capped, loud warning', async () => {
    previousCount = 681;
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchReturning({ grants: grants(700) }) });
    expect(r).toMatchObject({ status: 'success', row_count: 700, capped: true });
    expect(deletes()).toHaveLength(1);
    expect(inserts()).toHaveLength(7);
    expect(recorded()).toMatchObject({ status: 'success', capped: true });
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/CAPPED at 700 rows — grants are being cut off/);
  });
});

describe('skipped runs', () => {
  test('missing config → skipped and recorded, no call made', async () => {
    const fetchImpl = fetchReturning({ grants: grants(5) });
    const r = await runGg3Refresh({ env: {}, fetchImpl });
    expect(r).toMatchObject({ status: 'skipped', error: 'AI_API_BACKEND_URL / AI_API_BACKEND_TOKEN not set' });
    expect(fetchImpl.calls).toHaveLength(0);
    expect(recorded()).toMatchObject({ status: 'skipped' });
  });

  test('a second run while one is in flight → skipped', async () => {
    let release;
    const slowFetch = async () => {
      await new Promise(r => { release = r; });
      return { ok: true, status: 200, json: async () => ({ grants: grants(5) }) };
    };
    const first = runGg3Refresh({ env: ENV, fetchImpl: slowFetch });
    await new Promise(r => setImmediate(r));
    const second = await runGg3Refresh({ env: ENV, fetchImpl: slowFetch });
    expect(second).toMatchObject({ status: 'skipped', error: 'a refresh is already running' });
    release();
    expect((await first).status).toBe('success');
  });
});
