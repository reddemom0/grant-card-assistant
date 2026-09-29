/**
 * GG3 grant copy — per-status pull and the refresh guard
 *
 * The SQL the refresh sends is recorded, not run, and search-context is a fake
 * fetch answering per status from fixtures. What must hold: one call per status,
 * merged and deduped by id; an empty merge, a merge below 80% of the last
 * success, or any failed status call keeps the old copy (no DELETE); a single
 * status call at the 700-row limit replaces the copy but is recorded capped with
 * a loud warning, while a merge past 700 on its own is not capped; a normal pull
 * replaces the copy inside one transaction. Every run is one gg3_refresh_runs
 * row, and the token never reaches it.
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

const { runGg3Refresh, decideRefresh, GG3_STATUSES } = await import('../../src/services/gg3-refresh.js');

const TOKEN = 'test-token-never-logged';
const ENV = { AI_API_BACKEND_URL: 'https://backend.example/', AI_API_BACKEND_TOKEN: TOKEN };

function grants(n, status = 'active', start = 1000) {
  return Array.from({ length: n }, (_, i) => ({
    id: start + i,
    grant_name: `Grant ${start + i}`,
    status,
    grant_amount: i % 2 ? 5000 : 'Up to $5,000 – $7,000',
    regions: ['British Columbia'],
    field_content: { grant_overview_2: '<p>x</p>' },
    not_a_column: 'dropped'
  }));
}

// Production's shape on 2026-09-29, scaled so the total is 681
const NORMAL = { active: 198, inactive: 170, archived: 236, draft: 5, hide: 72 };

/** Fixture rows per status, ids never overlapping unless `extra` adds a repeat. */
function perStatus(counts, extra = {}) {
  const out = {};
  let start = 1000;
  for (const [status, n] of Object.entries(counts)) {
    out[status] = [...grants(n, status, start), ...(extra[status] ?? [])];
    start += n;
  }
  return out;
}

/** Fake search-context: answers by filters.status; `fail` maps status → HTTP code. */
function fetchByStatus(rowsByStatus, { fail = {} } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const status = JSON.parse(init.body).filters.status[0];
    calls.push({ url, init, status });
    if (fail[status]) return { ok: false, status: fail[status], json: async () => ({ error: 'nope' }) };
    return { ok: true, status: 200, json: async () => ({ grants: rowsByStatus[status] ?? [] }) };
  };
  impl.calls = calls;
  return impl;
}

const deletes = () => sent.filter(s => /^DELETE FROM gg3_grants/.test(s.text));
const inserts = () => sent.filter(s => /^INSERT INTO gg3_grants/.test(s.text));
const runRows = () => sent.filter(s => /^INSERT INTO gg3_refresh_runs/.test(s.text));
const insertedIds = () => inserts().flatMap(s => JSON.parse(s.params[0]).map(r => r.id));
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

describe('one call per status', () => {
  test('covers every production status plus the documented four', () => {
    expect(GG3_STATUSES).toEqual(expect.arrayContaining(['active', 'inactive', 'archived', 'draft', 'hide']));
  });

  test('each call asks for one status at the 700 limit, token only in the header', async () => {
    const fetchImpl = fetchByStatus(perStatus(NORMAL));
    await runGg3Refresh({ env: ENV, fetchImpl });
    expect(fetchImpl.calls.map(c => c.status)).toEqual(GG3_STATUSES);
    for (const { url, init, status } of fetchImpl.calls) {
      expect(url).toBe('https://backend.example/api/v1/ai/grants/search-context');
      expect(JSON.parse(init.body)).toEqual({ filters: { status: [status] }, limit: 700 });
      expect(init.headers['X-AI-Service-Token']).toBe(TOKEN);
      expect(init.body).not.toContain(TOKEN);
    }
  });

  test('results merge across statuses and dedupe by id', async () => {
    const rows = perStatus({ active: 3, inactive: 2 }, { inactive: grants(1, 'inactive', 1000) });
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchByStatus(rows) });
    expect(r).toMatchObject({ status: 'success', row_count: 5 });
    expect(insertedIds().sort()).toEqual([1000, 1001, 1002, 1003, 1004]);
  });
});

describe('the guard keeps the old copy', () => {
  test('every status empty → failed, nothing deleted', async () => {
    previousCount = 681;
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchByStatus({}) });
    expect(r).toMatchObject({ status: 'failed', row_count: 0, error: '0 rows returned' });
    expect(deletes()).toHaveLength(0);
    expect(runRows()).toHaveLength(1);
    expect(recorded()).toMatchObject({ status: 'failed', row_count: 0, previous_count: 681 });
  });

  test('merge below 80% of the last success → failed, nothing deleted, both counts recorded', async () => {
    previousCount = 681;
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchByStatus(perStatus({ active: 300, inactive: 200 })) });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/500 rows is below 80% of the last successful run \(681\)/);
    expect(deletes()).toHaveLength(0);
    expect(recorded()).toMatchObject({ status: 'failed', row_count: 500, previous_count: 681 });
  });

  test('exactly 80% passes', () => {
    expect(decideRefresh({ count: 80, previousCount: 100 })).toMatchObject({ ok: true });
    expect(decideRefresh({ count: 79, previousCount: 100 })).toMatchObject({ ok: false });
  });

  test('one status call fails → whole run failed, status named, nothing deleted, token not recorded', async () => {
    previousCount = 681;
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchByStatus(perStatus(NORMAL), { fail: { hide: 400 } }) });
    expect(r).toMatchObject({ status: 'failed', error: 'status "hide": Error: search-context HTTP 400' });
    expect(deletes()).toHaveLength(0);
    expect(JSON.stringify(runRows())).not.toContain(TOKEN);
  });
});

describe('replacing the copy', () => {
  test('normal pull → success, DELETE and inserts inside one transaction', async () => {
    previousCount = 681;
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchByStatus(perStatus(NORMAL)) });
    expect(r).toMatchObject({ status: 'success', row_count: 681, previous_count: 681, capped: false, error: null });

    const tx = sent.filter(s => s.inTx).map(s => s.text.split(' ')[0]);
    expect(tx[0]).toBe('BEGIN');
    expect(tx[1]).toBe('DELETE');
    expect(tx.at(-1)).toBe('COMMIT');
    expect(inserts()).toHaveLength(7);
    expect(inserts().every(s => s.inTx)).toBe(true);

    const firstChunk = JSON.parse(inserts()[0].params[0]);
    expect(firstChunk).toHaveLength(100);
    expect(firstChunk[0]).toMatchObject({ id: 1000, grant_name: 'Grant 1000', grant_type: null });
    expect(firstChunk[0]).not.toHaveProperty('not_a_column');
    // grant_amount goes in as sent, number or free text, into a TEXT column
    expect(firstChunk[0].grant_amount).toBe('Up to $5,000 – $7,000');
    expect(firstChunk[1].grant_amount).toBe(5000);
    expect(inserts()[0].text).toMatch(/grant_amount TEXT/);

    expect(recorded()).toMatchObject({ status: 'success', row_count: 681, capped: false, error: null });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('merge past 700 with no single status at 700 → not capped', async () => {
    previousCount = 700;
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchByStatus(perStatus({ ...NORMAL, archived: 280 })) });
    expect(r).toMatchObject({ status: 'success', row_count: 725, capped: false });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('one status call at 700 → still replaced, recorded capped, warning names the status', async () => {
    previousCount = 681;
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchByStatus(perStatus({ ...NORMAL, archived: 700 })) });
    expect(r).toMatchObject({ status: 'success', row_count: 1145, capped: true });
    expect(deletes()).toHaveLength(1);
    expect(recorded()).toMatchObject({ status: 'success', capped: true });
    expect(errorSpy.mock.calls.flat().join(' ')).toMatch(/CAPPED at 700 rows for status archived — grants are being cut off/);
  });

  test('first run ever (no previous success) → only the empty check applies', async () => {
    const r = await runGg3Refresh({ env: ENV, fetchImpl: fetchByStatus(perStatus({ active: 3 })) });
    expect(r).toMatchObject({ status: 'success', row_count: 3, previous_count: null });
    expect(deletes()).toHaveLength(1);
  });
});

describe('skipped runs', () => {
  test('missing config → skipped and recorded, no call made', async () => {
    const fetchImpl = fetchByStatus(perStatus({ active: 5 }));
    const r = await runGg3Refresh({ env: {}, fetchImpl });
    expect(r).toMatchObject({ status: 'skipped', error: 'AI_API_BACKEND_URL / AI_API_BACKEND_TOKEN not set' });
    expect(fetchImpl.calls).toHaveLength(0);
    expect(recorded()).toMatchObject({ status: 'skipped' });
  });

  test('a second run while one is in flight → skipped', async () => {
    let release;
    const gate = new Promise(r => { release = r; });
    const slowFetch = async () => {
      await gate;
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
