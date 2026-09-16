/**
 * Tagged-thread digest
 *
 * This tool reads other people's messages and hands them to one person, so the
 * rules that matter are about who may ask, whose mentions count, and what is
 * excluded. All of them are enforced here rather than in the prompt.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/mention-digest.test.js
 */

import { jest } from '@jest/globals';

const ME = 'users/111';
const THEM = 'users/222';

// --- stubs -----------------------------------------------------------------
const mockQuery = jest.fn(async (sql) => {
  if (/SELECT chat_user_id/.test(sql)) return { rows: [{ chat_user_id: ME }] };
  return { rows: [] };
});
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: mockQuery, getPool: jest.fn(), transaction: jest.fn()
}));

jest.unstable_mockModule('../../src/tools/google-docs.js', () => ({
  getUserOAuth2Client: jest.fn(async () => ({
    getAccessToken: async () => ({ token: 'at' }),
    getTokenInfo: async () => ({ scopes: [] })
  })),
  getDocsClient: jest.fn(),
  getDriveClient: jest.fn()
}));

const mockHasChatScopes = jest.fn(async () => ({ ok: true, missing: [] }));
jest.unstable_mockModule('../../src/tools/chat-history.js', () => ({
  hasChatScopes: mockHasChatScopes,
  hubSignInUrl: () => 'https://hub.example/login',
  isInsufficientScopeError: (e) => /ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(String(e?.message || '')),
  threadLink: (s, t) => `https://chat.google.com/room/${String(s).split('/')[1]}/${String(t || '').split('/')[3] || ''}`,
  MESSAGES: {
    needsReconsent: (url) => `I need one more permission to read Chat history. Sign in again at the Hub: ${url} — it takes a few seconds.`,
    noContext: 'I can only read Chat history for a signed-in person in Chat or the Hub.'
  }
}));

const mockSpacesList = jest.fn();
const mockMessagesList = jest.fn();
jest.unstable_mockModule('googleapis', () => ({
  google: {
    chat: jest.fn(() => ({ spaces: { list: mockSpacesList, messages: { list: mockMessagesList } } }))
  }
}));

const { buildMentionDigest, resolvePeriod, DIGEST_MESSAGES } = await import('../../src/tools/mention-digest.js');

// --- fixtures --------------------------------------------------------------
const DM_CTX = { surface: 'chat_dm', senderChatId: ME };
const HUB_CTX = { surface: 'hub' };
const SPACE_CTX = { surface: 'chat_space', spaceName: 'spaces/AAA', spaceDisplayName: 'AI Hub', senderChatId: ME };

const space = (name, displayName, extra = {}) => ({ name, displayName, spaceType: 'SPACE', ...extra });

const message = ({ from = THEM, text = 'hello', mentions = [], thread = 'T1', minutesAgo = 60 }) => ({
  name: `${thread}/messages/M`,
  sender: { name: from, displayName: from === ME ? 'Me' : 'Stephanie' },
  createTime: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  text,
  thread: { name: `spaces/AAA/threads/${thread}` },
  annotations: mentions.map(u => ({ type: 'USER_MENTION', userMention: { type: 'MENTION', user: { name: u } } }))
});

const givenSpaces = (spaces) => mockSpacesList.mockResolvedValue({ data: { spaces, nextPageToken: null } });
const givenMessages = (messages) => mockMessagesList.mockResolvedValue({ data: { messages, nextPageToken: null } });

beforeEach(() => {
  jest.clearAllMocks();
  mockHasChatScopes.mockResolvedValue({ ok: true, missing: [] });
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT chat_user_id/.test(sql)) return { rows: [{ chat_user_id: ME }] };
    return { rows: [] };
  });
  givenSpaces([space('spaces/AAA', 'RTRI Changes')]);
  givenMessages([]);
});

// ---------------------------------------------------------------------------
describe('who may ask', () => {
  test('a shared space is refused — the digest is personal', async () => {
    const r = await buildMentionDigest({}, { userId: 1, chatContext: SPACE_CTX });

    expect(r.success).toBe(false);
    expect(r.error).toBe(DIGEST_MESSAGES.sharedSpace);
    expect(mockSpacesList).not.toHaveBeenCalled();   // nothing read at all
  });

  test('a DM is allowed', async () => {
    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });
    expect(r.success).toBe(true);
  });

  test('the Hub is allowed', async () => {
    const r = await buildMentionDigest({}, { userId: 1, chatContext: HUB_CTX });
    expect(r.success).toBe(true);
  });

  test('no surface context refuses', async () => {
    const r = await buildMentionDigest({}, { userId: 1 });
    expect(r.success).toBe(false);
  });

  test('the model cannot grant itself the surface through tool input', async () => {
    const r = await buildMentionDigest(
      { surface: 'hub', chatContext: HUB_CTX },
      { userId: 1, chatContext: SPACE_CTX }
    );
    expect(r.error).toBe(DIGEST_MESSAGES.sharedSpace);
  });

  test('missing Chat scopes asks for a re-sign-in and reads nothing', async () => {
    mockHasChatScopes.mockResolvedValue({ ok: false, missing: ['chat.messages.readonly'] });

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    expect(r.needs_reconsent).toBe(true);
    expect(r.error).toMatch(/Sign in again at the Hub/);
    expect(mockSpacesList).not.toHaveBeenCalled();
  });

  test('an unknown Chat account asks the person to message Oracle once', async () => {
    mockQuery.mockImplementation(async () => ({ rows: [{ chat_user_id: null }] }));

    const r = await buildMentionDigest({}, { userId: 1, chatContext: HUB_CTX });

    expect(r.error).toBe(DIGEST_MESSAGES.unknownChatUser);
  });

  test('in Chat, the id comes from the request and is remembered for the Hub', async () => {
    await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    const writes = mockQuery.mock.calls.filter(([sql]) => /UPDATE users SET chat_user_id/.test(sql));
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual([ME, 1]);
  });
});

describe('what counts as addressed to me', () => {
  test('an @mention of me in a space is included', async () => {
    givenMessages([message({ text: 'can you review this? @Me', mentions: [ME] })]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    expect(r.message_count).toBe(1);
    expect(r.threads[0].messages[0].text).toMatch(/review this/);
    expect(r.threads[0].where).toBe('RTRI Changes');
  });

  test('a message mentioning someone else is not mine', async () => {
    givenMessages([message({ text: 'over to you @Them', mentions: [THEM] })]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });
    expect(r.message_count).toBe(0);
  });

  test('@all is excluded — it is not a mention of me', async () => {
    givenMessages([
      message({ text: 'heads up @all', mentions: ['users/all'] }),
      message({ text: 'morning everyone', mentions: [] })
    ]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });
    expect(r.message_count).toBe(0);
  });

  test('my own messages are never action points, even when I tag myself', async () => {
    givenMessages([message({ from: ME, text: 'note to self @Me', mentions: [ME] })]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });
    expect(r.message_count).toBe(0);
  });

  test('in a one-to-one DM every message from the other person counts', async () => {
    givenSpaces([{ name: 'spaces/DDD', spaceType: 'DIRECT_MESSAGE' }]);
    givenMessages([
      message({ text: 'are we still on for Thursday?', mentions: [] }),
      message({ from: ME, text: 'yes', mentions: [] })
    ]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    expect(r.message_count).toBe(1);
    expect(r.threads[0].where).toMatch(/^DM with /);
  });

  test('in a GROUP dm, a message with no mention of me does not count', async () => {
    givenSpaces([{ name: 'spaces/GGG', displayName: 'Ops huddle', spaceType: 'GROUP_CHAT' }]);
    givenMessages([message({ text: 'general chatter', mentions: [] })]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });
    expect(r.message_count).toBe(0);
  });

  test("Oracle's own DM is skipped entirely", async () => {
    givenSpaces([
      { name: 'spaces/BOT', spaceType: 'DIRECT_MESSAGE', singleUserBotDm: true },
      space('spaces/AAA', 'RTRI Changes')
    ]);
    givenMessages([message({ text: 'hi @Me', mentions: [ME] })]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    expect(r.spaces_scanned).toBe(1);
    expect(mockMessagesList).toHaveBeenCalledTimes(1);
    expect(mockMessagesList).not.toHaveBeenCalledWith(expect.objectContaining({ parent: 'spaces/BOT' }));
  });
});

describe('replied', () => {
  test('true when I posted in that thread after the mention', async () => {
    givenMessages([
      message({ text: 'can you look? @Me', mentions: [ME], thread: 'T1', minutesAgo: 120 }),
      message({ from: ME, text: 'done', thread: 'T1', minutesAgo: 60 })
    ]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });
    expect(r.threads[0].replied).toBe(true);
  });

  test('false when my only message came BEFORE the mention', async () => {
    givenMessages([
      message({ from: ME, text: 'earlier note', thread: 'T1', minutesAgo: 180 }),
      message({ text: 'can you look? @Me', mentions: [ME], thread: 'T1', minutesAgo: 120 })
    ]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });
    expect(r.threads[0].replied).toBe(false);
  });

  test('a reply in a DIFFERENT thread does not count', async () => {
    givenMessages([
      message({ text: 'can you look? @Me', mentions: [ME], thread: 'T1', minutesAgo: 120 }),
      message({ from: ME, text: 'unrelated', thread: 'T2', minutesAgo: 30 })
    ]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });
    expect(r.threads[0].replied).toBe(false);
  });

  test('the result tells the model not to treat replied as settled', async () => {
    givenMessages([message({ text: 'ping @Me', mentions: [ME] })]);
    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    expect(r.guidance).toMatch(/does not prove the matter is closed/i);
    expect(r.guidance).toMatch(/do not mark anything still open with a ✅/i);
  });
});

describe('grouping and windows', () => {
  test('messages in one thread are grouped, oldest first', async () => {
    givenMessages([
      message({ text: 'second @Me', mentions: [ME], thread: 'T1', minutesAgo: 30 }),
      message({ text: 'first @Me', mentions: [ME], thread: 'T1', minutesAgo: 90 })
    ]);

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    expect(r.thread_count).toBe(1);
    expect(r.threads[0].messages.map(m => m.text)).toEqual(['first @Me', 'second @Me']);
  });

  test('defaults to the last 7 days', async () => {
    await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    const { filter } = mockMessagesList.mock.calls[0][0];
    const since = new Date(filter.match(/create_time > "([^"]+)"/)[1]);
    const days = (Date.now() - since.getTime()) / 86400000;

    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  test('"yesterday" becomes one whole local day, not the last 24 hours', async () => {
    const { since, until } = resolvePeriod('yesterday');

    expect(until).not.toBeNull();
    const hours = (until - since) / 3600000;
    expect(hours).toBeGreaterThanOrEqual(23);   // 23 or 25 across a DST change
    expect(hours).toBeLessThanOrEqual(25);
    expect(until.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('"today" starts at local midnight and has no end', async () => {
    const { since, until } = resolvePeriod('today');
    expect(until).toBeNull();
    expect(since.getTime()).toBeLessThanOrEqual(Date.now());
    expect((Date.now() - since.getTime()) / 3600000).toBeLessThan(25);
  });

  test('an explicit since/until wins over period', async () => {
    await buildMentionDigest(
      { period: 'yesterday', since: '2026-01-01T00:00:00Z', until: '2026-01-05T00:00:00Z' },
      { userId: 1, chatContext: DM_CTX }
    );

    const { filter } = mockMessagesList.mock.calls[0][0];
    expect(filter).toContain('2026-01-01T00:00:00.000Z');
    expect(filter).toContain('2026-01-05T00:00:00.000Z');
  });

  test('the window reports the timezone it used', async () => {
    const r = await buildMentionDigest({ period: 'yesterday' }, { userId: 1, chatContext: DM_CTX });
    expect(r.window.timezone).toBe('America/Vancouver');
    expect(r.window.described_as).toBe('yesterday');
  });
});

describe('caps', () => {
  test('too many messages is flagged', async () => {
    givenMessages(Array.from({ length: 600 }, (_, i) =>
      message({ text: `ping ${i} @Me`, mentions: [ME], thread: `T${i}` })));

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    expect(r.truncated).toBe(true);
    expect(r.truncation_note).toMatch(/may be incomplete/i);
  });

  test('too many spaces is flagged, and the rest are not scanned', async () => {
    givenSpaces(Array.from({ length: 42 }, (_, i) => space(`spaces/S${i}`, `Space ${i}`)));

    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    expect(r.spaces_scanned).toBe(30);
    expect(r.spaces_skipped).toBe(12);
    expect(r.spaces_skipped_note).toMatch(/not scanned/i);
    expect(mockMessagesList).toHaveBeenCalledTimes(30);
  });

  test('an ordinary digest is not flagged', async () => {
    givenMessages([message({ text: 'ping @Me', mentions: [ME] })]);
    const r = await buildMentionDigest({}, { userId: 1, chatContext: DM_CTX });

    expect(r.truncated).toBeUndefined();
    expect(r.spaces_skipped).toBeUndefined();
  });
});
