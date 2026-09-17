/**
 * POST /api/chat/events — the Pub/Sub push that keeps the stored Chat copy current
 *
 * The real handler, listener and store code run against in-memory fakes of the
 * database and Google (tests/unit/helpers/chat-listen-fakes.js). What matters:
 * nothing unauthenticated gets in; create/update/delete are idempotent and can't
 * be undone by a late event; only listened spaces are touched; the listener's
 * credentials are the only ones used; a listener that loses access PAUSES the
 * space and never wipes it; and the logs never carry message content.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/chat-listen-push.test.js
 */

import { jest } from '@jest/globals';
import {
  createFakeDb, createFakeGoogle, httpError, invalidGrant, scopeInsufficient, pushBody, mockRes
} from './helpers/chat-listen-fakes.js';

const SPACE = 'spaces/AAQAsvTWxwE';            // the real allowlist entry (RTRI Changes)
const OTHER_SPACE = 'spaces/NOTLISTENED';
const PUSH_SA = 'oracle-pubsub-push@proj.iam.gserviceaccount.com';
const AUDIENCE = 'https://hub.example/api/chat/events';
const LISTENER_EMAIL = 'listener@granted.ca';
const LISTENER_ID = 42;
const SECRET_TEXT = 'SENTINEL-confidential-grant-figures';
const SENDER = 'users/987654321';

const ENV = {
  CHAT_LISTENER_USER_EMAIL: LISTENER_EMAIL,
  CHAT_EVENTS_PUBSUB_TOPIC: 'projects/p/topics/oracle-chat-events',
  PUBSUB_PUSH_AUDIENCE: AUDIENCE,
  PUBSUB_PUSH_SERVICE_ACCOUNT: PUSH_SA
};
Object.assign(process.env, ENV);
delete process.env.CHAT_LISTEN_DISABLED;

const db = createFakeDb();
let g = createFakeGoogle();

jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: (...args) => db.query(...args),
  transaction: (...args) => db.transaction(...args),
  getPool: () => null
}));

const mockGetUserOAuth2Client = jest.fn();
jest.unstable_mockModule('../../src/tools/google-docs.js', () => ({
  getUserOAuth2Client: mockGetUserOAuth2Client,
  getDocsClient: jest.fn(),
  getDriveClient: jest.fn()
}));

const mockHasChatScopes = jest.fn();
jest.unstable_mockModule('../../src/tools/chat-history.js', () => ({
  hasChatScopes: mockHasChatScopes,
  isInsufficientScopeError: (err) => /ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(JSON.stringify(err?.response?.data ?? ''))
}));

const mockVerify = jest.fn();
jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: { OAuth2: class { verifyIdToken(opts) { return mockVerify(opts); } } },
    chat: ({ auth }) => (auth === g.client ? g.listenerChat : g.appChat)
  }
}));

const mockPostToSpace = jest.fn(async () => true);
jest.unstable_mockModule('../../src/api/chat-google.js', () => ({ postToSpace: mockPostToSpace }));

const { handleChatEventsPush } = await import('../../src/api/chat-events.js');
const { forgetListener, setSleepForTests } = await import('../../src/chat-listen/listener.js');
setSleepForTests(async () => {});

// --- helpers ---------------------------------------------------------------
const T = 'google.workspace.chat.message.v1.';
const msgName = (id, space = SPACE) => `${space}/messages/${id}`;
const subject = (space = SPACE) => `//chat.googleapis.com/${space}`;
const single = (name) => ({ message: { name } });
const batch = (...names) => ({ messages: names.map(name => ({ message: { name } })) });

async function push(type, data, { space = SPACE, auth = 'Bearer good-token', body } = {}) {
  const res = mockRes();
  const req = {
    headers: auth ? { authorization: auth } : {},
    body: body ?? pushBody(`${T}${type}`, data, subject(space))
  };
  await handleChatEventsPush(req, res);
  return res.statusCode;
}

let logSpies;
const logged = () => logSpies
  .flatMap(spy => spy.mock.calls)
  .map(args => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  .join('\n');

beforeEach(() => {
  g = createFakeGoogle();
  g.memberSpaces.add(SPACE);
  db.spaces.clear();
  db.messages.clear();
  db.tombstones.clear();
  db.failWhen = null;
  db.users = [
    { id: LISTENER_ID, email: LISTENER_EMAIL, is_active: true },
    { id: 7, email: 'someone-else@granted.ca', is_active: true }
  ];
  db.addSpace(SPACE, { subscription_name: 'subscriptions/sub1' });

  Object.assign(process.env, ENV);
  delete process.env.CHAT_LISTEN_DISABLED;
  forgetListener();

  mockVerify.mockReset();
  mockVerify.mockImplementation(async () => ({
    getPayload: () => ({ iss: 'https://accounts.google.com', aud: AUDIENCE, email: PUSH_SA, email_verified: true })
  }));
  mockGetUserOAuth2Client.mockReset();
  mockGetUserOAuth2Client.mockImplementation(async () => g.client);
  mockHasChatScopes.mockReset();
  mockHasChatScopes.mockImplementation(async () => ({ ok: true, missing: [] }));
  mockPostToSpace.mockClear();

  logSpies = ['log', 'warn', 'error'].map(level => jest.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  logSpies.forEach(spy => spy.mockRestore());
});

// --- authentication --------------------------------------------------------
describe('only our Pub/Sub subscription gets in', () => {
  const nothingTouched = () => {
    expect(g.calls).toHaveLength(0);
    expect(db.messages.size).toBe(0);
    expect(mockGetUserOAuth2Client).not.toHaveBeenCalled();
  };

  beforeEach(() => g.addMessage(msgName('m1')));

  test('no bearer token → 401', async () => {
    expect(await push('created', single(msgName('m1')), { auth: null })).toBe(401);
    expect(mockVerify).not.toHaveBeenCalled();
    nothingTouched();
  });

  test('token that fails verification (wrong audience, bad signature, expired) → 401', async () => {
    mockVerify.mockRejectedValue(new Error('Wrong recipient, payload audience != requiredAudience'));
    expect(await push('created', single(msgName('m1')))).toBe(401);
    expect(mockVerify).toHaveBeenCalledWith({ idToken: 'good-token', audience: AUDIENCE });
    nothingTouched();
    expect(logged()).toContain('reason: token_invalid');
  });

  test.each([
    ['another service account', { email: 'attacker@evil.iam.gserviceaccount.com' }, 'wrong_service_account'],
    ['an unverified email', { email_verified: false }, 'email_not_verified'],
    ['a foreign issuer', { iss: 'https://evil.example' }, 'wrong_issuer']
  ])('a valid Google token for %s → 401', async (_label, override, reason) => {
    mockVerify.mockResolvedValue({
      getPayload: () => ({ iss: 'https://accounts.google.com', email: PUSH_SA, email_verified: true, ...override })
    });
    expect(await push('created', single(msgName('m1')))).toBe(401);
    nothingTouched();
    expect(logged()).toContain(`reason: ${reason}`);
  });

  test.each(['PUBSUB_PUSH_AUDIENCE', 'PUBSUB_PUSH_SERVICE_ACCOUNT'])('%s unset → fails closed', async (name) => {
    delete process.env[name];
    expect(await push('created', single(msgName('m1')))).toBe(401);
    expect(mockVerify).not.toHaveBeenCalled();
    nothingTouched();
  });
});

// --- create / update / delete ----------------------------------------------
describe('create, update and delete are applied idempotently', () => {
  test('created: stores the listed fields — and a replay changes nothing', async () => {
    g.addMessage(msgName('m1'), {
      text: SECRET_TEXT,
      sender: { name: SENDER, displayName: 'Stephanie Example', email: 'steph@granted.ca', type: 'HUMAN' },
      thread: { name: `${SPACE}/threads/T9` },
      attachment: [{ name: 'a', contentName: 'budget.pdf', attachmentDataRef: { resourceName: 'x' } }]
    });

    expect(await push('created', single(msgName('m1')))).toBe(204);
    expect(await push('created', single(msgName('m1')))).toBe(204);

    expect(db.messages.size).toBe(1);
    const row = db.messages.get(msgName('m1'));
    expect(row).toMatchObject({
      message_name: msgName('m1'),
      space_name: SPACE,
      thread_name: `${SPACE}/threads/T9`,
      sender_user_id: SENDER,
      text: SECRET_TEXT
    });
    expect(Object.keys(row).sort()).toEqual(
      ['create_time', 'message_name', 'sender_user_id', 'space_name', 'stored_at', 'text', 'thread_name', 'update_time']
    );
  });

  test('updated: the newer text overwrites the stored copy', async () => {
    g.addMessage(msgName('m1'), { text: 'first', createTime: '2026-09-01T10:00:00Z', lastUpdateTime: '2026-09-01T10:00:00Z' });
    await push('created', single(msgName('m1')));

    g.messages.get(msgName('m1')).text = 'edited';
    g.messages.get(msgName('m1')).lastUpdateTime = '2026-09-01T11:00:00Z';
    expect(await push('updated', single(msgName('m1')))).toBe(204);

    expect(db.messages.get(msgName('m1')).text).toBe('edited');
    expect(db.messages.size).toBe(1);
  });

  test('a stale version never overwrites a newer one', async () => {
    db.addMessage(msgName('m1'), { text: 'newest', update_time: new Date('2026-09-01T12:00:00Z') });
    g.addMessage(msgName('m1'), { text: 'stale', lastUpdateTime: '2026-09-01T11:00:00Z' });

    expect(await push('updated', single(msgName('m1')))).toBe(204);
    expect(db.messages.get(msgName('m1')).text).toBe('newest');
    expect(logged()).toContain('unchanged 1');
  });

  test('deleted: removes the copy and a replay is harmless', async () => {
    db.addMessage(msgName('m1'));
    expect(await push('deleted', single(msgName('m1')))).toBe(204);
    expect(await push('deleted', single(msgName('m1')))).toBe(204);

    expect(db.messages.has(msgName('m1'))).toBe(false);
    expect(db.tombstones.has(msgName('m1'))).toBe(true);
    // A delete needs no fetch.
    expect(g.calls.filter(c => c.op === 'messages.get')).toHaveLength(0);
  });

  test('a late "created" after a delete does not bring the message back', async () => {
    // The fetch still returns the message (e.g. it was read just before the deletion).
    g.addMessage(msgName('m1'), { text: SECRET_TEXT });
    await push('deleted', single(msgName('m1')));
    expect(await push('created', single(msgName('m1')))).toBe(204);
    expect(db.messages.has(msgName('m1'))).toBe(false);
  });

  test('batch events are handled like single ones', async () => {
    for (const id of ['b1', 'b2', 'b3']) g.addMessage(msgName(id));
    expect(await push('batchCreated', batch(msgName('b1'), msgName('b2'), msgName('b3')))).toBe(204);
    expect(db.messages.size).toBe(3);

    g.messages.get(msgName('b2')).text = 'edited';
    g.messages.get(msgName('b2')).lastUpdateTime = new Date(Date.now() + 1000).toISOString();
    expect(await push('batchUpdated', batch(msgName('b2')))).toBe(204);
    expect(db.messages.get(msgName('b2')).text).toBe('edited');

    expect(await push('batchDeleted', batch(msgName('b1'), msgName('b3')))).toBe(204);
    expect([...db.messages.keys()]).toEqual([msgName('b2')]);
  });

  test('a 404 while the listener can still see the space means deleted', async () => {
    db.addMessage(msgName('gone'));
    expect(await push('updated', single(msgName('gone')))).toBe(204);
    expect(db.messages.has(msgName('gone'))).toBe(false);
    expect(db.tombstones.has(msgName('gone'))).toBe(true);
    expect(db.spaces.get(SPACE).status).toBe('active');
  });

  test('a private message is never stored', async () => {
    g.addMessage(msgName('p1'), { privateMessageViewer: { name: 'users/5' }, text: SECRET_TEXT });
    expect(await push('created', single(msgName('p1')))).toBe(204);
    expect(db.messages.size).toBe(0);
    expect(logged()).toContain('private 1');
  });

  test('a message name outside the event\'s space is skipped, not filed under it', async () => {
    g.addMessage(msgName('x1', OTHER_SPACE));
    expect(await push('created', single(msgName('x1', OTHER_SPACE)))).toBe(204);
    expect(db.messages.size).toBe(0);
    expect(g.calls.filter(c => c.op === 'messages.get')).toHaveLength(0);
  });
});

// --- which spaces ----------------------------------------------------------
describe('only listened, active spaces are touched', () => {
  test('a space not on the allowlist is ignored without a fetch', async () => {
    db.addSpace(OTHER_SPACE); // even with a row, the allowlist decides
    g.addMessage(msgName('m1', OTHER_SPACE));
    expect(await push('created', single(msgName('m1', OTHER_SPACE)), { space: OTHER_SPACE })).toBe(204);
    expect(g.calls).toHaveLength(0);
    expect(db.messages.size).toBe(0);
  });

  test('a DM event is ignored — DMs are never on the allowlist', async () => {
    const dm = 'spaces/DMxyz';
    g.addMessage(msgName('d1', dm));
    expect(await push('created', single(msgName('d1', dm)), { space: dm })).toBe(204);
    expect(g.calls).toHaveLength(0);
    expect(db.messages.size).toBe(0);
  });

  test('a removed space is ignored', async () => {
    db.spaces.get(SPACE).status = 'removed';
    g.addMessage(msgName('m1'));
    expect(await push('created', single(msgName('m1')))).toBe(204);
    expect(db.messages.size).toBe(0);
  });

  test('a paused space holds the event for redelivery (503) without fetching', async () => {
    db.spaces.get(SPACE).status = 'paused';
    g.addMessage(msgName('m1'));
    expect(await push('created', single(msgName('m1')))).toBe(503);
    expect(g.calls).toHaveLength(0);
  });

  test('listening switched off holds events (503)', async () => {
    process.env.CHAT_LISTEN_DISABLED = 'true';
    g.addMessage(msgName('m1'));
    expect(await push('created', single(msgName('m1')))).toBe(503);
    expect(db.messages.size).toBe(0);
  });

  test('an unreadable body is acknowledged (204) — redelivery would not help', async () => {
    const res = mockRes();
    await handleChatEventsPush({
      headers: { authorization: 'Bearer good-token' },
      body: { message: { attributes: { 'ce-type': `${T}created` }, data: '!!not-base64-json!!' } }
    }, res);
    expect(res.statusCode).toBe(204);

    const res2 = mockRes();
    await handleChatEventsPush({ headers: { authorization: 'Bearer good-token' }, body: { message: {} } }, res2);
    expect(res2.statusCode).toBe(204);
  });
});

// --- the listener ----------------------------------------------------------
describe('the listener, and what happens when it loses access', () => {
  beforeEach(() => {
    db.addMessage(msgName('kept1'), { text: 'already stored' });
    db.addMessage(msgName('kept2'), { text: 'already stored' });
    g.addMessage(msgName('m1'));
  });

  const copyKept = () => {
    expect(db.messages.has(msgName('kept1'))).toBe(true);
    expect(db.messages.has(msgName('kept2'))).toBe(true);
  };

  test('only the configured listener\'s credentials are ever used', async () => {
    // Nothing in the event can choose the user: the sender, other ids and even a
    // "user" field in the payload are ignored.
    g.addMessage(msgName('m2'), { sender: { name: 'users/7', email: 'someone-else@granted.ca' } });
    const data = { ...single(msgName('m2')), user: 'someone-else@granted.ca', userId: 7 };
    expect(await push('created', data)).toBe(204);

    expect(mockGetUserOAuth2Client).toHaveBeenCalled();
    for (const [userId] of mockGetUserOAuth2Client.mock.calls) expect(userId).toBe(LISTENER_ID);
  });

  test('a 404 when the listener can no longer see the space pauses — no tombstone, copy kept', async () => {
    g.memberSpaces.clear();
    db.addMessage(msgName('m1'));
    g.messages.delete(msgName('m1'));

    expect(await push('updated', single(msgName('m1')))).toBe(503);
    expect(db.spaces.get(SPACE)).toMatchObject({ status: 'paused', pause_reason: 'listener_not_member' });
    expect(db.tombstones.size).toBe(0);
    expect(db.messages.has(msgName('m1'))).toBe(true);
    copyKept();
  });

  test('a 403 on fetch pauses the space and holds the event', async () => {
    g.fail('messages.get', httpError(403));
    expect(await push('created', single(msgName('m1')))).toBe(503);
    expect(db.spaces.get(SPACE)).toMatchObject({ status: 'paused', pause_reason: 'listener_not_member' });
    copyKept();
  });

  test('a revoked token pauses the space — no crash', async () => {
    g.tokenRevoked = true;
    expect(await push('created', single(msgName('m1')))).toBe(503);
    expect(db.spaces.get(SPACE)).toMatchObject({ status: 'paused', pause_reason: 'listener_token_revoked' });
    copyKept();
  });

  test('a token revoked mid-call (invalid_grant on refresh) pauses the space', async () => {
    g.fail('messages.get', invalidGrant());
    expect(await push('created', single(msgName('m1')))).toBe(503);
    expect(db.spaces.get(SPACE).pause_reason).toBe('listener_token_revoked');
  });

  test('a missing scope at call time pauses the space', async () => {
    g.fail('messages.get', scopeInsufficient());
    expect(await push('created', single(msgName('m1')))).toBe(503);
    expect(db.spaces.get(SPACE).pause_reason).toBe('listener_scope_missing');
  });

  test.each([
    ['env points outside granted.ca', () => { process.env.CHAT_LISTENER_USER_EMAIL = 'listener@gmail.com'; }, 'listener_not_configured'],
    ['env unset', () => { process.env.CHAT_LISTENER_USER_EMAIL = ''; }, null],
    ['no such active user', () => { db.users = []; }, 'listener_not_found'],
    ['no stored token', () => { mockGetUserOAuth2Client.mockRejectedValue(new Error('User has not authorized')); }, 'listener_no_token'],
    ['scopes not granted', () => { mockHasChatScopes.mockResolvedValue({ ok: false, missing: ['x'] }); }, 'listener_scope_missing']
  ])('listener problem: %s → event held, copy kept', async (_label, arrange, code) => {
    arrange();
    const status = await push('created', single(msgName('m1')));
    expect(status).toBe(503);
    if (code === null) {
      // Unset env is caught earlier: listening is not configured at all, so the
      // event is held without touching the space.
      expect(db.spaces.get(SPACE).status).toBe('active');
    } else {
      expect(db.spaces.get(SPACE)).toMatchObject({ status: 'paused', pause_reason: code });
    }
    expect(g.calls.filter(c => c.op === 'messages.get')).toHaveLength(0);
    copyKept();
  });

  test('a transient failure asks for redelivery (500) and the retry succeeds', async () => {
    g.fail('messages.get', httpError(503));
    expect(await push('created', single(msgName('m1')))).toBe(500);
    expect(db.messages.has(msgName('m1'))).toBe(false);
    expect(db.spaces.get(SPACE).status).toBe('active');

    expect(await push('created', single(msgName('m1')))).toBe(204);
    expect(db.messages.has(msgName('m1'))).toBe(true);
  });

  test('a database failure asks for redelivery (500)', async () => {
    db.failWhen = (sql) => sql.startsWith('INSERT INTO chat_space_messages');
    expect(await push('created', single(msgName('m1')))).toBe(500);
    expect(logged()).toContain('Chat events push failed — code: 57P01');
  });
});

// --- logs ------------------------------------------------------------------
describe('logs', () => {
  test('carry types, counts and codes — never text, names, emails or ids', async () => {
    g.addMessage(msgName('m1'), {
      text: SECRET_TEXT,
      sender: { name: SENDER, displayName: 'Stephanie Example', email: 'steph@granted.ca' }
    });
    await push('created', single(msgName('m1')));
    g.messages.get(msgName('m1')).lastUpdateTime = new Date(Date.now() + 1000).toISOString();
    await push('updated', single(msgName('m1')));
    await push('deleted', single(msgName('m1')));
    g.fail('messages.get', httpError(403));
    g.addMessage(msgName('m2'), { text: SECRET_TEXT });
    await push('created', single(msgName('m2')));
    mockVerify.mockRejectedValue(new Error('bad'));
    await push('created', single(msgName('m2')));

    const out = logged();
    expect(out).toContain('📨 Chat listen event — created');
    for (const secret of [SECRET_TEXT, SENDER, 'Stephanie', 'steph@granted.ca', LISTENER_EMAIL, 'AAQAsvTWxwE', 'messages/m1', 'good-token']) {
      expect(out).not.toContain(secret);
    }
  });
});
