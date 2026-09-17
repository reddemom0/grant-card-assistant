/**
 * The stored Chat copy over time — enabling, renewing, pausing, backfilling,
 * retention and removal
 *
 * Real subscription, backfill, job, intro and Chat-adapter code run against
 * in-memory fakes of the database and Google (tests/unit/helpers/chat-listen-fakes.js).
 * The Oracle agent loop is stubbed; nothing here calls a model.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/chat-listen-lifecycle.test.js
 */

import { jest } from '@jest/globals';
import {
  createFakeDb, createFakeGoogle, httpError, pushBody, mockRes, eventually
} from './helpers/chat-listen-fakes.js';

const SPACE = 'spaces/AAQAsvTWxwE';            // the real allowlist entry (RTRI Changes)
const OLD_SPACE = 'spaces/NOLONGERLISTED';
const LISTENER_EMAIL = 'listener@granted.ca';
const LISTENER_ID = 42;
const PUSH_SA = 'oracle-pubsub-push@proj.iam.gserviceaccount.com';
const PUSH_AUDIENCE = 'https://hub.example/api/chat/events';
const CHAT_AUDIENCE = 'https://hub.example/api/chat/google';
const CHAT_ISSUER = 'addon@proj.iam.gserviceaccount.com';
const TOPIC = 'projects/p/topics/oracle-chat-events';
const SECRET_TEXT = 'SENTINEL-confidential-grant-figures';
const SENDER = 'users/987654321';
const INTRO = 'ORACLE-INTRO-CARD';   // what the mocked intro card posts
const DAY = 864e5;

const ENV = {
  CHAT_LISTENER_USER_EMAIL: LISTENER_EMAIL,
  CHAT_EVENTS_PUBSUB_TOPIC: TOPIC,
  PUBSUB_PUSH_AUDIENCE: PUSH_AUDIENCE,
  PUBSUB_PUSH_SERVICE_ACCOUNT: PUSH_SA,
  GOOGLE_CHAT_AUDIENCE: CHAT_AUDIENCE,
  GOOGLE_CHAT_ISSUER_EMAIL: CHAT_ISSUER,
  GOOGLE_SERVICE_ACCOUNT_KEY: '{}'
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
  isInsufficientScopeError: (err) => /ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(JSON.stringify(err?.response?.data ?? '')),
  hubSignInUrl: () => 'https://hub.example/login'
}));

// One OAuth2 class serves both inbound checks; the audience says which.
jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        async verifyIdToken({ audience }) {
          const payload = audience === PUSH_AUDIENCE
            ? { iss: 'https://accounts.google.com', email: PUSH_SA, email_verified: true }
            : { email: CHAT_ISSUER, email_verified: true };
          return { getPayload: () => payload };
        }
      },
      GoogleAuth: class {}
    },
    chat: ({ auth }) => (auth === g.client ? g.listenerChat : g.appChat)
  }
}));

// The allowlist this suite means: its own one space. The real list
// (data/chat/listen-spaces.json) is edited whenever a space is added, and the
// counts below are about this fixture, not about that file.
jest.unstable_mockModule('../../src/chat-listen/config.js', () => ({
  RETENTION_MONTHS: 12,
  TOMBSTONE_DAYS: 30,
  RENEW_WITHIN_MS: 48 * 60 * 60 * 1000,
  CATCH_UP_OVERLAP_MS: 5 * 60 * 1000,
  MESSAGE_EVENT_TYPES: [
    'google.workspace.chat.message.v1.created',
    'google.workspace.chat.message.v1.updated',
    'google.workspace.chat.message.v1.deleted'
  ],
  listenSpaces: () => [{ name: SPACE, label: 'RTRI Changes' }],
  isListenSpace: (name) => name === SPACE,
  listenEntry: (name) => (name === SPACE ? { name: SPACE, label: 'RTRI Changes' } : null),
  listenDisabled: () => process.env.CHAT_LISTEN_DISABLED === 'true',
  listenEnvProblems: () => ['CHAT_LISTENER_USER_EMAIL', 'CHAT_EVENTS_PUBSUB_TOPIC', 'PUBSUB_PUSH_AUDIENCE', 'PUBSUB_PUSH_SERVICE_ACCOUNT']
    .filter(name => !process.env[name]),
  listenReady: () => process.env.CHAT_LISTEN_DISABLED !== 'true'
    && ['CHAT_LISTENER_USER_EMAIL', 'CHAT_EVENTS_PUBSUB_TOPIC', 'PUBSUB_PUSH_AUDIENCE', 'PUBSUB_PUSH_SERVICE_ACCOUNT'].every(name => process.env[name]),
  monthsAgo: (months, now = new Date()) => {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - months);
    return d;
  },
  daysAgo: (days, now = new Date()) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}));

// Members are told with the intro card (src/cards/intro-card.js), whose content
// is tested in intro-card.test.js. Here it matters only that the space is told
// exactly once, before anything is read, through the same Chat call as before —
// and that a failure to tell it stops listening.
const intro = { told: new Set() };
jest.unstable_mockModule('../../src/cards/intro-card.js', () => ({
  postIntro: async ({ spaceName }) => {
    if (intro.told.has(spaceName)) return true;
    const { postToSpace } = await import('../../src/api/chat-google.js');
    const posted = await postToSpace(spaceName, INTRO);
    if (posted) intro.told.add(spaceName);
    return posted;
  },
  replyWithIntro: async () => true,
  dmIntroDone: async () => true,
  introContent: () => ({ can: [], examples: [], privately: [], goodToKnow: [], guideUrl: null, where: 'this space' }),
  introThreadName: (spaceName) => `${spaceName}/threads/intro`,
  introType: { type: 'intro' }
}));
jest.unstable_mockModule('../../src/database/tracked-cards-store.js', () => ({
  spaceIntro: async (spaceName) => (intro.told.has(spaceName) ? { space_name: spaceName, kind: 'space' } : null),
  claimSpaceIntro: async () => true,
  releaseSpaceIntro: async () => {},
  setSpaceIntroMessage: async () => {},
  liveCardsInThread: async () => [],
  liveCardsOfType: async () => [],
  touchActivity: async () => {}
}));

jest.unstable_mockModule('../../src/claude/client.js', () => ({ runAgent: jest.fn() }));
jest.unstable_mockModule('../../src/database/messages.js', () => ({
  createConversation: jest.fn(),
  saveMessage: jest.fn()
}));
jest.unstable_mockModule('../../src/api/confirmation.js', () => ({
  tryHandleConfirmation: jest.fn(),
  currentPendingId: jest.fn(),
  proposalNotice: jest.fn()
}));

const subs = await import('../../src/chat-listen/subscriptions.js');
const { runBackfill, whenIdle } = await import('../../src/chat-listen/backfill.js');
const { runListenPass, runRetention, startChatListen } = await import('../../src/chat-listen/jobs.js');
const { forgetListener, setSleepForTests } = await import('../../src/chat-listen/listener.js');
const { handleChatEventsPush } = await import('../../src/api/chat-events.js');
const { handleGoogleChatEvent } = await import('../../src/api/chat-google.js');
setSleepForTests(async () => {});

// --- helpers ---------------------------------------------------------------
const msgName = (id, space = SPACE) => `${space}/messages/${id}`;
const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const space = () => db.spaces.get(SPACE);
const postedTexts = () => g.posts.map(p => p.requestBody.text);

/** Seed the fake Chat space with n messages, oldest first. */
function seedChat(n, { space: s = SPACE, from = 10 * DAY } = {}) {
  for (let i = 1; i <= n; i++) {
    g.addMessage(msgName(`m${i}`, s), { createTime: at(from - i * 60_000), lastUpdateTime: at(from - i * 60_000), text: `${SECRET_TEXT} ${i}` });
  }
}

/** A followed space that is fully set up. */
function activeSpace(fields = {}) {
  const subscription = g.addSubscription(SPACE, fields.subscription);
  db.addSpace(SPACE, { subscription_name: subscription, ...fields.row });
  return subscription;
}

async function pass() {
  const result = await runListenPass();
  await whenIdle();
  return result;
}

async function lifecycle(kind, subscription, { wrapped = true } = {}) {
  const res = mockRes();
  const data = wrapped ? { subscription } : subscription;
  await handleChatEventsPush({
    headers: { authorization: 'Bearer push-token' },
    body: pushBody(`google.workspace.events.subscription.v1.${kind}`, data, `//workspaceevents.googleapis.com/${subscription.name}`)
  }, res);
  await whenIdle();
  return res.statusCode;
}

async function chatEvent(container, spaceFields) {
  const res = mockRes();
  await handleGoogleChatEvent({
    headers: { authorization: 'Bearer chat-token' },
    body: { chat: { [container]: { space: spaceFields } } }
  }, res);
  return res;
}

let logSpies;
const logged = () => logSpies
  .flatMap(spy => spy.mock.calls)
  .map(args => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  .join('\n');

beforeEach(() => {
  g = createFakeGoogle();
  g.memberSpaces.add(SPACE);
  intro.told.clear();
  db.spaces.clear();
  db.messages.clear();
  db.tombstones.clear();
  db.failWhen = null;
  db.users = [{ id: LISTENER_ID, email: LISTENER_EMAIL, is_active: true }];

  Object.assign(process.env, ENV);
  delete process.env.CHAT_LISTEN_DISABLED;
  forgetListener();

  mockGetUserOAuth2Client.mockReset();
  mockGetUserOAuth2Client.mockImplementation(async () => g.client);
  mockHasChatScopes.mockReset();
  mockHasChatScopes.mockImplementation(async () => ({ ok: true, missing: [] }));

  logSpies = ['log', 'warn', 'error'].map(level => jest.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(async () => {
  await whenIdle();
  logSpies.forEach(spy => spy.mockRestore());
});

// --- enabling --------------------------------------------------------------
describe('enabling RTRI Changes', () => {
  test('first pass: notice first, then subscribe, then a full backfill', async () => {
    seedChat(5);
    const result = await pass();

    expect(result.pass).toMatchObject({ spaces: 1, enabled: 1, created: 1 });
    expect(space()).toMatchObject({ status: 'active', backfill_state: 'done', backfill_page_token: null });

    // The space was told once, as a new top-level message: the intro card,
    // which carries the 12-month-copy line (intro-card.test.js).
    expect(g.posts).toHaveLength(1);
    expect(g.posts[0].parent).toBe(SPACE);
    expect(g.posts[0].requestBody.text).toBe(INTRO);
    expect('thread' in g.posts[0].requestBody).toBe(false);

    // ...before anything was subscribed or read.
    const order = g.calls.map(c => c.op);
    const posted = order.indexOf('app.messages.create');
    expect(posted).toBeLessThan(order.indexOf('events.POST'));
    expect(posted).toBeLessThan(order.indexOf('messages.list'));

    const [create] = g.eventsCalls('POST', /^subscriptions$/);
    expect(create.data).toEqual({
      targetResource: `//chat.googleapis.com/${SPACE}`,
      eventTypes: [
        'google.workspace.chat.message.v1.created',
        'google.workspace.chat.message.v1.updated',
        'google.workspace.chat.message.v1.deleted'
      ],
      notificationEndpoint: { pubsubTopic: TOPIC },
      payloadOptions: { includeResource: false }
    });

    expect(db.messages.size).toBe(5);
    // The backfill window is the last 12 months.
    const since = new Date(/createTime > "([^"]+)"/.exec(g.calls.find(c => c.op === 'messages.list').filter)[1]);
    expect(Math.abs(since - new Date(Date.now() - 365 * DAY))).toBeLessThan(2 * DAY);
  });

  test('a second pass changes nothing: no second notice, no second subscription', async () => {
    seedChat(2);
    await pass();
    g.calls.length = 0;

    const result = await pass();
    expect(result.pass).toMatchObject({ active: 1, enabled: 0, created: 0 });
    expect(g.posts).toHaveLength(1);
    expect(g.eventsCalls('POST')).toHaveLength(0);
    expect(g.calls.filter(c => c.op === 'messages.list')).toHaveLength(0);
  });

  test('if the notice cannot be posted, listening does not start — and it is posted only once later', async () => {
    seedChat(2);
    g.postFails = true;
    await pass();

    expect(space()).toMatchObject({ status: 'paused', pause_reason: 'notice_failed', notice_posted_at: null });
    expect(g.eventsCalls('POST')).toHaveLength(0);
    expect(g.calls.filter(c => c.op === 'messages.list')).toHaveLength(0);
    expect(db.messages.size).toBe(0);

    g.postFails = false;
    await pass();
    await pass();
    expect(space().status).toBe('active');
    expect(g.posts).toHaveLength(1);
    expect(db.messages.size).toBe(2);
  });

  test('the listener must be a member: otherwise paused, nothing posted or subscribed', async () => {
    g.memberSpaces.clear();
    await pass();
    expect(space()).toMatchObject({ status: 'paused', pause_reason: 'listener_not_member' });
    expect(g.posts).toHaveLength(0);
    expect(g.eventsCalls('POST')).toHaveLength(0);
  });

  test('an allowlisted id that is a group chat or DM is refused', async () => {
    g.memberSpaces.clear();
    g.otherSpaces = [{ name: SPACE, spaceType: 'GROUP_CHAT' }];
    await pass();
    expect(space()).toMatchObject({ status: 'paused', pause_reason: 'listener_not_member' });
    expect(g.posts).toHaveLength(0);
    expect(g.eventsCalls('POST')).toHaveLength(0);

    g.otherSpaces = [{ name: SPACE, spaceType: 'DIRECT_MESSAGE' }];
    await pass();
    expect(space().status).toBe('paused');
  });

  test('nothing runs when listening is switched off', async () => {
    process.env.CHAT_LISTEN_DISABLED = 'true';
    expect(await runListenPass()).toEqual({ skipped: true });
    expect(db.spaces.size).toBe(0);
    expect(g.calls).toHaveLength(0);
  });
});

// --- the listener ----------------------------------------------------------
describe('listener problems pause, and the next good pass resumes', () => {
  test.each([
    ['token revoked', () => { g.tokenRevoked = true; }, 'listener_token_revoked'],
    ['no stored token', () => { mockGetUserOAuth2Client.mockRejectedValue(new Error('no token')); }, 'listener_no_token'],
    ['scopes not granted', () => { mockHasChatScopes.mockResolvedValue({ ok: false, missing: ['x'] }); }, 'listener_scope_missing'],
    ['user gone', () => { db.users = []; }, 'listener_not_found'],
    ['email outside granted.ca', () => { process.env.CHAT_LISTENER_USER_EMAIL = 'listener@example.com'; }, 'listener_not_configured']
  ])('%s → paused with a code, copy kept, then resumed with a catch-up', async (_label, breakIt, code) => {
    activeSpace();
    db.addMessage(msgName('old'), { create_time: new Date(Date.now() - 2 * DAY) });

    breakIt();
    const broken = await pass();
    expect(broken.pass).toMatchObject({ paused: 1 });
    expect(space()).toMatchObject({ status: 'paused', pause_reason: code });
    expect(db.messages.has(msgName('old'))).toBe(true);
    expect(logged()).toContain(`codes: ${code}`);

    // Fixed. A message arrived meanwhile.
    Object.assign(process.env, ENV);
    g.tokenRevoked = false;
    db.users = [{ id: LISTENER_ID, email: LISTENER_EMAIL, is_active: true }];
    mockGetUserOAuth2Client.mockReset();
    mockGetUserOAuth2Client.mockImplementation(async () => g.client);
    mockHasChatScopes.mockResolvedValue({ ok: true, missing: [] });
    g.addMessage(msgName('during'), { createTime: at(DAY) });

    const fixed = await pass();
    expect(fixed.pass).toMatchObject({ resumed: 1 });
    expect(space()).toMatchObject({ status: 'active', pause_reason: null });
    expect(db.messages.has(msgName('during'))).toBe(true);
    expect(db.messages.has(msgName('old'))).toBe(true);
  });

  test('the listener user removed from the space: paused, copy and subscription kept', async () => {
    const subscription = activeSpace();
    db.addMessage(msgName('old'));
    g.memberSpaces.clear();

    await pass();
    expect(space()).toMatchObject({ status: 'paused', pause_reason: 'listener_not_member', subscription_name: subscription });
    expect(db.messages.size).toBe(1);
    expect(g.eventsCalls('DELETE')).toHaveLength(0);
  });

  test('only the configured listener is ever used', async () => {
    db.users.push({ id: 7, email: 'someone-else@granted.ca', is_active: true });
    seedChat(3);
    await pass();
    expect(mockGetUserOAuth2Client).toHaveBeenCalled();
    for (const [userId] of mockGetUserOAuth2Client.mock.calls) expect(userId).toBe(LISTENER_ID);
  });
});

// --- renewal and lifecycle -------------------------------------------------
describe('renewal and lifecycle events', () => {
  test('a subscription within 48 hours of expiry is renewed to the maximum', async () => {
    const subscription = activeSpace({ subscription: { expireTime: new Date(Date.now() + DAY).toISOString() } });
    const result = await pass();

    expect(result.pass).toMatchObject({ renewed: 1, created: 0 });
    const [patch] = g.eventsCalls('PATCH');
    expect(patch).toMatchObject({ path: subscription, params: { updateMask: 'ttl' }, data: { ttl: '0s' } });
    expect(space().subscription_expire_time.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
  });

  test('a subscription with 5 days left is left alone', async () => {
    activeSpace({ subscription: { expireTime: new Date(Date.now() + 5 * DAY).toISOString() } });
    const result = await pass();
    expect(result.pass).toMatchObject({ active: 1, renewed: 0 });
    expect(g.eventsCalls('PATCH')).toHaveLength(0);
  });

  test('a subscription that is gone is recreated, and the gap is caught up', async () => {
    db.addSpace(SPACE, { subscription_name: 'subscriptions/expired-and-deleted' });
    db.addMessage(msgName('m1'), { create_time: new Date(Date.now() - 2 * DAY) });
    g.addMessage(msgName('m1'), { createTime: at(2 * DAY) });
    g.addMessage(msgName('gap'), { createTime: at(DAY) });

    const result = await pass();
    expect(result.pass).toMatchObject({ created: 1 });
    expect(space().subscription_name).not.toBe('subscriptions/expired-and-deleted');
    expect(g.subscriptions.has(space().subscription_name)).toBe(true);
    expect(db.messages.has(msgName('gap'))).toBe(true);
  });

  test.each([true, false])('an "expired" event recreates the subscription (payload wrapped: %s)', async (wrapped) => {
    const old = activeSpace();
    const expired = { ...g.subscriptions.get(old) };
    g.subscriptions.delete(old);

    expect(await lifecycle('expired', expired, { wrapped })).toBe(204);
    expect(space().subscription_name).not.toBe(old);
    expect(g.subscriptions.has(space().subscription_name)).toBe(true);
    expect(space().status).toBe('active');
  });

  test('an "expirationReminder" event renews', async () => {
    const subscription = activeSpace({ subscription: { expireTime: new Date(Date.now() + 3600e3).toISOString() } });
    expect(await lifecycle('expirationReminder', g.subscriptions.get(subscription))).toBe(204);
    expect(g.eventsCalls('PATCH')).toHaveLength(1);
  });

  test('a lifecycle event for a subscription we do not track is ignored', async () => {
    activeSpace();
    expect(await lifecycle('expired', { name: 'subscriptions/someone-elses' })).toBe(204);
    expect(g.eventsCalls('POST')).toHaveLength(0);
    expect(logged()).toContain('reason: untracked_subscription');
  });

  test('ALREADY_EXISTS: the existing subscription is adopted', async () => {
    const existing = g.addSubscription(SPACE);
    db.addSpace(SPACE, { status: 'paused', pause_reason: 'not_started', backfill_state: 'done' });

    await pass();
    expect(space()).toMatchObject({ status: 'active', subscription_name: existing });
    expect(g.subscriptions.size).toBe(1);
  });

  test('suspended — USER_AUTHORIZATION_FAILURE: paused with the copy kept, then replaced once access is back', async () => {
    const old = activeSpace();
    db.addMessage(msgName('kept'));
    const sub = g.subscriptions.get(old);
    Object.assign(sub, { state: 'SUSPENDED', suspensionReason: 'USER_AUTHORIZATION_FAILURE' });

    expect(await lifecycle('suspended', { ...sub })).toBe(204);
    expect(space()).toMatchObject({ status: 'paused', pause_reason: 'suspended_user_authorization_failure' });
    expect(db.messages.has(msgName('kept'))).toBe(true);

    // Access is back (the listener is still a member): it can't be reactivated, so it is replaced.
    const result = await pass();
    expect(result.pass).toMatchObject({ resumed: 1, created: 1, reactivated: 0 });
    expect(g.eventsCalls('POST', /:reactivate$/)).toHaveLength(0);
    expect(g.eventsCalls('DELETE')).toHaveLength(1);
    expect(g.subscriptions.has(old)).toBe(false);
    expect(space().subscription_name).not.toBe(old);
    expect(db.messages.has(msgName('kept'))).toBe(true);
  });

  test('suspended — USER_SCOPE_REVOKED: paused, then reactivated (not replaced) once the grant is back', async () => {
    const old = activeSpace();
    const sub = g.subscriptions.get(old);
    Object.assign(sub, { state: 'SUSPENDED', suspensionReason: 'USER_SCOPE_REVOKED' });

    await lifecycle('suspended', { ...sub });
    expect(space()).toMatchObject({ status: 'paused', pause_reason: 'suspended_user_scope_revoked' });

    const result = await pass();
    expect(result.pass).toMatchObject({ resumed: 1, reactivated: 1, created: 0 });
    expect(space().subscription_name).toBe(old);
    expect(g.subscriptions.get(old).state).toBe('ACTIVE');
  });

  test('suspended — reactivation refused: the subscription is replaced', async () => {
    const old = activeSpace();
    Object.assign(g.subscriptions.get(old), { state: 'SUSPENDED', suspensionReason: 'ENDPOINT_NOT_FOUND' });
    g.reactivateFails = true;

    const result = await pass();
    expect(result.pass).toMatchObject({ created: 1 });
    expect(space().subscription_name).not.toBe(old);
  });

  test('suspended — RESOURCE_DELETED: paused, copy kept, stays paused while the space is gone', async () => {
    const old = activeSpace();
    db.addMessage(msgName('kept'));
    const sub = g.subscriptions.get(old);
    Object.assign(sub, { state: 'SUSPENDED', suspensionReason: 'RESOURCE_DELETED' });

    await lifecycle('suspended', { ...sub });
    expect(space()).toMatchObject({ status: 'paused', pause_reason: 'suspended_resource_deleted' });

    g.memberSpaces.clear();
    await pass();
    expect(space()).toMatchObject({ status: 'paused', pause_reason: 'listener_not_member' });
    expect(db.messages.has(msgName('kept'))).toBe(true);
  });

  test('a transient failure during the pass changes nothing and is retried next time', async () => {
    activeSpace({ subscription: { expireTime: new Date(Date.now() + DAY).toISOString() } });
    g.fail('events.PATCH subscriptions/ID', httpError(503));

    const result = await pass();
    expect(result.pass).toMatchObject({ failed: 1 });
    expect(space().status).toBe('active');

    const retry = await pass();
    expect(retry.pass).toMatchObject({ renewed: 1 });
  });
});

// --- backfill --------------------------------------------------------------
describe('backfill', () => {
  test('interrupted part-way, it resumes from the saved page without duplicates', async () => {
    seedChat(7);
    db.addSpace(SPACE, { backfill_state: 'pending', subscription_name: g.addSubscription(SPACE) });
    // Page 2 onward fails for longer than the retry budget.
    g.listHook = (n) => { if (n >= 2 && n <= 5) throw httpError(503); };

    const first = await runBackfill(SPACE);
    expect(first).toMatchObject({ outcome: 'stopped', code: 'transient', pages: 1, stored: 2 });
    expect(space()).toMatchObject({ backfill_state: 'failed', backfill_page_token: 'page:2' });
    expect(db.messages.size).toBe(2);

    g.listHook = null;
    const tokensBefore = g.calls.filter(c => c.op === 'messages.list').length;
    await pass();

    const resumedCalls = g.calls.filter(c => c.op === 'messages.list').slice(tokensBefore);
    expect(resumedCalls[0].pageToken).toBe('page:2');
    expect(resumedCalls.some(c => c.pageToken === null)).toBe(false);
    expect(db.messages.size).toBe(7);
    expect(space()).toMatchObject({ backfill_state: 'done', backfill_page_token: null });
  });

  test('a stale saved page token restarts from what is stored — still no duplicates', async () => {
    seedChat(5);
    db.addSpace(SPACE, { backfill_state: 'failed', backfill_page_token: 'stale-token', subscription_name: g.addSubscription(SPACE) });
    for (const id of ['m1', 'm2']) {
      const m = g.messages.get(msgName(id));
      db.addMessage(msgName(id), { create_time: new Date(m.createTime), update_time: new Date(m.lastUpdateTime), text: m.text });
    }
    g.staleTokens.add('stale-token');

    const result = await runBackfill(SPACE);
    expect(result.outcome).toBe('done');
    expect(db.messages.size).toBe(5);
    expect(space().backfill_state).toBe('done');
  });

  test('private messages are skipped and counted', async () => {
    seedChat(2);
    g.addMessage(msgName('private'), { createTime: at(DAY), privateMessageViewer: { name: 'users/5' } });
    db.addSpace(SPACE, { backfill_state: 'pending', subscription_name: g.addSubscription(SPACE) });

    const result = await runBackfill(SPACE);
    expect(result).toMatchObject({ outcome: 'done', stored: 2, private: 1 });
    expect(db.messages.has(msgName('private'))).toBe(false);
  });

  test('a backfill stops if the space is paused mid-way, keeping its place', async () => {
    seedChat(6);
    db.addSpace(SPACE, { backfill_state: 'pending', subscription_name: g.addSubscription(SPACE) });
    g.listHook = (n) => { if (n === 2) db.spaces.get(SPACE).status = 'paused'; };

    const result = await runBackfill(SPACE);
    expect(result).toMatchObject({ outcome: 'stopped', code: 'space_not_active' });
    expect(space()).toMatchObject({ backfill_state: 'pending' });
    expect(space().backfill_page_token).not.toBeNull();
  });
});

// --- retention -------------------------------------------------------------
describe('retention', () => {
  test('deletes messages older than 12 months and tombstones older than 30 days', async () => {
    const now = new Date('2026-09-17T09:30:00Z');
    db.addSpace(SPACE);
    db.addMessage(msgName('old'), { create_time: new Date('2025-09-16T09:00:00Z') });
    db.addMessage(msgName('edge'), { create_time: new Date('2025-09-17T10:00:00Z') });
    db.addMessage(msgName('new'), { create_time: new Date('2026-09-01T00:00:00Z') });
    db.tombstones.set(msgName('t-old'), { message_name: msgName('t-old'), space_name: SPACE, deleted_at: new Date('2026-08-17T09:00:00Z') });
    db.tombstones.set(msgName('t-new'), { message_name: msgName('t-new'), space_name: SPACE, deleted_at: new Date('2026-08-19T00:00:00Z') });

    expect(await runRetention(now)).toEqual({ messages: 1, tombstones: 1 });
    expect([...db.messages.keys()].sort()).toEqual([msgName('edge'), msgName('new')]);
    expect([...db.tombstones.keys()]).toEqual([msgName('t-new')]);
    expect(logged()).toContain('Chat listen retention — messages deleted: 1, tombstones deleted: 1');
  });
});

// --- removal ---------------------------------------------------------------
describe('removal', () => {
  test('Oracle removed from the space: subscription deleted, copy deleted, later events ignored', async () => {
    const subscription = activeSpace();
    db.addMessage(msgName('m1'));
    db.addMessage(msgName('m2'));
    db.tombstones.set(msgName('t1'), { message_name: msgName('t1'), space_name: SPACE, deleted_at: new Date() });

    const res = await chatEvent('removedFromSpacePayload', { name: SPACE, type: 'ROOM', displayName: 'RTRI Changes' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({});

    await eventually(() => space()?.status === 'removed' && db.messages.size === 0 && !g.subscriptions.has(subscription));
    await subs.withSpaceLock(SPACE, () => {});
    expect(db.tombstones.size).toBe(0);
    expect(space().subscription_name).toBeNull();

    g.addMessage(msgName('late'));
    const push = mockRes();
    await handleChatEventsPush({
      headers: { authorization: 'Bearer push-token' },
      body: pushBody('google.workspace.chat.message.v1.created', { message: { name: msgName('late') } }, `//chat.googleapis.com/${SPACE}`)
    }, push);
    expect(push.statusCode).toBe(204);
    expect(db.messages.size).toBe(0);

    // And the hourly pass does not bring it back.
    await pass();
    expect(space().status).toBe('removed');
    expect(g.posts).toHaveLength(0);
  });

  test('removal while the listener is broken still deletes the copy; the subscription delete is retried', async () => {
    const subscription = activeSpace();
    db.addMessage(msgName('m1'));
    g.tokenRevoked = true;

    const result = await subs.teardownSpace(SPACE);
    expect(result).toMatchObject({ outcome: 'removed', subscription: 'listener_token_revoked', messages: 1 });
    expect(db.messages.size).toBe(0);
    expect(space().subscription_name).toBe(subscription);

    g.tokenRevoked = false;
    await pass();
    expect(g.subscriptions.has(subscription)).toBe(false);
    expect(space().subscription_name).toBeNull();
  });

  test('a space taken off the allowlist is torn down and forgotten', async () => {
    const subscription = g.addSubscription(OLD_SPACE);
    db.addSpace(OLD_SPACE, { subscription_name: subscription });
    db.addMessage(msgName('m1', OLD_SPACE));
    g.memberSpaces.add(OLD_SPACE);

    const result = await pass();
    expect(result.allowlist).toEqual({ added: 1, removed: 1 });
    expect(db.spaces.has(OLD_SPACE)).toBe(false);
    expect([...db.messages.values()].some(m => m.space_name === OLD_SPACE)).toBe(false);
    expect(g.subscriptions.has(subscription)).toBe(false);
  });

  test('Oracle re-added: one intro card, no second notice, and the copy restarts', async () => {
    db.addSpace(SPACE, { status: 'removed', notice_posted_at: new Date(Date.now() - 30 * DAY) });
    seedChat(3);

    const res = await chatEvent('addedToSpacePayload', { name: SPACE, type: 'ROOM', displayName: 'RTRI Changes' });
    expect(res.body).toEqual({});

    await eventually(() => space()?.status === 'active');
    await subs.withSpaceLock(SPACE, () => {});
    await whenIdle();

    // One message: the intro card. The listening pass that follows sees the
    // space has already been told and posts nothing more.
    expect(g.posts).toHaveLength(1);
    expect(postedTexts()[0]).toBe(INTRO);
    expect(space().notice_posted_at.getTime()).toBeGreaterThan(Date.now() - DAY);
    expect(g.subscriptions.size).toBe(1);
    expect(db.messages.size).toBe(3);
  });

  test('Oracle added to a space that is not listened: the intro card, nothing stored', async () => {
    const res = await chatEvent('addedToSpacePayload', { name: 'spaces/MARKETING', type: 'ROOM', displayName: 'Marketing' });
    expect(res.body).toEqual({});
    await eventually(() => g.posts.length === 1);

    expect(postedTexts()[0]).toBe(INTRO);
    expect(db.spaces.size).toBe(0);
    expect(g.eventsCalls('POST')).toHaveLength(0);
  });

  test('removed from a DM or a space never followed: nothing to do', async () => {
    await chatEvent('removedFromSpacePayload', { name: 'spaces/DM1', type: 'DM' });
    await chatEvent('removedFromSpacePayload', { name: 'spaces/NEVER', type: 'ROOM' });
    await new Promise(resolve => setImmediate(resolve));
    expect(db.spaces.size).toBe(0);
    expect(g.calls).toHaveLength(0);
  });
});

// --- jobs ------------------------------------------------------------------
describe('jobs', () => {
  test('two schedules, UTC, never overlapping — and one pass at start', async () => {
    const schedule = jest.fn();
    await startChatListen({ schedule });
    await whenIdle();
    expect(space().status).toBe('active');

    expect(schedule).toHaveBeenCalledTimes(2);
    expect(schedule.mock.calls.map(c => c[0])).toEqual(['17 * * * *', '30 9 * * *']);
    for (const [, fn, options] of schedule.mock.calls) {
      expect(typeof fn).toBe('function');
      expect(options).toMatchObject({ timezone: 'UTC', noOverlap: true });
    }
  });

  test('a failing job logs a code and does not throw', async () => {
    const schedule = jest.fn();
    process.env.CHAT_LISTEN_DISABLED = 'true';
    await startChatListen({ schedule });
    db.failWhen = () => true;

    const retention = schedule.mock.calls[1][1];
    await expect(retention()).resolves.toBeUndefined();
    expect(logged()).toContain('Chat listen retention failed — code: 57P01');
  });
});

// --- logs ------------------------------------------------------------------
describe('logs', () => {
  test('no message text, sender ids, names, emails or space ids — across a full cycle', async () => {
    seedChat(3);
    g.addMessage(msgName('x'), { text: SECRET_TEXT, sender: { name: SENDER, displayName: 'Stephanie Example', email: 'steph@granted.ca' } });
    await pass();
    g.tokenRevoked = true;
    await pass();
    g.tokenRevoked = false;
    await pass();
    await subs.teardownSpace(SPACE);

    const out = logged();
    expect(out).toContain('Chat listen pass');
    expect(out).toContain('Chat listen backfill done');
    expect(out).toContain('Chat listen teardown');
    for (const secret of [SECRET_TEXT, SENDER, 'Stephanie', 'steph@granted.ca', LISTENER_EMAIL]) {
      expect(out).not.toContain(secret);
    }
    // The listen code's own lines carry no ids either. (The existing Chat post
    // path logs the space it posts to; that line predates this code.)
    const listenLines = out.split('\n').filter(line => line.includes('Chat listen')).join('\n');
    for (const id of ['AAQAsvTWxwE', '/messages/', 'subscriptions/sub']) {
      expect(listenLines).not.toContain(id);
    }
  });
});
