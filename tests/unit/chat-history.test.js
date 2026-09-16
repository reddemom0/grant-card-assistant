/**
 * Chat space history recall
 *
 * The rules that matter here are privacy rules, and they are enforced in code
 * precisely because a prompt cannot be relied on: content from one space must
 * not surface in another, and Oracle must never read as itself.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/chat-history.test.js
 */

import { jest } from '@jest/globals';

// --- stubs -----------------------------------------------------------------
const mockQuery = jest.fn();
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: mockQuery, getPool: jest.fn(), transaction: jest.fn()
}));

const mockGetTokenInfo = jest.fn(async () => ({ scopes: [] }));
const mockOAuthClient = {
  getAccessToken: async () => ({ token: 'at' }),
  getTokenInfo: mockGetTokenInfo
};
jest.unstable_mockModule('../../src/tools/google-docs.js', () => ({
  getUserOAuth2Client: jest.fn(async () => mockOAuthClient),
  getDocsClient: jest.fn(),
  getDriveClient: jest.fn()
}));

const mockSpacesList = jest.fn();
const mockMessagesList = jest.fn();
jest.unstable_mockModule('googleapis', () => ({
  google: {
    chat: jest.fn(() => ({
      spaces: { list: mockSpacesList, messages: { list: mockMessagesList } }
    }))
  }
}));

const {
  readChatSpaceHistory, hasChatScopes, stemWord, queryStems, matchesQuery, MESSAGES
} = await import('../../src/tools/chat-history.js');

// --- helpers ---------------------------------------------------------------
const ALL_SCOPES = 'profile email https://www.googleapis.com/auth/chat.messages.readonly https://www.googleapis.com/auth/chat.spaces.readonly';

const withScopes = (scopes = ALL_SCOPES) =>
  mockQuery.mockResolvedValue({ rows: [{ google_granted_scopes: scopes }] });

const msg = (text, i = 0) => ({
  sender: { displayName: 'Jorge' },
  createTime: new Date(Date.now() - i * 3600000).toISOString(),
  text,
  thread: { name: 'spaces/AAA/threads/T1' }
});

const messagesPage = (messages) => ({ data: { messages, nextPageToken: null } });

const SPACE_CTX = { surface: 'chat_space', spaceName: 'spaces/AAA', spaceDisplayName: 'RTRI Changes' };
const DM_CTX = { surface: 'chat_dm', spaceName: 'spaces/DDD', spaceDisplayName: null };
const HUB_CTX = { surface: 'hub' };

beforeEach(() => {
  jest.clearAllMocks();
  mockMessagesList.mockResolvedValue(messagesPage([msg('anything')]));
  mockSpacesList.mockResolvedValue({ data: { spaces: [], nextPageToken: null } });
});

// ---------------------------------------------------------------------------
describe('scopes and lazy re-consent', () => {
  test('a user without the Chat scopes is asked to sign in again', async () => {
    withScopes('profile email https://www.googleapis.com/auth/drive.file');

    const r = await readChatSpaceHistory({}, { userId: 1, chatContext: SPACE_CTX });

    expect(r.success).toBe(false);
    expect(r.needs_reconsent).toBe(true);
    expect(r.error).toMatch(/I need one more permission to read Chat history/);
    expect(r.error).toMatch(/\/login/);
    expect(mockMessagesList).not.toHaveBeenCalled();   // nothing was read
  });

  test('unknown scopes are resolved once against Google, not assumed missing', async () => {
    // A user who last signed in before the column existed.
    mockQuery.mockResolvedValueOnce({ rows: [{ google_granted_scopes: null }] });
    mockGetTokenInfo.mockResolvedValueOnce({ scopes: ALL_SCOPES.split(' ') });
    mockQuery.mockResolvedValue({ rows: [] });   // the backfill UPDATE

    const check = await hasChatScopes(1);

    expect(check.ok).toBe(true);
    expect(mockGetTokenInfo).toHaveBeenCalled();
    // and the answer is written back
    const updates = mockQuery.mock.calls.filter(([sql]) => /UPDATE users SET google_granted_scopes/.test(sql));
    expect(updates).toHaveLength(1);
  });

  test('a mid-call 403 for insufficient scope also asks for re-sign-in', async () => {
    withScopes();
    const err = new Error('Request had insufficient authentication scopes. ACCESS_TOKEN_SCOPE_INSUFFICIENT');
    err.code = 403;
    mockMessagesList.mockRejectedValueOnce(err);

    const r = await readChatSpaceHistory({}, { userId: 1, chatContext: SPACE_CTX });
    expect(r.needs_reconsent).toBe(true);
  });
});

describe('surface rules', () => {
  test('in a shared space, reading that space is allowed', async () => {
    withScopes();
    const r = await readChatSpaceHistory({ }, { userId: 1, chatContext: SPACE_CTX });

    expect(r.success).toBe(true);
    expect(mockMessagesList).toHaveBeenCalledWith(expect.objectContaining({ parent: 'spaces/AAA' }));
  });

  test('naming the current space by display name is still the current space', async () => {
    withScopes();
    const r = await readChatSpaceHistory({ space: 'rtri changes' }, { userId: 1, chatContext: SPACE_CTX });
    expect(r.success).toBe(true);
  });

  test('in a shared space, reading ANOTHER space is refused', async () => {
    withScopes();
    const r = await readChatSpaceHistory({ space: 'Marketing' }, { userId: 1, chatContext: SPACE_CTX });

    expect(r.success).toBe(false);
    expect(r.error).toBe(MESSAGES.otherSpace);
    expect(mockMessagesList).not.toHaveBeenCalled();
    expect(mockSpacesList).not.toHaveBeenCalled();   // not even looked up
  });

  test('in a DM, another space is allowed when the asker is a member', async () => {
    withScopes();
    mockSpacesList.mockResolvedValue({ data: { spaces: [{ name: 'spaces/BBB', displayName: 'Marketing' }] } });

    const r = await readChatSpaceHistory({ space: 'Marketing' }, { userId: 1, chatContext: DM_CTX });

    expect(r.success).toBe(true);
    expect(mockMessagesList).toHaveBeenCalledWith(expect.objectContaining({ parent: 'spaces/BBB' }));
  });

  test('from the Hub, another space is allowed too', async () => {
    withScopes();
    mockSpacesList.mockResolvedValue({ data: { spaces: [{ name: 'spaces/BBB', displayName: 'Marketing' }] } });

    const r = await readChatSpaceHistory({ space: 'Marketing' }, { userId: 1, chatContext: HUB_CTX });
    expect(r.success).toBe(true);
  });

  test('a space the asker is not in gives only the membership sentence', async () => {
    withScopes();
    mockSpacesList.mockResolvedValue({ data: { spaces: [{ name: 'spaces/BBB', displayName: 'Marketing' }] } });

    const r = await readChatSpaceHistory({ space: 'Leadership' }, { userId: 1, chatContext: HUB_CTX });

    expect(r.error).toBe(MESSAGES.notAMember);
    expect(JSON.stringify(r)).not.toMatch(/Leadership.*exists|not found/i);   // no extra detail
  });

  test("a permission error from Google says the same, and nothing more", async () => {
    withScopes();
    const err = new Error('Permission denied on resource'); err.code = 403;
    mockMessagesList.mockRejectedValueOnce(err);

    const r = await readChatSpaceHistory({}, { userId: 1, chatContext: SPACE_CTX });
    expect(r.error).toBe(MESSAGES.notAMember);
    expect(r.detail).toBeUndefined();
  });

  test('no surface context at all (webhook, scripts) refuses', async () => {
    withScopes();
    for (const ctx of [{ userId: 1 }, { userId: 1, chatContext: { surface: 'none' } }, { chatContext: SPACE_CTX }]) {
      const r = await readChatSpaceHistory({}, ctx);
      expect(r.success).toBe(false);
      expect(r.error).toBe(MESSAGES.noContext);
    }
  });

  test('the model cannot supply the surface or the space id through tool input', async () => {
    withScopes();
    // Every shape a model might try, while actually in a shared space.
    const r = await readChatSpaceHistory(
      { space: 'Marketing', surface: 'hub', chatContext: HUB_CTX, spaceName: 'spaces/BBB' },
      { userId: 1, chatContext: SPACE_CTX }
    );

    expect(r.error).toBe(MESSAGES.otherSpace);   // still bound to the real space
  });

  test('in a DM with no space named, it asks which', async () => {
    withScopes();
    const r = await readChatSpaceHistory({}, { userId: 1, chatContext: DM_CTX });
    expect(r.error).toBe(MESSAGES.noSpace);
  });
});

describe('window and cap', () => {
  test('defaults to a 30-day window', async () => {
    withScopes();
    await readChatSpaceHistory({}, { userId: 1, chatContext: SPACE_CTX });

    const { filter } = mockMessagesList.mock.calls[0][0];
    const since = new Date(filter.match(/create_time > "([^"]+)"/)[1]);
    const days = (Date.now() - since.getTime()) / 86400000;

    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(filter).not.toMatch(/create_time </);
  });

  test('an explicit window is used as given', async () => {
    withScopes();
    await readChatSpaceHistory(
      { since: '2026-01-01T00:00:00Z', until: '2026-02-01T00:00:00Z' },
      { userId: 1, chatContext: SPACE_CTX }
    );

    const { filter } = mockMessagesList.mock.calls[0][0];
    expect(filter).toContain('create_time > "2026-01-01T00:00:00.000Z"');
    expect(filter).toContain('create_time < "2026-02-01T00:00:00.000Z"');
  });

  test('hitting the cap is flagged so the model can say so', async () => {
    withScopes();
    const many = Array.from({ length: 600 }, (_, i) => msg(`message ${i}`, i));
    mockMessagesList.mockResolvedValue({ data: { messages: many, nextPageToken: null } });

    const r = await readChatSpaceHistory({}, { userId: 1, chatContext: SPACE_CTX });

    expect(r.count).toBe(500);
    expect(r.truncated).toBe(true);
    expect(r.truncation_note).toMatch(/older messages you did not see/i);
  });

  test('a normal window is not flagged as truncated', async () => {
    withScopes();
    mockMessagesList.mockResolvedValue(messagesPage(Array.from({ length: 10 }, (_, i) => msg(`m${i}`, i))));

    const r = await readChatSpaceHistory({}, { userId: 1, chatContext: SPACE_CTX });
    expect(r.truncated).toBeUndefined();
  });

  test('each message carries sender, time, text and a thread link — and no more', async () => {
    withScopes();
    const r = await readChatSpaceHistory({}, { userId: 1, chatContext: SPACE_CTX });

    expect(Object.keys(r.messages[0]).sort()).toEqual(['sender', 'text', 'thread_link', 'time']);
    expect(r.messages[0].thread_link).toContain('chat.google.com/room/AAA');
  });
});

describe('loose topic matching', () => {
  test('a word and its relatives reduce to a shared stem', () => {
    // The exact stem does not matter; that relatives collapse to the SAME one,
    // and that it stays a prefix of each, is the whole point.
    for (const family of [
      ['eligibility', 'eligible'],
      ['changes', 'changed', 'changing'],
      ['submission', 'submissions'],
      ['budget', 'budgets']
    ]) {
      const stems = family.map(stemWord);
      expect(new Set(stems).size).toBe(1);
      for (const word of family) expect(word.startsWith(stems[0])).toBe(true);
    }
  });

  test('question framing is dropped, the topic survives', () => {
    expect(queryStems('what did we say about the eligibility changes'))
      .toEqual([stemWord('eligibility'), stemWord('changes')]);
    expect(queryStems('what was discussed recently')).toEqual([]);   // no topic at all
  });

  test('a query that is all framing filters nothing, rather than nothing matching', async () => {
    withScopes();
    mockMessagesList.mockResolvedValue(messagesPage(Array.from({ length: 5 }, (_, i) => msg(`m${i}`, i))));

    const r = await readChatSpaceHistory({ query: 'what was discussed' }, { userId: 1, chatContext: SPACE_CTX });
    expect(r.count).toBe(5);
  });

  test('matching is case-insensitive and hits partial words', () => {
    const stems = queryStems('eligibility');
    expect(matchesQuery('The ELIGIBLE list moved', stems)).toBe(true);
    expect(matchesQuery('eligibility criteria', stems)).toBe(true);
    expect(matchesQuery('nothing relevant here', stems)).toBe(false);
  });

  test('an empty query matches everything', () => {
    expect(matchesQuery('anything at all', queryStems(''))).toBe(true);
  });

  test('a query with enough matches returns just those', async () => {
    withScopes();
    const messages = [
      ...Array.from({ length: 25 }, (_, i) => msg(`eligibility point ${i}`, i)),
      ...Array.from({ length: 40 }, (_, i) => msg(`unrelated chatter ${i}`, i + 25))
    ];
    mockMessagesList.mockResolvedValue(messagesPage(messages));

    const r = await readChatSpaceHistory({ query: 'eligibility' }, { userId: 1, chatContext: SPACE_CTX });

    expect(r.filtered).toBe(true);
    expect(r.count).toBe(25);
    expect(r.filter_note).toBeUndefined();
  });

  test('too few matches returns the whole window, flagged unfiltered', async () => {
    withScopes();
    const messages = [
      ...Array.from({ length: 3 }, (_, i) => msg(`eligibility point ${i}`, i)),
      ...Array.from({ length: 40 }, (_, i) => msg(`unrelated chatter ${i}`, i + 3))
    ];
    mockMessagesList.mockResolvedValue(messagesPage(messages));

    const r = await readChatSpaceHistory({ query: 'eligibility' }, { userId: 1, chatContext: SPACE_CTX });

    expect(r.filtered).toBe(false);
    expect(r.count).toBe(43);                       // everything, not the 3
    expect(r.filter_note).toMatch(/left only 3 message/);
    expect(r.filter_note).toMatch(/judge relevance yourself/);
  });
});
