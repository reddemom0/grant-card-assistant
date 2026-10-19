/**
 * match-lead client (src/services/match-lead-client.js): configuration,
 * request shape, both success statuses, failures — never throws.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/match-lead-client.test.js
 */

import { jest } from '@jest/globals';

const { matchLead } = await import('../../src/services/match-lead-client.js');

const env = { GG3_AI_SERVICE_URL: 'https://gg3.example/', GG3_REVIEW_FEED_TOKEN: 'tok' };
const reply = (status, body) => jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

test('unconfigured → ok:false, no request', async () => {
  const fetch = jest.fn();
  expect(await matchLead({ province: 'BC' }, { env: {}, fetch })).toEqual({ ok: false, reason: 'the matching service is not configured here' });
  expect(fetch).not.toHaveBeenCalled();
});

test('posts the lead with the service token to match-lead', async () => {
  const fetch = reply(200, { status: 'ok', grants: [{ grant_id: 1 }], inputs_used: { province: ['British Columbia'] }, dropped: [] });
  const r = await matchLead({ province: 'BC', industry: 'Manufacturing' }, { env, fetch });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('https://gg3.example/api/v1/ai/internal/match-lead');
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer tok');
  expect(JSON.parse(init.body)).toEqual({ province: 'BC', industry: 'Manufacturing' });
  expect(init.signal).toBeDefined();
  expect(r).toEqual({ ok: true, status: 'ok', grants: [{ grant_id: 1 }], inputs_used: { province: ['British Columbia'] }, dropped: [] });
});

test('insufficient_profile passes through with missing fields', async () => {
  const fetch = reply(200, { status: 'insufficient_profile', missing: ['industry'], inputs_used: {}, dropped: [] });
  expect(await matchLead({ province: 'BC' }, { env, fetch })).toMatchObject({ ok: true, status: 'insufficient_profile', grants: [], missing: ['industry'] });
});

test('non-200 → ok:false with the status', async () => {
  expect(await matchLead({}, { env, fetch: reply(401, { error: 'Unauthorized' }) })).toEqual({ ok: false, reason: 'the matching service answered 401' });
});

test('network error or timeout → ok:false, never throws', async () => {
  const fetch = jest.fn(async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); });
  expect(await matchLead({}, { env, fetch })).toEqual({ ok: false, reason: 'the matching service did not answer' });
});
