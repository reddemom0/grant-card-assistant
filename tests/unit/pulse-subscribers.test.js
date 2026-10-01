/**
 * Pulse subscribers: env var → @granted.ca emails → Oracle DM spaces.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/pulse-subscribers.test.js
 */

import { jest } from '@jest/globals';

const mockQuery = jest.fn();
const mockFindDmSpace = jest.fn();
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: (...args) => mockQuery(...args)
}));
jest.unstable_mockModule('../../src/cards/chat-api.js', () => ({
  findDmSpace: (...args) => mockFindDmSpace(...args)
}));

const {
  parseSubscriberEmails,
  getPulseSubscribers,
  _resetPulseSubscribersForTests
} = await import('../../src/services/pulse-subscribers.js');

const CHAT_IDS = {
  'chris@granted.ca': 'users/111',
  'nodm@granted.ca': 'users/222',
  'notseen@granted.ca': null
};

let warnSpy;
beforeEach(() => {
  _resetPulseSubscribersForTests();
  mockQuery.mockReset();
  mockFindDmSpace.mockReset();
  mockQuery.mockImplementation(async (_sql, [email]) => (
    email in CHAT_IDS ? { rows: [{ chat_user_id: CHAT_IDS[email] }] } : { rows: [] }
  ));
  mockFindDmSpace.mockImplementation(async (id) => (id === 'users/111' ? 'spaces/DM111' : null));
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

describe('parseSubscriberEmails', () => {
  test('trims, lowercases, de-duplicates, keeps @granted.ca only', () => {
    const env = { PULSE_SPIKE_SUBSCRIBERS: ' Chris@Granted.ca, ,chris@granted.ca,someone@gmail.com,@granted.ca,x@granted.ca.evil.com ' };
    expect(parseSubscriberEmails('PULSE_SPIKE_SUBSCRIBERS', env)).toEqual(['chris@granted.ca']);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  test('missing env var is an empty list', () => {
    expect(parseSubscriberEmails('PULSE_SPIKE_SUBSCRIBERS', {})).toEqual([]);
  });
});

describe('getPulseSubscribers', () => {
  test('resolves email → chat id → DM space', async () => {
    const env = { PULSE_SPIKE_SUBSCRIBERS: 'chris@granted.ca' };
    expect(await getPulseSubscribers('PULSE_SPIKE_SUBSCRIBERS', env)).toEqual([
      { email: 'chris@granted.ca', dmSpace: 'spaces/DM111' }
    ]);
    expect(mockFindDmSpace).toHaveBeenCalledWith('users/111');
  });

  test('no DM / never messaged Oracle / unknown user: skipped, logged once across runs', async () => {
    const env = { PULSE_SPIKE_SUBSCRIBERS: 'chris@granted.ca,nodm@granted.ca,notseen@granted.ca,unknown@granted.ca' };
    const first = await getPulseSubscribers('PULSE_SPIKE_SUBSCRIBERS', env);
    const second = await getPulseSubscribers('PULSE_SPIKE_SUBSCRIBERS', env);

    expect(first).toEqual([{ email: 'chris@granted.ca', dmSpace: 'spaces/DM111' }]);
    expect(second).toEqual(first);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(mockFindDmSpace).not.toHaveBeenCalledWith(null);
  });

  test('a lookup error for one person does not fail the others', async () => {
    mockQuery.mockImplementationOnce(async () => { throw Object.assign(new Error('boom'), { code: 'ECONNRESET' }); });
    const env = { PULSE_SPIKE_SUBSCRIBERS: 'broken@granted.ca,chris@granted.ca' };
    const res = await getPulseSubscribers('PULSE_SPIKE_SUBSCRIBERS', env);
    expect(res).toEqual([{ email: 'chris@granted.ca', dmSpace: 'spaces/DM111' }]);
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('ECONNRESET');
  });
});
