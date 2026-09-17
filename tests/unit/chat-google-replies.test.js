/**
 * Replies for a Chat message Oracle does not run on
 *
 * This deployment parses the synchronous response body as RenderActions, so a
 * { text } body renders nothing and the user gets silence. Every path that
 * declines a message must ack with an empty body and post the reply through the
 * Chat API instead. These tests drive the real handler with the Chat client
 * stubbed and check what it posts.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/chat-google-replies.test.js
 */

import { jest } from '@jest/globals';

const ISSUER = 'addon@example.iam.gserviceaccount.com';
const SENDER = 'person@granted.ca';
const MESSAGE_TEXT = 'what changed in RTRI eligibility?';

process.env.GOOGLE_CHAT_AUDIENCE = 'https://hub.example/api/chat/google';
process.env.GOOGLE_CHAT_ISSUER_EMAIL = ISSUER;
process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{}';
process.env.PUBLIC_URL = 'https://hub.example';

// --- stubs -----------------------------------------------------------------
// Everything that happens, in order, so a test can prove the ack came first.
const timeline = [];

const mockCreate = jest.fn(async (req) => {
  timeline.push('post');
  return { data: {} };
});
jest.unstable_mockModule('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        async verifyIdToken() {
          return { getPayload: () => ({ email_verified: true, email: ISSUER }) };
        }
      },
      GoogleAuth: class {}
    },
    chat: jest.fn(() => ({ spaces: { messages: { create: mockCreate } } }))
  }
}));

const mockQuery = jest.fn();
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: mockQuery, getPool: jest.fn(), transaction: jest.fn()
}));

jest.unstable_mockModule('../../src/tools/google-docs.js', () => ({
  getUserOAuth2Client: jest.fn(),
  getDocsClient: jest.fn(),
  getDriveClient: jest.fn()
}));

const mockRunAgent = jest.fn(async () => ({
  success: true,
  response: { content: [{ type: 'text', text: 'Here is the answer.' }] }
}));
jest.unstable_mockModule('../../src/claude/client.js', () => ({ runAgent: mockRunAgent }));

jest.unstable_mockModule('../../src/database/messages.js', () => ({
  createConversation: jest.fn(async () => {}),
  saveMessage: jest.fn(async () => {})
}));

jest.unstable_mockModule('../../src/api/confirmation.js', () => ({
  tryHandleConfirmation: jest.fn(async () => null),
  currentPendingId: jest.fn(async () => null),
  proposalNotice: jest.fn(async () => null)
}));

const { handleGoogleChatEvent, NOT_RUN_REPLIES } = await import('../../src/api/chat-google.js');
const { hubSignInUrl } = await import('../../src/tools/chat-history.js');

// --- fixtures --------------------------------------------------------------
const SIGN_IN = NOT_RUN_REPLIES.signIn('https://hub.example/login');
const TRY_AGAIN = NOT_RUN_REPLIES.tryAgain;

const KNOWN_USER = { id: 7, email: SENDER, name: 'Person', is_active: true, google_refresh_token: 'rt' };

const THREAD = 'spaces/SSS/threads/TTT';

/** A message event in the add-on wire shape. */
function chatBody({ thread = THREAD, space = { name: 'spaces/SSS', displayName: 'AI Hub', type: 'ROOM' } } = {}) {
  return {
    chat: {
      messagePayload: {
        message: {
          text: MESSAGE_TEXT,
          sender: { email: SENDER, type: 'HUMAN', name: 'users/111' },
          ...(thread ? { thread: { name: thread } } : {})
        },
        ...(space ? { space } : {})
      }
    }
  };
}

const IN_THREAD_SPACE = chatBody();
const DM_NO_THREAD = chatBody({ thread: null, space: { name: 'spaces/DDD', type: 'DM' } });
const NO_THREAD_NO_SPACE = chatBody({ thread: null, space: null });

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => { timeline.push('ack'); return res; });
  return res;
}

async function send(body) {
  const res = mockRes();
  await handleGoogleChatEvent({ headers: { authorization: 'Bearer token' }, body }, res);
  // The reply is posted after the handler returns; let the background task run.
  await new Promise(resolve => setImmediate(resolve));
  return res;
}

const lookupFails = () => mockQuery.mockImplementation(async () => {
  const err = new Error(`connection lost while looking up ${SENDER}`);
  err.code = 'ECONNRESET';
  throw err;
});
const noSuchUser = () => mockQuery.mockImplementation(async () => ({ rows: [] }));
const userWithoutTokens = () => mockQuery.mockImplementation(async () => ({
  rows: [{ ...KNOWN_USER, google_refresh_token: null }]
}));
const knownUser = () => mockQuery.mockImplementation(async () => ({ rows: [KNOWN_USER] }));

/** Everything the handler wrote to the console, as one string. */
const logged = () => [console.log, console.warn, console.error]
  .flatMap(fn => fn.mock.calls)
  .map(args => args.map(a => (a instanceof Error ? a.message : String(a))).join(' '))
  .join('\n');

const postedTexts = () => mockCreate.mock.calls.map(([req]) => req.requestBody.text);

beforeEach(() => {
  jest.clearAllMocks();
  timeline.length = 0;
  mockCreate.mockImplementation(async () => { timeline.push('post'); return { data: {} }; });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// --- the four paths --------------------------------------------------------
describe('each declined message is answered asynchronously', () => {
  test.each([
    ['identity lookup fails', lookupFails, TRY_AGAIN],
    ['sender is not a known active user', noSuchUser, SIGN_IN],
    ['user has no stored Google tokens', userWithoutTokens, SIGN_IN]
  ])('%s → empty ack, then the right reply is posted', async (_label, given, expected) => {
    given();
    const res = await send(IN_THREAD_SPACE);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0]).toEqual({});
    expect(timeline).toEqual(['ack', 'post']);
    expect(postedTexts()).toEqual([expected]);
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  test('no conversation id → empty ack, and the reply is attempted without crashing', async () => {
    // An event with neither a thread nor a space has no parent to post under, so
    // the real Chat API rejects the post. It must still ack with an empty body
    // and the failure must stay inside safePost.
    knownUser();
    mockCreate.mockImplementation(async (req) => {
      timeline.push('post');
      if (!req.parent) throw new Error('Requested entity was not found.');
      return { data: {} };
    });

    const res = await send(NO_THREAD_NO_SPACE);

    expect(res.json.mock.calls[0][0]).toEqual({});
    expect(timeline).toEqual(['ack', 'post']);
    expect(postedTexts()).toEqual([TRY_AGAIN]);
    expect(mockRunAgent).not.toHaveBeenCalled();
    expect(logged()).toContain('reason: no_conversation_id');
    expect(logged()).toContain('user received nothing');
  });

  test('the sign-in link comes from the same source as the re-consent message', () => {
    expect(hubSignInUrl()).toBe('https://hub.example/login');
    expect(SIGN_IN).toBe(
      "I don't recognize your account yet. Sign in once at https://hub.example/login, then message me again."
    );
  });

  test('a known user with tokens is not declined', async () => {
    knownUser();
    const res = await send(IN_THREAD_SPACE);

    expect(res.json.mock.calls[0][0]).toEqual({});
    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    expect(postedTexts()).toEqual(['Here is the answer.']);
  });
});

// --- where the reply lands -------------------------------------------------
describe('threaded and non-threaded posting', () => {
  test.each([
    ['identity lookup fails', lookupFails, TRY_AGAIN],
    ['unknown sender', noSuchUser, SIGN_IN],
    ['missing tokens', userWithoutTokens, SIGN_IN]
  ])('%s: a message in a thread gets a reply in that thread', async (_label, given, expected) => {
    given();
    await send(IN_THREAD_SPACE);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [req] = mockCreate.mock.calls[0];
    expect(req.parent).toBe('spaces/SSS');
    expect(req.messageReplyOption).toBe('REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD');
    expect(req.requestBody.thread).toEqual({ name: THREAD });
    expect(req.requestBody.text).toBe(expected);
  });

  test.each([
    ['identity lookup fails', lookupFails, TRY_AGAIN],
    ['unknown sender', noSuchUser, SIGN_IN],
    ['missing tokens', userWithoutTokens, SIGN_IN]
  ])('%s: a message with no thread gets a new top-level message', async (_label, given, expected) => {
    given();
    await send(DM_NO_THREAD);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [req] = mockCreate.mock.calls[0];
    expect(req.parent).toBe('spaces/DDD');
    expect('messageReplyOption' in req).toBe(false);
    expect('thread' in req.requestBody).toBe(false);
    expect(req.requestBody.text).toBe(expected);
  });
});

// --- what the reply and the log reveal -------------------------------------
describe('disclosure', () => {
  test('an unknown sender gets the same reply in a space and in a DM', async () => {
    noSuchUser();
    await send(IN_THREAD_SPACE);
    await send(DM_NO_THREAD);

    expect(postedTexts()).toEqual([SIGN_IN, SIGN_IN]);
  });

  test('an unknown sender and a tokenless user cannot be told apart', async () => {
    noSuchUser();
    await send(IN_THREAD_SPACE);
    userWithoutTokens();
    await send(IN_THREAD_SPACE);

    const [a, b] = postedTexts();
    expect(a).toBe(b);
  });

  test('no reply echoes the sender\'s email', async () => {
    for (const given of [lookupFails, noSuchUser, userWithoutTokens]) {
      given();
      await send(IN_THREAD_SPACE);
    }
    for (const text of postedTexts()) {
      expect(text).not.toContain(SENDER);
    }
  });

  test.each([
    ['identity lookup fails', lookupFails, IN_THREAD_SPACE, 'identity_lookup_failed (ECONNRESET)'],
    ['unknown sender', noSuchUser, IN_THREAD_SPACE, 'unknown_sender'],
    ['missing tokens', userWithoutTokens, IN_THREAD_SPACE, 'missing_google_tokens'],
    ['no conversation id', knownUser, NO_THREAD_NO_SPACE, 'no_conversation_id']
  ])('%s: the log names the reason and nothing personal', async (_label, given, body, reason) => {
    given();
    await send(body);

    const out = logged();
    expect(out).toContain(`reason: ${reason}`);
    expect(out).not.toContain(SENDER);
    expect(out).not.toContain(MESSAGE_TEXT);
  });
});
