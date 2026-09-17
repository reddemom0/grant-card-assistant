/**
 * The stored Chat copy's SQL, against a real Postgres
 *
 * The unit tests run the store's statements against an in-memory fake. This file
 * runs migration 029 and the real statements, so the guards that matter —
 * tombstones, the update-time check, no writes to removed spaces, atomic
 * backfill pages, retention — are proven in SQL, not just in the fake.
 *
 * SKIPPED unless CHAT_LISTEN_TEST_DATABASE_URL is set, and it refuses anything
 * that is not a loopback host. It creates and drops its own tables; point it at
 * a throwaway database only, e.g.:
 *
 *   initdb -D /path/pg -U postgres --auth=trust
 *   pg_ctl -D /path/pg -o "-p 54329 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start
 *   CHAT_LISTEN_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres \
 *     NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/chat-listen-store.test.js
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const url = process.env.CHAT_LISTEN_TEST_DATABASE_URL;
const loopback = (() => {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
})();
const run = url && loopback ? describe : describe.skip;

if (url && !loopback) {
  // eslint-disable-next-line no-console
  console.warn('CHAT_LISTEN_TEST_DATABASE_URL is not a loopback address — refusing to run.');
}
if (url && loopback) {
  process.env.DATABASE_URL = url;
  delete process.env.POSTGRES_URL;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(__dirname, '../../migrations/029_chat_listen.sql'), 'utf8');

const SPACE = 'spaces/INTEGRATION';
const OTHER = 'spaces/OTHER';
const SECRET = 'SENTINEL-integration-secret';
const DAY = 864e5;

let store;
let db;

const row = (id, fields = {}) => ({
  message_name: `${SPACE}/messages/${id}`,
  space_name: SPACE,
  thread_name: `${SPACE}/threads/t`,
  sender_user_id: 'users/1',
  create_time: '2026-09-01T10:00:00Z',
  update_time: '2026-09-01T10:00:00Z',
  text: `text ${id}`,
  ...fields
});

const stored = async (id) =>
  (await db.query('SELECT * FROM chat_space_messages WHERE message_name = $1', [`${SPACE}/messages/${id}`])).rows[0];
const spaceRow = async (name = SPACE) =>
  (await db.query('SELECT * FROM chat_listen_spaces WHERE space_name = $1', [name])).rows[0];

run('chat listen store (real Postgres)', () => {
  // The pool logs connects and removals; keep that out of the test output.
  let poolLog;

  beforeAll(async () => {
    poolLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    db = await import('../../src/database/connection.js');
    store = await import('../../src/database/chat-listen-store.js');
    const pool = db.getPool();
    await pool.query('DROP TABLE IF EXISTS chat_message_tombstones, chat_space_messages, chat_listen_spaces');
    await pool.query(MIGRATION);
    await pool.query(MIGRATION); // safe to re-run
  });

  afterAll(async () => {
    const pool = db.getPool();
    await pool.query('DROP TABLE IF EXISTS chat_message_tombstones, chat_space_messages, chat_listen_spaces');
    await db.closePool();
    await new Promise(resolve => setTimeout(resolve, 50));
    poolLog.mockRestore();
  });

  let logSpies;
  const logged = () => logSpies.flatMap(s => s.mock.calls).map(a => a.join(' ')).join('\n');

  beforeEach(async () => {
    logSpies = ['warn', 'error', 'log'].map(level => jest.spyOn(console, level).mockImplementation(() => {}));
    await db.getPool().query('TRUNCATE chat_message_tombstones, chat_space_messages, chat_listen_spaces');
    await store.startListenSpace({ spaceName: SPACE, label: 'Integration', since: new Date(Date.now() - 365 * DAY) });
    await store.setSpaceActive(SPACE);
  });

  afterEach(() => logSpies.forEach(s => s.mockRestore()));

  test('the migration created three tables with their constraints', async () => {
    const r = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN ('chat_listen_spaces', 'chat_space_messages', 'chat_message_tombstones')
       ORDER BY table_name`
    );
    expect(r.rows.map(x => x.table_name)).toEqual(['chat_listen_spaces', 'chat_message_tombstones', 'chat_space_messages']);
  });

  test('startListenSpace: new rows start paused; live rows are untouched; removed rows restart', async () => {
    expect(await spaceRow()).toMatchObject({ status: 'active', backfill_state: 'pending', notice_posted_at: null });

    await store.markNoticePosted(SPACE);
    await store.startListenSpace({ spaceName: SPACE, label: 'Changed', since: new Date() });
    expect(await spaceRow()).toMatchObject({ status: 'active', label: 'Integration' });

    await store.saveSubscription(SPACE, { name: 'subscriptions/s1', expireTime: new Date().toISOString(), state: 'ACTIVE' });
    await store.setSpaceRemoved(SPACE);
    await store.startListenSpace({ spaceName: SPACE, label: 'Again', since: new Date(), noticePosted: true });
    const restarted = await spaceRow();
    expect(restarted).toMatchObject({
      status: 'paused', pause_reason: 'not_started', label: 'Again',
      subscription_name: null, backfill_state: 'pending', backfill_page_token: null
    });
    expect(restarted.notice_posted_at).not.toBeNull();
  });

  test('pause keeps the first pause time; active clears it; removed is final for both', async () => {
    await store.setSpacePaused(SPACE, 'listener_token_revoked');
    const first = (await spaceRow()).paused_at;
    await new Promise(r => setTimeout(r, 20));
    await store.setSpacePaused(SPACE, 'listener_not_member');
    expect(await spaceRow()).toMatchObject({ status: 'paused', pause_reason: 'listener_not_member', paused_at: first });

    await store.setSpaceActive(SPACE);
    expect(await spaceRow()).toMatchObject({ status: 'active', pause_reason: null, paused_at: null });

    await store.setSpaceRemoved(SPACE);
    await store.setSpacePaused(SPACE, 'x');
    await store.setSpaceActive(SPACE);
    expect((await spaceRow()).status).toBe('removed');
  });

  test('markNoticePosted keeps the first time', async () => {
    await store.markNoticePosted(SPACE);
    const first = (await spaceRow()).notice_posted_at;
    await new Promise(r => setTimeout(r, 20));
    await store.markNoticePosted(SPACE);
    expect((await spaceRow()).notice_posted_at).toEqual(first);
  });

  test('upsert is idempotent on the message name', async () => {
    expect(await store.upsertMessages([row('a')])).toBe(1);
    expect(await store.upsertMessages([row('a')])).toBe(1);
    const count = await db.query('SELECT COUNT(*)::int AS n FROM chat_space_messages');
    expect(count.rows[0].n).toBe(1);
    expect(await stored('a')).toMatchObject({ text: 'text a', sender_user_id: 'users/1', thread_name: `${SPACE}/threads/t` });
  });

  test('a newer version overwrites; an older one does not; create_time never moves', async () => {
    await store.upsertMessages([row('a')]);
    expect(await store.upsertMessages([row('a', { text: 'edited', update_time: '2026-09-01T11:00:00Z', create_time: '2020-01-01T00:00:00Z' })])).toBe(1);
    expect(await store.upsertMessages([row('a', { text: 'stale', update_time: '2026-09-01T10:30:00Z' })])).toBe(0);

    const a = await stored('a');
    expect(a.text).toBe('edited');
    expect(a.create_time.toISOString()).toBe('2026-09-01T10:00:00.000Z');
  });

  test('the same name twice in one batch keeps the newest and does not error', async () => {
    const n = await store.upsertMessages([
      row('a', { text: 'older', update_time: '2026-09-01T10:00:00Z' }),
      row('a', { text: 'newer', update_time: '2026-09-01T12:00:00Z' }),
      row('b')
    ]);
    expect(n).toBe(2);
    expect((await stored('a')).text).toBe('newer');
  });

  test('a tombstoned message is removed and can never be stored again', async () => {
    await store.upsertMessages([row('a'), row('b')]);
    expect(await store.tombstoneMessages(SPACE, [`${SPACE}/messages/a`, `${SPACE}/messages/a`])).toBe(1);
    expect(await store.tombstoneMessages(SPACE, [`${SPACE}/messages/a`])).toBe(0);

    expect(await store.upsertMessages([row('a', { update_time: '2030-01-01T00:00:00Z' })])).toBe(0);
    expect(await stored('a')).toBeUndefined();
    expect(await stored('b')).toBeDefined();
  });

  test('tombstones ignore names from another space', async () => {
    await store.upsertMessages([row('a')]);
    expect(await store.tombstoneMessages(OTHER, [`${SPACE}/messages/a`])).toBe(0);
    expect(await stored('a')).toBeDefined();
  });

  test('a removed space accepts no messages and no tombstones', async () => {
    await store.setSpaceRemoved(SPACE);
    expect(await store.upsertMessages([row('a')])).toBe(0);
    await store.tombstoneMessages(SPACE, [`${SPACE}/messages/a`]);
    const t = await db.query('SELECT COUNT(*)::int AS n FROM chat_message_tombstones');
    expect(t.rows[0].n).toBe(0);
  });

  test('a paused space still accepts writes (in-flight work may finish)', async () => {
    await store.setSpacePaused(SPACE, 'listener_not_member');
    expect(await store.upsertMessages([row('a')])).toBe(1);
  });

  test('a message for a space with no row is dropped, not a foreign-key error', async () => {
    expect(await store.upsertMessages([row('x', { message_name: `${OTHER}/messages/x`, space_name: OTHER })])).toBe(0);
  });

  test('a backfill page and its token are saved together — or not at all', async () => {
    expect(await store.storeBackfillPage(SPACE, [row('a'), row('b')], 'token-2')).toBe(2);
    expect((await spaceRow()).backfill_page_token).toBe('token-2');

    // A bad row fails the whole page: no rows, and the token does not move.
    await expect(store.storeBackfillPage(SPACE, [row('c', { text: SECRET }), row('d', { create_time: null })], 'token-3'))
      .rejects.toMatchObject({ code: '23502' });
    expect((await spaceRow()).backfill_page_token).toBe('token-2');
    expect(await stored('c')).toBeUndefined();

    const out = logged();
    expect(out).toContain('Transaction error: chat listen backfill page (code: 23502)');
    expect(out).not.toContain(SECRET);
  });

  test('a constraint error is logged by label and code — never the failing row', async () => {
    await expect(
      db.query('UPDATE chat_listen_spaces SET pause_reason = $2, status = $3 WHERE space_name = $1', [SPACE, SECRET, 'bogus'])
    ).rejects.toMatchObject({ code: '23514' });
    const out = logged();
    expect(out).toContain('Database query error: UPDATE chat_listen_spaces (code: 23514)');
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('Failing row');
  });

  test('subscription bookkeeping', async () => {
    await store.saveSubscription(SPACE, { name: 'subscriptions/s1', expireTime: '2026-09-20T00:00:00Z', state: 'ACTIVE' });
    expect((await store.findSpaceBySubscription('subscriptions/s1')).space_name).toBe(SPACE);
    await store.setSubscriptionState(SPACE, 'SUSPENDED');
    expect((await spaceRow()).subscription_state).toBe('SUSPENDED');
    await store.clearSubscription(SPACE);
    expect(await store.findSpaceBySubscription('subscriptions/s1')).toBeNull();
    expect(await spaceRow()).toMatchObject({ subscription_name: null, subscription_expire_time: null });
  });

  test('backfill state: the token is kept unless given', async () => {
    await store.setBackfill(SPACE, { state: 'running', pageToken: 'tok' });
    await store.setBackfill(SPACE, { state: 'failed' });
    expect(await spaceRow()).toMatchObject({ backfill_state: 'failed', backfill_page_token: 'tok' });
    await store.setBackfill(SPACE, { state: 'done', pageToken: null });
    expect(await spaceRow()).toMatchObject({ backfill_state: 'done', backfill_page_token: null });
  });

  test('latestCreateTime', async () => {
    expect(await store.latestCreateTime(SPACE)).toBeNull();
    await store.upsertMessages([row('a'), row('b', { create_time: '2026-09-03T00:00:00Z', update_time: '2026-09-03T00:00:00Z' })]);
    expect((await store.latestCreateTime(SPACE)).toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });

  test('retention: messages past 12 months and tombstones past 30 days go; the rest stay', async () => {
    await store.upsertMessages([
      row('old', { create_time: '2025-09-01T00:00:00Z', update_time: '2025-09-01T00:00:00Z' }),
      row('new', { create_time: '2026-09-01T00:00:00Z', update_time: '2026-09-01T00:00:00Z' })
    ]);
    await store.tombstoneMessages(SPACE, [`${SPACE}/messages/t-old`, `${SPACE}/messages/t-new`]);
    await db.query(
      `UPDATE chat_message_tombstones SET deleted_at = '2026-08-01T00:00:00Z' WHERE message_name = $1`,
      [`${SPACE}/messages/t-old`]
    );

    const result = await store.pruneExpired({
      messagesBefore: new Date('2025-09-17T00:00:00Z'),
      tombstonesBefore: new Date('2026-08-18T00:00:00Z')
    });
    expect(result).toEqual({ messages: 1, tombstones: 1 });
    expect(await stored('old')).toBeUndefined();
    expect(await stored('new')).toBeDefined();
  });

  test('teardown deletes the copy; forgetting the space cascades', async () => {
    await store.upsertMessages([row('a'), row('b')]);
    await store.tombstoneMessages(SPACE, [`${SPACE}/messages/b`]);
    expect(await store.deleteSpaceData(SPACE)).toEqual({ messages: 1, tombstones: 1 });

    await store.upsertMessages([row('c')]);
    await store.deleteListenSpace(SPACE);
    const left = await db.query('SELECT COUNT(*)::int AS n FROM chat_space_messages');
    expect(left.rows[0].n).toBe(0);
    expect(await spaceRow()).toBeUndefined();
  });
});
