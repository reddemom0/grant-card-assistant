/**
 * Resolving Chat sender ids to names
 *
 * The point of this module is that a digest says "Stephanie asked you…" rather
 * than "Unknown asked you…". So the tests care about two things: that the
 * cheapest source wins, and that a failure anywhere still produces a label that
 * is true.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/directory-names.test.js
 */

import { jest } from '@jest/globals';

const mockQuery = jest.fn(async () => ({ rows: [] }));
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: mockQuery, getPool: jest.fn(), transaction: jest.fn()
}));

const mockUsersGet = jest.fn();
jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class { constructor(opts) { this.opts = opts; } } },
    admin: jest.fn(() => ({ users: { get: mockUsersGet } }))
  }
}));

const { resolveSenderNames, resolveSenderName, FALLBACKS, _clearCache } =
  await import('../../src/tools/directory-names.js');

const INTERNAL_DOMAIN = 'domain-granted';
const ASKER = { userId: 7 };

/** The users table answers two different questions; route by SQL shape. */
const dbReturns = ({ names = [], email = 'asker@granted.ca' } = {}) => {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT email FROM users/.test(sql)) return { rows: email ? [{ email }] : [] };
    return { rows: names };
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  _clearCache();
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: 'k' });
  delete process.env.HUBSPOT_WEBHOOK_USER_EMAIL;   // no longer consulted
  dbReturns();
  mockUsersGet.mockResolvedValue({ data: { name: { fullName: 'Stephanie Vance' }, primaryEmail: 'stephanie@granted.ca' } });
});

describe('who the directory call runs as', () => {
  test("it impersonates the person asking, not a system account", async () => {
    const { google } = await import('googleapis');
    await resolveSenderNames([{ name: 'users/333', domainId: INTERNAL_DOMAIN }], ASKER);

    const authArg = google.admin.mock.calls[0][0].auth;
    expect(authArg.opts.clientOptions.subject).toBe('asker@granted.ca');
    expect(authArg.opts.scopes).toEqual(['https://www.googleapis.com/auth/admin.directory.user.readonly']);
  });

  test('HUBSPOT_WEBHOOK_USER_EMAIL is no longer used as a fallback subject', async () => {
    process.env.HUBSPOT_WEBHOOK_USER_EMAIL = 'oracle-system@granted.ca';
    dbReturns({ email: null });   // the asker's email cannot be resolved

    const names = await resolveSenderNames([{ name: 'users/333', domainId: INTERNAL_DOMAIN }], ASKER);

    expect(mockUsersGet).not.toHaveBeenCalled();
    expect(names.get('users/333')).toBe(FALLBACKS.internalUnresolved);
  });

  test('no userId means no directory call, and it says so in the log', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Deliberately no ctx: a caller that forgets to thread userId must be loud,
    // not silently nameless.
    await resolveSenderNames([{ name: 'users/333', domainId: INTERNAL_DOMAIN }]);

    expect(mockUsersGet).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[names] directory client unavailable: key=true subject=false');
    warn.mockRestore();
  });
});

describe('logging', () => {
  test('one summary line per request, counts only — no names, emails or ids', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    dbReturns({ names: [{ chat_user_id: 'users/222', name: 'Chris Reddemom', email: 'writers@granted.ca' }] });

    await resolveSenderNames([
      { name: 'users/111', displayName: 'Jorge Aguilar' },
      { name: 'users/222', domainId: INTERNAL_DOMAIN },
      { name: 'users/333', domainId: INTERNAL_DOMAIN }
    ], ASKER);

    const line = log.mock.calls.map(c => c[0]).find(l => String(l).startsWith('[names] total='));

    expect(line).toBe('[names] total=3 unique=3 displayName=1 cache=0 db=1 directory=1 notFound=0 failed=0 fallbackInternal=0 fallbackExternal=0');
    for (const secret of ['Jorge', 'Chris', 'Stephanie', 'granted.ca', 'users/']) {
      expect(line).not.toContain(secret);
    }
    log.mockRestore();
  });

  test('a 404 is counted rather than silently swallowed', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockUsersGet.mockRejectedValue(Object.assign(new Error('Not found'), { code: 404 }));

    await resolveSenderNames([{ name: 'users/999' }], ASKER);

    const line = log.mock.calls.map(c => c[0]).find(l => String(l).startsWith('[names] total='));
    expect(line).toContain('notFound=1');
    expect(line).toContain('fallbackExternal=1');
    log.mockRestore();
  });

  test('a failure logs the code and nothing else', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockUsersGet.mockRejectedValue(Object.assign(new Error('unauthorized_client: client not authorized for asker@granted.ca'), { code: 403 }));

    await resolveSenderNames([{ name: 'users/333', domainId: INTERNAL_DOMAIN }], ASKER);

    expect(warn).toHaveBeenCalledWith('[names] directory lookup failed: code=403');
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('granted.ca');
    expect(logged).not.toContain('unauthorized_client');
    warn.mockRestore();
  });
});

describe('cheapest source wins', () => {
  test("Chat's own displayName is used, with no lookup at all", async () => {
    const names = await resolveSenderNames([
      { name: 'users/111', displayName: 'Jorge Aguilar', domainId: INTERNAL_DOMAIN }
    ], ASKER);

    expect(names.get('users/111')).toBe('Jorge Aguilar');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockUsersGet).not.toHaveBeenCalled();
  });

  test('our own users table answers before Google is asked', async () => {
    dbReturns({ names: [{ chat_user_id: 'users/222', name: 'Chris Reddemom', email: 'writers@granted.ca' }] });

    const names = await resolveSenderNames([{ name: 'users/222', domainId: INTERNAL_DOMAIN }], ASKER);

    expect(names.get('users/222')).toBe('Chris Reddemom');
    expect(mockUsersGet).not.toHaveBeenCalled();
  });

  test('the directory resolves anyone the first two sources missed', async () => {
    const names = await resolveSenderNames([{ name: 'users/333', domainId: INTERNAL_DOMAIN }], ASKER);

    expect(names.get('users/333')).toBe('Stephanie Vance');
    expect(mockUsersGet).toHaveBeenCalledWith({ userKey: '333', viewType: 'domain_public' });
  });

  test('a directory record with only given/family names still yields one', async () => {
    mockUsersGet.mockResolvedValue({ data: { name: { givenName: 'Ada', familyName: 'Lovelace' } } });
    const names = await resolveSenderNames([{ name: 'users/444', domainId: INTERNAL_DOMAIN }], ASKER);
    expect(names.get('users/444')).toBe('Ada Lovelace');
  });
});

describe('the cache', () => {
  test('a second request for the same person makes no second call', async () => {
    await resolveSenderNames([{ name: 'users/333', domainId: INTERNAL_DOMAIN }], ASKER);
    expect(mockUsersGet).toHaveBeenCalledTimes(1);

    const again = await resolveSenderNames([{ name: 'users/333', domainId: INTERNAL_DOMAIN }], ASKER);

    expect(again.get('users/333')).toBe('Stephanie Vance');
    expect(mockUsersGet).toHaveBeenCalledTimes(1);   // still one
  });

  test('30 messages from 5 people cost 5 lookups, not 30', async () => {
    mockUsersGet.mockImplementation(async ({ userKey }) => ({
      data: { name: { fullName: `Person ${userKey}` } }
    }));

    const senders = Array.from({ length: 30 }, (_, i) => ({
      name: `users/${500 + (i % 5)}`, domainId: INTERNAL_DOMAIN
    }));

    const names = await resolveSenderNames(senders, ASKER);

    expect(mockUsersGet).toHaveBeenCalledTimes(5);
    expect(names.size).toBe(5);
    expect(names.get('users/500')).toBe('Person 500');
  });

  test('a fallback is not cached — a name that appears later is picked up', async () => {
    mockUsersGet.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 500 }));
    const first = await resolveSenderNames([{ name: 'users/777', domainId: INTERNAL_DOMAIN }], ASKER);
    expect(first.get('users/777')).toBe(FALLBACKS.internalUnresolved);

    mockUsersGet.mockResolvedValue({ data: { name: { fullName: 'Late Arrival' } } });
    const second = await resolveSenderNames([{ name: 'users/777', domainId: INTERNAL_DOMAIN }], ASKER);
    expect(second.get('users/777')).toBe('Late Arrival');
  });
});

describe('degrading honestly', () => {
  test('a directory failure falls back without throwing', async () => {
    mockUsersGet.mockRejectedValue(Object.assign(new Error('backend error'), { code: 500 }));

    const names = await resolveSenderNames([{ name: 'users/888', domainId: INTERNAL_DOMAIN }], ASKER);
    expect(names.get('users/888')).toBe(FALLBACKS.internalUnresolved);
  });

  test('a database failure does not stop the directory from answering', async () => {
    mockQuery.mockImplementation(async (sql) => { if (/SELECT email FROM users/.test(sql)) return { rows: [{ email: 'asker@granted.ca' }] }; throw new Error('db down'); });

    const names = await resolveSenderNames([{ name: 'users/333', domainId: INTERNAL_DOMAIN }], ASKER);
    expect(names.get('users/333')).toBe('Stephanie Vance');
  });

  test('someone outside the Workspace is labelled as outside Granted, not Unknown', async () => {
    // 404 from the directory is the normal answer for an external person.
    mockUsersGet.mockRejectedValue(Object.assign(new Error('Not found'), { code: 404 }));

    const names = await resolveSenderNames([{ name: 'users/999' }], ASKER);   // no domainId
    expect(names.get('users/999')).toBe(FALLBACKS.external);
    expect(names.get('users/999')).not.toMatch(/unknown/i);
  });

  test('an unresolvable colleague is not accused of being an outsider', async () => {
    mockUsersGet.mockRejectedValue(Object.assign(new Error('timeout'), { code: 503 }));

    const names = await resolveSenderNames([{ name: 'users/1000', domainId: INTERNAL_DOMAIN }], ASKER);
    expect(names.get('users/1000')).toBe(FALLBACKS.internalUnresolved);
    expect(names.get('users/1000')).not.toBe(FALLBACKS.external);
  });

  test('with no service account configured, it still returns labels', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

    const names = await resolveSenderNames([
      { name: 'users/1', displayName: 'Known Person' },
      { name: 'users/2', domainId: INTERNAL_DOMAIN }
    ], ASKER);

    expect(names.get('users/1')).toBe('Known Person');
    expect(names.get('users/2')).toBe(FALLBACKS.internalUnresolved);
  });

  test('a sender with no id is skipped rather than crashing', async () => {
    const names = await resolveSenderNames([null, {}, { name: 'users/1', displayName: 'Fine' }], ASKER);
    expect(names.size).toBe(1);
  });

  test('the single-sender helper matches the batch behaviour', async () => {
    await expect(resolveSenderName({ name: 'users/333', domainId: INTERNAL_DOMAIN }, ASKER)).resolves.toBe('Stephanie Vance');
    await expect(resolveSenderName(null)).resolves.toBe(FALLBACKS.external);
  });
});
