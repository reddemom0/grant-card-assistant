/**
 * Quoted context kept across a thread: saving, replacing, loading it back,
 * the DM fallback, and refreshing a sweep card's files.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/quoted-context-store.test.js
 */

import { jest } from '@jest/globals';

const S = await import('../../src/services/quoted-context-store.js');
const { quotedContextBlock } = await import('../../src/services/quoted-message.js');

const CONV = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const DM = 'spaces/DM1';
const MSG = 'spaces/DM1/messages/abc.abc';
const FILE = { fileId: 'F1', name: 'Invoice 4.pdf', pathBefore: 'Granted Files/Clients/Acme', status: 'unsure' };
const QUOTE = { messageName: MSG, text: 'Not sure where Invoice 4.pdf goes', sentAt: new Date('2026-10-30T15:30:00Z'), readCode: null, files: [FILE] };

/** A fake quoted_contexts table: rows by conversation, with a clock for the DM window. */
function fakeDb({ now = Date.parse('2026-10-30T16:00:00Z') } = {}) {
  const rows = new Map();
  const calls = [];
  const runQuery = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/INSERT INTO quoted_contexts/.test(sql)) {
      const [conversation_id, space_name, quoted_message_name, context] = params;
      rows.set(conversation_id, { conversation_id, space_name, quoted_message_name, context: JSON.parse(context), updated_at: now });
      return { rows: [] };
    }
    if (/WHERE conversation_id = \$1/.test(sql)) return { rows: rows.has(params[0]) ? [rows.get(params[0])] : [] };
    if (/conversation_id <> \$2/.test(sql)) {
      const [space, conv, mins] = params;
      const hit = [...rows.values()]
        .filter(r => r.space_name === space && r.conversation_id !== conv && r.updated_at > now - mins * 60_000)
        .sort((a, b) => b.updated_at - a.updated_at)[0];
      return { rows: hit ? [hit] : [] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  return { rows, calls, runQuery };
}

const noFiles = jest.fn(async () => []);

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('saving', () => {
  test('stores the text, time and files, not the per-turn label', async () => {
    const db = fakeDb();
    expect(await S.saveQuotedContext({ conversationId: CONV, spaceName: DM, quotedMessage: QUOTE }, db.runQuery)).toBe(true);
    const row = db.rows.get(CONV);
    expect(row.quoted_message_name).toBe(MSG);
    expect(row.context).toEqual({ text: QUOTE.text, sentAt: '2026-10-30T15:30:00.000Z', files: [FILE] });
  });

  test('a newer quote in the same thread replaces the saved one', async () => {
    const db = fakeDb();
    await S.saveQuotedContext({ conversationId: CONV, spaceName: DM, quotedMessage: QUOTE }, db.runQuery);
    await S.saveQuotedContext({ conversationId: CONV, spaceName: DM, quotedMessage: { messageName: `${MSG}2`, text: 'Your deal is at Proposal.', files: [] } }, db.runQuery);
    expect(db.rows.size).toBe(1);
    expect(db.calls[1].sql).toMatch(/ON CONFLICT \(conversation_id\) DO UPDATE/);
    const q = await S.loadQuotedContext({ conversationId: CONV, spaceName: DM, isDm: true }, { runQuery: db.runQuery, findFiles: noFiles });
    expect(q.messageName).toBe(`${MSG}2`);
    expect(q.text).toBe('Your deal is at Proposal.');
    expect(q.files).toEqual([]);
  });

  test('nothing to save without a conversation, space or message name', async () => {
    const db = fakeDb();
    expect(await S.saveQuotedContext({ conversationId: null, spaceName: DM, quotedMessage: QUOTE }, db.runQuery)).toBe(false);
    expect(await S.saveQuotedContext({ conversationId: CONV, spaceName: DM, quotedMessage: { text: 'x' } }, db.runQuery)).toBe(false);
    expect(db.runQuery).not.toHaveBeenCalled();
  });

  test('a missing table is silent; other errors are logged with a code', async () => {
    const noTable = jest.fn(async () => { throw Object.assign(new Error('x'), { code: '42P01' }); });
    expect(await S.saveQuotedContext({ conversationId: CONV, spaceName: DM, quotedMessage: QUOTE }, noTable)).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
    const boom = jest.fn(async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }); });
    expect(await S.loadQuotedContext({ conversationId: CONV, spaceName: DM }, { runQuery: boom, findFiles: noFiles })).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('code: ECONNRESET'));
  });
});

describe('loading in the same thread', () => {
  test('comes back as this thread\'s quote, with its date revived', async () => {
    const db = fakeDb();
    await S.saveQuotedContext({ conversationId: CONV, spaceName: DM, quotedMessage: QUOTE }, db.runQuery);
    const q = await S.loadQuotedContext({ conversationId: CONV, spaceName: DM, isDm: true }, { runQuery: db.runQuery, findFiles: noFiles });
    expect(q.carried).toBe('thread');
    expect(q.sentAt).toBeInstanceOf(Date);
    expect(q.text).toBe(QUOTE.text);
    expect(q.files).toEqual([FILE]);
  });

  test('sweep files are re-read from the log so their status is current', async () => {
    const db = fakeDb();
    await S.saveQuotedContext({ conversationId: CONV, spaceName: DM, quotedMessage: QUOTE }, db.runQuery);
    const findFiles = jest.fn(async () => [{ ...FILE, status: 'confirmed' }]);
    const q = await S.loadQuotedContext({ conversationId: CONV, spaceName: DM }, { runQuery: db.runQuery, findFiles });
    expect(findFiles).toHaveBeenCalledWith({ spaceName: DM, messageName: MSG }, db.runQuery);
    expect(q.files[0].status).toBe('confirmed');
  });

  test('the saved files are kept when the re-read finds nothing', async () => {
    const db = fakeDb();
    await S.saveQuotedContext({ conversationId: CONV, spaceName: DM, quotedMessage: QUOTE }, db.runQuery);
    const q = await S.loadQuotedContext({ conversationId: CONV, spaceName: DM }, { runQuery: db.runQuery, findFiles: noFiles });
    expect(q.files).toEqual([FILE]);
  });

  test('no saved quote, not a DM → null', async () => {
    const db = fakeDb();
    await S.saveQuotedContext({ conversationId: OTHER, spaceName: 'spaces/ROOM', quotedMessage: QUOTE }, db.runQuery);
    expect(await S.loadQuotedContext({ conversationId: CONV, spaceName: 'spaces/ROOM', isDm: false }, { runQuery: db.runQuery, findFiles: noFiles })).toBeNull();
  });
});

describe('the DM fallback', () => {
  test('a new thread in the same DM picks up a quote from the last 30 minutes, labelled dm, and keeps it', async () => {
    const db = fakeDb();
    await S.saveQuotedContext({ conversationId: OTHER, spaceName: DM, quotedMessage: QUOTE }, db.runQuery);
    const q = await S.loadQuotedContext({ conversationId: CONV, spaceName: DM, isDm: true }, { runQuery: db.runQuery, findFiles: noFiles });
    expect(q.carried).toBe('dm');
    expect(q.files).toEqual([FILE]);
    // Copied to the new thread, still marked as a DM fallback.
    expect(db.rows.get(CONV).context.fromDm).toBe(true);
    const again = await S.loadQuotedContext({ conversationId: CONV, spaceName: DM, isDm: true }, { runQuery: db.runQuery, findFiles: noFiles });
    expect(again.carried).toBe('dm');
  });

  test('older than 30 minutes → nothing', async () => {
    const db = fakeDb();
    await S.saveQuotedContext({ conversationId: OTHER, spaceName: DM, quotedMessage: QUOTE }, db.runQuery);
    db.rows.get(OTHER).updated_at -= 31 * 60_000;
    expect(await S.loadQuotedContext({ conversationId: CONV, spaceName: DM, isDm: true }, { runQuery: db.runQuery, findFiles: noFiles })).toBeNull();
  });

  test('another DM\'s quote is never used', async () => {
    const db = fakeDb();
    await S.saveQuotedContext({ conversationId: OTHER, spaceName: 'spaces/DM2', quotedMessage: QUOTE }, db.runQuery);
    expect(await S.loadQuotedContext({ conversationId: CONV, spaceName: DM, isDm: true }, { runQuery: db.runQuery, findFiles: noFiles })).toBeNull();
  });

  test('the newest of several recent quotes wins', async () => {
    const db = fakeDb();
    await S.saveQuotedContext({ conversationId: OTHER, spaceName: DM, quotedMessage: QUOTE }, db.runQuery);
    db.rows.get(OTHER).updated_at -= 10 * 60_000;
    await S.saveQuotedContext({ conversationId: '33333333-3333-3333-3333-333333333333', spaceName: DM, quotedMessage: { ...QUOTE, messageName: `${MSG}new`, text: 'newer' } }, db.runQuery);
    const q = await S.loadQuotedContext({ conversationId: CONV, spaceName: DM, isDm: true }, { runQuery: db.runQuery, findFiles: noFiles });
    expect(q.text).toBe('newer');
  });
});

describe('the block on later turns', () => {
  test('this thread: "started from" heading, files still mean the user\'s file', () => {
    const text = quotedContextBlock({ ...QUOTE, carried: 'thread' });
    expect(text).toContain('## The message this conversation started from');
    expect(text).not.toContain('## The message the user is replying to');
    expect(text).toContain('this conversation started from it');
    expect(text).toContain('Invoice 4.pdf — Drive file ID: F1');
    expect(text).toContain('This is the file the user means');
  });

  test('DM fallback: same heading, but flagged as possibly unrelated', () => {
    const text = quotedContextBlock({ ...QUOTE, carried: 'dm' });
    expect(text).toContain('## The message this conversation started from');
    expect(text).toContain('In the last 30 minutes');
    expect(text).toContain('use it only if it fits');
    expect(text).toContain('If their new message is about this file');
    expect(text).not.toContain('This is the file the user means');
  });

  test('the first turn keeps its own heading', () => {
    expect(quotedContextBlock(QUOTE)).toContain('## The message the user is replying to');
  });

  test('the window in the wording matches the code', () => {
    expect(S.DM_FALLBACK_MINUTES).toBe(30);
  });
});
