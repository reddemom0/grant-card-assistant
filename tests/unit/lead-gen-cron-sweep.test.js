/**
 * Lead-gen inactivity cron — the pending-summary sweep runs on every tick
 *
 * finalizeInactiveSessions used to return as soon as no unfinalized session
 * was idle, so deliverPendingSummaries (which serves the already-finalized
 * sessions) almost never ran: 176 of 176 production ticks on 2026-11-01/02.
 * These tests pin that an empty batch still reaches the sweep, and that a
 * pending row reaches the send path.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/lead-gen-cron-sweep.test.js
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: jest.fn(), getPool: jest.fn(), transaction: jest.fn()
}));
jest.unstable_mockModule('../../src/email/sendEmail.js', () => ({
  sendEmail: jest.fn(), wrapInBrandedTemplate: jest.fn(html => html)
}));
jest.unstable_mockModule('../../src/services/lead-notification.js', () => ({
  notifyTeamOfLead: jest.fn(), notifyTeamOfUpgrade: jest.fn()
}));

const { query } = await import('../../src/database/connection.js');
const { finalizeInactiveSessions } = await import('../../src/api/lead-gen-finalization.js');

const isIdleSelect   = (sql) => /WHERE finalized = FALSE/.test(sql);
const isStaleCount   = (sql) => /count\(\*\)::int AS n/.test(sql);
const isPendingSelect = (sql) => /WHERE finalized = TRUE/.test(sql) && /SELECT session_id, contact_email, prospect_data/.test(sql);

// Route each SQL statement to a canned result.
function routeQueries({ idle = [], pending = [], sessionRow = null }) {
  query.mockImplementation(async (sql) => {
    if (isIdleSelect(sql)) return { rows: idle };
    if (isStaleCount(sql)) return { rows: [{ n: 0, newest: null }] };
    if (isPendingSelect(sql)) return { rows: pending };
    if (/FROM lead_gen_conversations\s+WHERE session_id = \$1/.test(sql)) {
      return { rows: sessionRow ? [sessionRow] : [] };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  query.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('finalizeInactiveSessions — no idle sessions', () => {
  test('still runs the pending-summary sweep', async () => {
    routeQueries({ idle: [], pending: [] });

    const result = await finalizeInactiveSessions(5, 50);

    const sqls = query.mock.calls.map(([sql]) => sql);
    expect(sqls.some(isIdleSelect)).toBe(true);
    expect(sqls.some(isPendingSelect)).toBe(true);
    expect(result).toEqual({ processed: 0, finalized: 0, errors: 0, summariesDelivered: 0 });
  });

  test('a pending summary reaches the send path for that session', async () => {
    routeQueries({
      idle: [],
      pending: [{ session_id: 'pending-1', contact_email: 'p@example.com', prospect_data: { email_summary_body: '<p>x</p>' } }],
      sessionRow: null // send path looks the session up; "not found" keeps it a unit test
    });

    const result = await finalizeInactiveSessions(5, 50);

    const lookedUp = query.mock.calls.some(([sql, params]) =>
      /FROM lead_gen_conversations\s+WHERE session_id = \$1/.test(sql) && params?.[0] === 'pending-1');
    expect(lookedUp).toBe(true);
    expect(result.summariesDelivered).toBe(0); // session row absent → not sent, and no throw
  });
});
