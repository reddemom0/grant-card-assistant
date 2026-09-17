/**
 * Tracked cards' SQL, against a real Postgres
 *
 * The unit tests run the card code against an in-memory store. This file runs
 * migrations 025 and 030 and every statement in
 * src/database/tracked-cards-store.js, so the rules that live in SQL — one live
 * card per thread, reviewer-only status changes, the stale/close cut-offs,
 * COALESCE upserts, the digest's once-a-day key, the "last update" choice — are
 * proven in SQL, not just in the fake.
 *
 * SKIPPED unless TRACKED_CARDS_TEST_DATABASE_URL is set, and it refuses anything
 * that is not a loopback host. It creates its OWN database next to the one in
 * the URL (it needs stand-in users/conversations tables) and drops it at the
 * end, so nothing already in that server is touched. For example:
 *
 *   initdb -D /path/pg -U postgres --auth=trust
 *   pg_ctl -D /path/pg -o "-p 54329 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start
 *   TRACKED_CARDS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres \
 *     NODE_OPTIONS=--experimental-vm-modules npx jest tests/integration/tracked-cards-store.test.js
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const adminUrl = process.env.TRACKED_CARDS_TEST_DATABASE_URL;
const loopback = (() => {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(adminUrl).hostname);
  } catch {
    return false;
  }
})();
const run = adminUrl && loopback ? describe : describe.skip;

if (adminUrl && !loopback) {
  // eslint-disable-next-line no-console
  console.warn('TRACKED_CARDS_TEST_DATABASE_URL is not a loopback address — refusing to run.');
}

const TEST_DB = `tracked_cards_it_${process.pid}`;
if (adminUrl && loopback) {
  const url = new URL(adminUrl);
  url.pathname = `/${TEST_DB}`;
  process.env.DATABASE_URL = url.toString();
  delete process.env.POSTGRES_URL;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migration = (name) => readFileSync(join(__dirname, '../../migrations', name), 'utf8');

// Stand-ins for the two existing tables migration 030 references.
const BASE_SCHEMA = `
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    chat_user_id TEXT
  );
  CREATE TABLE conversations (id UUID PRIMARY KEY);
`;

const SPACE = 'spaces/IT';
const CONV = '55555555-5555-4555-8555-555555555555';
const DAY = 864e5;
const T0 = new Date('2026-09-01T12:00:00Z');
const at = (days) => new Date(T0.getTime() + days * DAY);

let store;
let db;
let gate;
let threadSeq = 0;

async function withAdmin(fn) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const newCard = (fields = {}) => store.insertCard({
  cardType: 'review', status: 'open', spaceName: SPACE, threadName: `${SPACE}/threads/${++threadSeq}`,
  conversationId: CONV, ownerChatId: 'users/1', ownerUserId: 1, title: 'Card', data: { docs: [] },
  ...fields
});

const setActivity = (id, when) =>
  db.query('UPDATE tracked_cards SET last_activity_at = $2 WHERE id = $1', [id, when]);

run('tracked cards store (real Postgres)', () => {
  let poolLog;

  beforeAll(async () => {
    await withAdmin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
      await c.query(`CREATE DATABASE ${TEST_DB}`);
    });
    poolLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    db = await import('../../src/database/connection.js');
    store = await import('../../src/database/tracked-cards-store.js');
    gate = await import('../../src/tools/pending-actions.js');
    const pool = db.getPool();
    await pool.query(BASE_SCHEMA);
    await pool.query(migration('025_create_pending_actions.sql'));
    await pool.query(migration('026_pending_actions_auto_approved_reason.sql'));
    await pool.query(migration('030_tracked_cards.sql'));
    await pool.query(migration('030_tracked_cards.sql'));   // safe to re-run
    await pool.query(migration('031_track_cards.sql'));
    await pool.query(migration('031_track_cards.sql'));     // safe to re-run
    await pool.query(migration('033_card_notices.sql'));
    await pool.query(migration('033_card_notices.sql'));    // safe to re-run
    await pool.query(migration('034_space_intros.sql'));
    await pool.query(migration('034_space_intros.sql'));    // safe to re-run
  });

  afterAll(async () => {
    await db.closePool();
    await new Promise(resolve => setTimeout(resolve, 50));
    await withAdmin(c => c.query(`DROP DATABASE IF EXISTS ${TEST_DB}`));
    poolLog.mockRestore();
  });

  let logSpies;
  beforeEach(async () => {
    logSpies = ['warn', 'error', 'log'].map(level => jest.spyOn(console, level).mockImplementation(() => {}));
    await db.query(`TRUNCATE tracked_card_digests, chat_people, tracked_card_clicks,
                    tracked_card_participants, tracked_cards, pending_actions, conversations, users
                    RESTART IDENTITY CASCADE`);
    await db.query(
      `INSERT INTO users (email, name, is_active, chat_user_id) VALUES
         ('Owner@Example.com', 'Owner', true, 'users/1'),
         ('reviewer@example.com', 'Reviewer', true, NULL),
         ('gone@example.com', 'Gone', false, 'users/9')`
    );
    await db.query('INSERT INTO conversations (id) VALUES ($1)', [CONV]);
  });
  afterEach(() => logSpies.forEach(s => s.mockRestore()));

  test('the migration created its five tables', async () => {
    const r = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name LIKE 'tracked_card%' OR table_name = 'chat_people'
       ORDER BY table_name`
    );
    expect(r.rows.map(x => x.table_name)).toEqual([
      'chat_people', 'tracked_card_clicks', 'tracked_card_digests', 'tracked_card_participants', 'tracked_cards'
    ]);
  });

  // --------------------------------------------------------------------------
  // CARDS
  // --------------------------------------------------------------------------

  test('one live card per type and thread; a closed card does not block a new one', async () => {
    const thread = `${SPACE}/threads/dup`;
    const first = await newCard({ threadName: thread });
    expect(first).toMatchObject({ status: 'open', data: { docs: [] }, message_name: null });

    expect(await newCard({ threadName: thread })).toBeNull();
    expect(await newCard({ threadName: thread, status: 'offered' })).toBeNull();
    expect(await newCard({ threadName: thread, cardType: 'other' })).not.toBeNull();

    expect((await store.findLiveCard('review', thread)).id).toBe(first.id);
    await store.closeCard(first.id, 'closed_by_owner', at(1));
    expect(await store.findLiveCard('review', thread)).toBeNull();
    const second = await newCard({ threadName: thread });
    expect(second.id).not.toBe(first.id);
    expect((await store.getCard(first.id)).status).toBe('closed');   // still there, still readable
  });

  test('concurrent inserts for one thread make exactly one card', async () => {
    const thread = `${SPACE}/threads/race`;
    const results = await Promise.all(Array.from({ length: 5 }, () => newCard({ threadName: thread })));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test('message names are unique and statuses are checked', async () => {
    const a = await newCard();
    const b = await newCard();
    await store.updateCard(a.id, { messageName: `${SPACE}/messages/1` });
    await expect(store.updateCard(b.id, { messageName: `${SPACE}/messages/1` })).rejects.toMatchObject({ code: '23505' });
    await expect(store.updateCard(b.id, { status: 'archived' })).rejects.toMatchObject({ code: '23514' });
    await expect(store.updateCard(b.id, { card_type: 'x' })).rejects.toThrow('unknown field card_type');
  });

  test('updateCard writes the named fields and round-trips data', async () => {
    const card = await newCard();
    const data = { docs: [{ fileId: 'F', openComments: 2 }], hubspot: { state: 'proposed' }, note: 'a "quoted" <b>value</b>' };
    const updated = await store.updateCard(card.id, { data, title: 'New', lastRefreshedAt: at(2) });
    expect(updated).toMatchObject({ title: 'New', data, last_refreshed_at: at(2) });
    expect(await store.updateCard(card.id, {})).toMatchObject({ title: 'New' });
  });

  test('activity reopens a stale card; nothing touches a closed one', async () => {
    const card = await newCard();
    await setActivity(card.id, at(0));
    const [stale] = await store.markStaleBefore(at(30), at(31));
    expect(stale).toMatchObject({ id: card.id, status: 'stale', stale_since: at(31) });

    expect(await store.touchActivity(card.id, at(32))).toMatchObject({ status: 'open', stale_since: null, last_activity_at: at(32) });

    await store.closeCard(card.id, 'closed_by_owner', at(33));
    expect(await store.touchActivity(card.id, at(34))).toBeNull();
    expect(await store.closeCard(card.id, 'again', at(35))).toBeNull();
    expect(await store.getCard(card.id)).toMatchObject({ status: 'closed', closed_reason: 'closed_by_owner', closed_at: at(33) });
  });

  test('stale after the idle cut-off, closed after the stale cut-off, offers closed after idling', async () => {
    const idle = await newCard();
    const busy = await newCard();
    const offer = await newCard({ status: 'offered' });
    const waiting = await newCard({ status: 'awaiting_docs' });
    await setActivity(idle.id, at(0));
    await setActivity(busy.id, at(20));
    await setActivity(offer.id, at(0));
    await setActivity(waiting.id, at(20));

    const staled = await store.markStaleBefore(at(10), at(40));
    expect(staled.map(c => c.id)).toEqual([idle.id]);          // offers never go stale

    expect(await store.closeStaleBefore(at(40), at(50))).toEqual([]);          // stale_since is not before the cut-off
    const closed = await store.closeStaleBefore(at(41), at(55));
    expect(closed.map(c => [c.id, c.closed_reason])).toEqual([[idle.id, 'auto_stale']]);

    const offers = await store.closeOffersBefore(at(10), at(55));
    expect(offers.map(c => [c.id, c.closed_reason])).toEqual([[offer.id, 'offer_expired']]);

    const live = await store.listCardsByStatus(['open', 'awaiting_docs']);
    expect(live.map(c => c.id).sort()).toEqual([busy.id, waiting.id].sort());
  });

  test('completed cards close 7 days on; a thread\'s live cards are found by conversation', async () => {
    const done = await newCard();
    const recent = await newCard();
    const working = await newCard();
    const closed = await newCard();
    await store.updateCard(done.id, { completedAt: at(0) });
    await store.updateCard(recent.id, { completedAt: at(5) });
    await store.updateCard(closed.id, { completedAt: at(0) });
    await store.closeCard(closed.id, 'note_added', at(1));

    const live = await store.liveCardsForConversation(CONV);
    expect(live.map(c => c.id).sort()).toEqual([done.id, recent.id, working.id].sort());
    expect(await store.liveCardsForConversation('77777777-7777-4777-8777-777777777777')).toEqual([]);

    const result = await store.closeCompletedBefore(at(4), at(7));
    expect(result.map(c => [c.id, c.closed_reason])).toEqual([[done.id, 'completed']]);
    expect(await store.getCard(closed.id)).toMatchObject({ closed_reason: 'note_added', closed_at: at(1) });
    expect((await store.getCard(working.id)).status).toBe('open');
  });

  test('a completed request is in the owner\'s digest until one has shown it — and all of that day', async () => {
    const done = await newCard();
    const working = await newCard();
    await store.updateCard(done.id, { completedAt: at(0) });
    const owned = async (date) => (await store.ownedBy('users/1', ['open'], date)).map(c => c.id).sort();

    expect(await owned('2026-09-02')).toEqual([done.id, working.id].sort());
    await store.markCompletionShown([done.id, working.id], '2026-09-02');
    expect((await store.getCard(working.id)).completion_shown_on).toBeNull();   // not completed

    expect(await owned('2026-09-02')).toEqual([done.id, working.id].sort());
    expect(await owned('2026-09-03')).toEqual([working.id]);
    expect(await owned(null)).toEqual([working.id]);

    await store.markCompletionShown([done.id], '2026-09-03');                   // first showing is kept
    expect(await owned('2026-09-03')).toEqual([working.id]);
    await store.markCompletionShown([], '2026-09-03');
  });

  test('a declined proposal cannot run and cannot be confirmed', async () => {
    const saved = await gate.savePendingAction({
      conversationId: CONV, toolName: 'create_hubspot_note', input: { deal_id: '1', body: 'x' }, userId: 1, summary: 'Add a note'
    });
    expect(await gate.declinePendingAction({ actionId: saved.id, chatUserId: 'users/1' })).toBe(true);
    expect(await gate.declinePendingAction({ actionId: saved.id })).toBe(false);
    expect(await store.pendingActionState(saved.id)).toMatchObject({
      status: 'declined', result: { declined: true, declined_by: null, declined_by_chat_user: 'users/1' }
    });
    expect(await gate.getPendingAction(CONV)).toEqual({ action: null, expired: false });
    expect(await gate.runPendingAction({ actionId: saved.id, userId: 2 })).toEqual({ ok: false, reason: 'not_pending' });
    expect(await gate.isAuthorisedExecution(saved.id)).toBe(false);
  });

  test('a deleted conversation leaves the card, without its conversation', async () => {
    const card = await newCard();
    await db.query('DELETE FROM conversations WHERE id = $1', [CONV]);
    expect((await store.getCard(card.id)).conversation_id).toBeNull();
  });

  // --------------------------------------------------------------------------
  // PARTICIPANTS AND CLICKS
  // --------------------------------------------------------------------------

  test('participants: reviewers start not started; re-adding keeps status and mute', async () => {
    const card = await newCard();
    await store.addParticipants(card.id, [
      { chatUserId: 'users/1', role: 'owner', displayName: 'Owner' },
      { chatUserId: 'users/3', role: 'reviewer', displayName: 'Zed' },
      { chatUserId: 'users/2', role: 'reviewer', displayName: 'Amy' }
    ]);
    let rows = await store.getParticipants(card.id);
    expect(rows.map(p => [p.chat_user_id, p.role, p.status])).toEqual([
      ['users/1', 'owner', null],
      ['users/2', 'reviewer', 'not_started'],
      ['users/3', 'reviewer', 'not_started']
    ]);

    expect(await store.setReviewerStatus(card.id, 'users/2', 'done', at(1))).toBe(true);
    expect(await store.setMuted(card.id, 'users/2', true)).toBe(true);
    await store.addParticipants(card.id, [{ chatUserId: 'users/2', role: 'reviewer', displayName: null }]);
    rows = await store.getParticipants(card.id);
    expect(rows.find(p => p.chat_user_id === 'users/2')).toMatchObject({
      status: 'done', muted: true, display_name: 'Amy', status_changed_at: at(1)
    });
  });

  test('only a reviewer’s own row moves; an owner or outsider changes nothing', async () => {
    const card = await newCard();
    await store.addParticipants(card.id, [
      { chatUserId: 'users/1', role: 'owner' },
      { chatUserId: 'users/2', role: 'reviewer' }
    ]);
    expect(await store.setReviewerStatus(card.id, 'users/1', 'done')).toBe(false);
    expect(await store.setReviewerStatus(card.id, 'users/77', 'done')).toBe(false);
    expect(await store.setMuted(card.id, 'users/77', true)).toBe(false);
    expect(await store.getParticipants(card.id)).toHaveLength(2);
    await expect(store.setReviewerStatus(card.id, 'users/2', 'finished')).rejects.toMatchObject({ code: '23514' });

    await store.markAssignedNotified(card.id, 'users/2', at(3));
    expect((await store.getParticipants(card.id))[1].assigned_notified_at).toEqual(at(3));
  });

  test('the last update is the latest press that changed something, never a mute', async () => {
    const card = await newCard();
    expect(await store.latestClick(card.id)).toBeNull();
    await store.logClick(card.id, { chatUserId: 'users/2', name: 'Amy' }, 'review.reviewing', at(1), 'changed');
    await store.logClick(card.id, { chatUserId: 'users/3', name: 'Zed' }, 'review.done', at(2), 'not_a_reviewer');
    await store.logClick(card.id, { chatUserId: 'users/2', name: 'Amy' }, 'card.mute', at(3), 'changed');
    expect(await store.latestClick(card.id)).toMatchObject({ actor_name: 'Amy', action: 'review.reviewing' });

    // Same instant: the later insert wins.
    await store.logClick(card.id, { chatUserId: 'users/2', name: 'Amy' }, 'review.done', at(4));
    await store.logClick(card.id, { chatUserId: 'users/1', name: 'Owner' }, 'review.draft', at(4));
    expect(await store.latestClick(card.id)).toMatchObject({ action: 'review.draft', result: 'changed' });

    const all = await db.query('SELECT COUNT(*)::int AS n FROM tracked_card_clicks WHERE card_id = $1', [card.id]);
    expect(all.rows[0].n).toBe(5);                             // every press is kept
  });

  test('deleting a card removes its participants and clicks', async () => {
    const card = await newCard();
    await store.addParticipants(card.id, [{ chatUserId: 'users/2', role: 'reviewer' }]);
    await store.logClick(card.id, { chatUserId: 'users/2' }, 'review.done');
    await db.query('DELETE FROM tracked_cards WHERE id = $1', [card.id]);
    const left = await db.query(
      `SELECT (SELECT COUNT(*) FROM tracked_card_participants)::int AS p,
              (SELECT COUNT(*) FROM tracked_card_clicks)::int AS c`
    );
    expect(left.rows[0]).toEqual({ p: 0, c: 0 });
  });

  // --------------------------------------------------------------------------
  // TRACK CARDS (migration 031)
  // --------------------------------------------------------------------------

  test('members: a pending checklist, own-row changes only, and removal never touches the owner', async () => {
    const card = await newCard({ cardType: 'track' });
    await store.addParticipants(card.id, [
      { chatUserId: 'users/1', role: 'owner' },
      { chatUserId: 'users/2', role: 'member', status: 'pending' },
      { chatUserId: 'users/3', role: 'member' }
    ]);
    let rows = await store.getParticipants(card.id);
    expect(rows.map(p => [p.chat_user_id, p.role, p.status])).toEqual([
      ['users/1', 'owner', null], ['users/2', 'member', 'pending'], ['users/3', 'member', null]
    ]);

    expect(await store.setMemberStatus(card.id, 'users/2', 'needs_help', at(1))).toBe(true);
    expect(await store.setMemberStatus(card.id, 'users/1', 'done')).toBe(false);          // owner row
    expect(await store.setReviewerStatus(card.id, 'users/2', 'done')).toBe(false);        // not a reviewer
    await store.addParticipants(card.id, [{ chatUserId: 'users/2', role: 'member', status: 'pending' }]);
    rows = await store.getParticipants(card.id);
    expect(rows.find(p => p.chat_user_id === 'users/2')).toMatchObject({ status: 'needs_help', status_changed_at: at(1) });

    expect(await store.removeParticipant(card.id, 'users/1')).toBe(false);
    expect(await store.removeParticipant(card.id, 'users/3')).toBe(true);
    expect((await store.getParticipants(card.id)).map(p => p.chat_user_id)).toEqual(['users/1', 'users/2']);

    await expect(store.addParticipants(card.id, [{ chatUserId: 'users/4', role: 'holder' }]))
      .rejects.toMatchObject({ code: '23514' });
    await expect(store.setMemberStatus(card.id, 'users/2', 'waiting')).rejects.toMatchObject({ code: '23514' });
  });

  test('card data is merged atomically, so concurrent writers keep each other\'s keys', async () => {
    const card = await newCard({ cardType: 'track', data: { ball: { state: 'unassigned' }, keep: 1 } });
    await Promise.all([
      store.patchCardData(card.id, { suggestion: { state: 'person' } }),
      store.patchCardData(card.id, { busy: { kind: 'refresh' } }),
      store.patchCardData(card.id, { ball: { state: 'person' } }, { lastActivityAt: at(3) })
    ]);
    const after = await store.getCard(card.id);
    expect(after.data).toEqual({ ball: { state: 'person' }, keep: 1, suggestion: { state: 'person' }, busy: { kind: 'refresh' } });
    expect(after.last_activity_at).toEqual(at(3));
    await expect(store.patchCardData(card.id, {}, { data: {} })).rejects.toThrow('unknown field data');
  });

  test('due dates: setting one clears the markers, and each reminder can be claimed once', async () => {
    const card = await newCard({ cardType: 'track' });
    const other = await newCard({ cardType: 'review' });
    await store.setDue(card.id, at(5));
    await store.setDue(other.id, at(5));

    expect((await store.dueCardsOfType('track', at(6))).map(c => c.id)).toEqual([card.id]);
    expect(await store.dueCardsOfType('track', at(4))).toEqual([]);

    const claims = await Promise.all([1, 2, 3].map(() => store.claimDueReminder(card.id, at(5))));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.claimDueSummary(card.id, at(6))).toBe(true);
    expect(await store.claimDueSummary(card.id, at(6))).toBe(false);

    await store.setDue(card.id, at(9));                     // moved: both go out again
    expect(await store.getCard(card.id)).toMatchObject({ due_at: at(9), due_reminded_at: null, due_summary_sent_at: null });
    await store.closeCard(card.id, 'resolved');
    expect(await store.claimDueReminder(card.id)).toBe(false);
  });

  test('live cards by type and by thread', async () => {
    const thread = `${SPACE}/threads/both`;
    const review = await newCard({ threadName: thread });
    const track = await newCard({ threadName: thread, cardType: 'track' });
    const closed = await newCard({ cardType: 'track' });
    await store.closeCard(closed.id, 'resolved');

    expect((await store.liveCardsOfType('track')).map(c => c.id)).toEqual([track.id]);
    expect((await store.liveCardsInThread(thread)).map(c => c.id).sort()).toEqual([review.id, track.id].sort());
  });

  test('recorded decisions are found per space and window, closed cards included', async () => {
    const decided = await newCard({ cardType: 'track', title: 'Industry list' });
    await store.patchCardData(decided.id, { decision: { text: 'Use the 2024 NAICS list', by: 'Nat', at: at(2).toISOString() } });
    await store.closeCard(decided.id, 'decided', at(2));
    const open = await newCard({ cardType: 'track' });
    await store.patchCardData(open.id, { decision: { text: 'Later one', by: 'Jo', at: at(8).toISOString() } });
    const elsewhere = await newCard({ cardType: 'track', spaceName: 'spaces/OTHER' });
    await store.patchCardData(elsewhere.id, { decision: { text: 'Other space', by: 'X', at: at(2).toISOString() } });
    const review = await newCard();
    await store.patchCardData(review.id, { decision: { text: 'Not a track card', at: at(2).toISOString() } });
    await newCard({ cardType: 'track' });                  // no decision

    const all = await store.decisionsForSpace(SPACE);
    expect(all.map(d => d.decision.text)).toEqual(['Later one', 'Use the 2024 NAICS list']);
    expect(all[1]).toMatchObject({ id: decided.id, title: 'Industry list', thread_name: decided.thread_name });

    expect((await store.decisionsForSpace(SPACE, at(1), at(5))).map(d => d.decision.text)).toEqual(['Use the 2024 NAICS list']);
  });

  test('closed cards are deleted 12 months on, with their participants and clicks', async () => {
    const old = await newCard();
    const recent = await newCard();
    const live = await newCard();
    for (const c of [old, recent, live]) {
      await store.addParticipants(c.id, [{ chatUserId: 'users/2', role: 'reviewer' }]);
      await store.logClick(c.id, { chatUserId: 'users/2' }, 'review.done');
    }
    await store.closeCard(old.id, 'closed_by_owner', at(0));
    await store.closeCard(recent.id, 'closed_by_owner', at(400));

    expect(await store.purgeClosedBefore(at(365))).toBe(1);
    expect(await store.getCard(old.id)).toBeNull();
    expect(await store.getCard(recent.id)).not.toBeNull();
    expect(await store.getCard(live.id)).not.toBeNull();
    const left = await db.query('SELECT COUNT(*)::int AS n FROM tracked_card_participants WHERE card_id = $1', [old.id]);
    expect(left.rows[0].n).toBe(0);
  });

  // --------------------------------------------------------------------------
  // PEOPLE
  // --------------------------------------------------------------------------

  test('what is known about a person is never erased by a later unknown', async () => {
    const first = await store.upsertPerson({ chatUserId: 'users/2', email: 'reviewer@example.com', displayName: 'Amy' });
    expect(first).toMatchObject({ user_id: null, email: 'reviewer@example.com', display_name: 'Amy', time_zone: null });

    const second = await store.upsertPerson({ chatUserId: 'users/2', userId: 2 });
    expect(second).toMatchObject({ user_id: 2, email: 'reviewer@example.com', display_name: 'Amy' });

    await store.setPersonTimeZone('users/2', 'America/Toronto', at(1));
    await store.setPersonDm('users/2', 'spaces/DM2', at(1));
    expect(await store.getPerson('users/2')).toMatchObject({
      time_zone: 'America/Toronto', time_zone_checked_at: at(1), dm_space_name: 'spaces/DM2', dm_checked_at: at(1)
    });
    await store.setPersonDm('users/2', null, at(2));           // "no DM" is remembered with its check time
    expect(await store.getPerson('users/2')).toMatchObject({ dm_space_name: null, dm_checked_at: at(2) });
    expect(await store.getPerson('users/404')).toBeNull();
  });

  test('Hub users are found by id, then Chat id, then email — active only', async () => {
    expect(await store.findHubUser({ chatUserId: 'users/1' })).toMatchObject({ id: 1 });
    expect(await store.findHubUser({ email: 'OWNER@example.COM' })).toMatchObject({ id: 1 });
    expect(await store.findHubUser({ userId: 2 })).toMatchObject({ id: 2, email: 'reviewer@example.com' });
    expect(await store.findHubUser({ userId: 2, chatUserId: 'users/1' })).toMatchObject({ id: 2 });
    expect(await store.findHubUser({ chatUserId: 'users/1', email: 'reviewer@example.com' })).toMatchObject({ id: 1 });
    expect(await store.findHubUser({ chatUserId: 'users/9' })).toBeNull();           // inactive
    expect(await store.findHubUser({ userId: 3 })).toBeNull();
    expect(await store.findHubUser({})).toBeNull();

    await store.setUserChatId(2, 'users/2');
    expect(await store.findHubUser({ chatUserId: 'users/2' })).toMatchObject({ id: 2 });
  });

  // --------------------------------------------------------------------------
  // DIGEST
  // --------------------------------------------------------------------------

  test('digest queries: who gets one, what waits on them, what they own', async () => {
    const open = await newCard();
    const stale = await newCard({ ownerChatId: 'users/5' });
    const closed = await newCard();
    for (const c of [open, stale, closed]) {
      await store.addParticipants(c.id, [
        { chatUserId: c.owner_chat_id, role: 'owner' },
        { chatUserId: 'users/2', role: 'reviewer' },
        { chatUserId: 'users/3', role: 'reviewer' }
      ]);
    }
    await setActivity(stale.id, at(0));
    await store.markStaleBefore(at(10), at(11));
    await store.closeCard(closed.id, 'closed_by_owner');
    await store.setReviewerStatus(open.id, 'users/3', 'done');
    await store.setMuted(stale.id, 'users/3', true);
    await store.setMuted(stale.id, 'users/5', true);            // a muted owner still hears about staleness
    await store.setMuted(open.id, 'users/1', true);

    expect((await store.digestCandidates()).sort()).toEqual(['users/2', 'users/3', 'users/5']);

    const waiting = await store.waitingOn('users/2');
    expect(waiting.map(c => [c.id, c.my_status])).toEqual([[open.id, 'not_started'], [stale.id, 'not_started']]);
    expect(await store.waitingOn('users/3')).toEqual([]);      // done on one, muted on the other

    expect(await store.ownedBy('users/1', ['open'])).toEqual([]);                  // muted
    expect((await store.ownedBy('users/5', ['stale'])).map(c => c.id)).toEqual([stale.id]);
  });

  test('a digest is recorded once per person per local day', async () => {
    expect(await store.digestSent('users/2', '2026-09-18')).toBe(false);
    expect(await store.recordDigest('users/2', '2026-09-18')).toBe(true);
    expect(await store.recordDigest('users/2', '2026-09-18', 'spaces/x/messages/y')).toBe(false);
    expect(await store.digestSent('users/2', '2026-09-18')).toBe(true);
    expect(await store.recordDigest('users/2', '2026-09-19')).toBe(true);
    expect(await store.recordDigest('users/3', '2026-09-18')).toBe(true);
  });

  // --------------------------------------------------------------------------
  // THE CONFIRMATION GATE'S VIEW
  // --------------------------------------------------------------------------

  test('a proposal’s state is read straight from pending_actions', async () => {
    const r = await db.query(
      `INSERT INTO pending_actions (conversation_id, tool_name, tool_input, summary, status, expires_at, result)
       VALUES ($1, 'create_hubspot_note', '{}'::jsonb, 'Add a note', 'confirmed', $2, '{"success": true}'::jsonb)
       RETURNING id`,
      [CONV, at(1)]
    );
    expect(await store.pendingActionState(r.rows[0].id)).toEqual({
      status: 'confirmed', result: { success: true }, expires_at: at(1)
    });
    expect(await store.pendingActionState('66666666-6666-4666-8666-666666666666')).toBeNull();
    expect(await store.pendingActionState(null)).toBeNull();
  });

  test('a failing statement logs its label and code, never its values', async () => {
    const card = await newCard();
    await store.updateCard(card.id, { messageName: 'spaces/IT/messages/secret-value' });
    const other = await newCard();
    await expect(store.updateCard(other.id, { messageName: 'spaces/IT/messages/secret-value' })).rejects.toBeTruthy();
    const out = logSpies.flatMap(s => s.mock.calls).map(a => a.join(' ')).join('\n');
    expect(out).toContain('23505');
    expect(out).not.toContain('secret-value');
  });
  // ==========================================================================
  // THE NEWER RULES (migrations 033 and 034)
  // ==========================================================================

  describe('staleness by card type', () => {
    test('a type can be left out of the blanket pass, and swept on its own clock', async () => {
      const track = await newCard({ cardType: 'track' });
      const watch = await newCard({ cardType: 'watch' });
      const meet = await newCard({ cardType: 'meet' });
      for (const c of [track, watch, meet]) await setActivity(c.id, at(0));

      // The blanket pass, with two types held back.
      const blanket = await store.markStaleBefore(at(30), at(31), { exceptTypes: ['watch', 'meet'] });
      expect(blanket.map(c => c.id)).toEqual([track.id]);

      // And one of those types swept on its own, longer clock.
      const own = await store.markStaleBefore(at(50), at(51), { onlyTypes: ['watch'] });
      expect(own.map(c => c.id)).toEqual([watch.id]);
      expect((await store.getCard(meet.id)).status).toBe('open');
    });

    test('due cards are found by type, never across types', async () => {
      const lead = await newCard({ cardType: 'lead' });
      const meet = await newCard({ cardType: 'meet' });
      await store.setDue(lead.id, at(5));
      await store.setDue(meet.id, at(5));

      expect((await store.dueCardsOfType('lead', at(6))).map(c => c.id)).toEqual([lead.id]);
      expect((await store.dueCardsOfType('meet', at(6))).map(c => c.id)).toEqual([meet.id]);
      expect(await store.dueCardsOfType('watch', at(6))).toEqual([]);
      expect(await store.dueCardsOfType('lead', at(4))).toEqual([]);
    });
  });

  describe('one notice per person per day', () => {
    test('the first caller wins, and tomorrow wins again', async () => {
      const row = await newCard({ cardType: 'watch' });
      await store.addParticipants(row.id, [
        { chatUserId: 'users/a', role: 'member' },
        { chatUserId: 'users/b', role: 'member' }
      ]);

      expect(await store.claimParticipantNotice(row.id, 'users/a', '2026-09-17')).toBe(true);
      expect(await store.claimParticipantNotice(row.id, 'users/a', '2026-09-17')).toBe(false);
      // Another person that same day is unaffected.
      expect(await store.claimParticipantNotice(row.id, 'users/b', '2026-09-17')).toBe(true);
      // The next day is a new claim.
      expect(await store.claimParticipantNotice(row.id, 'users/a', '2026-09-18')).toBe(true);
      // Somebody not on the card claims nothing.
      expect(await store.claimParticipantNotice(row.id, 'users/c', '2026-09-18')).toBe(false);
    });

    test('two claims at once yield exactly one winner', async () => {
      const row = await newCard({ cardType: 'watch' });
      await store.addParticipants(row.id, [{ chatUserId: 'users/a', role: 'member' }]);

      const results = await Promise.all([
        store.claimParticipantNotice(row.id, 'users/a', '2026-09-17'),
        store.claimParticipantNotice(row.id, 'users/a', '2026-09-17')
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe('introducing Oracle once', () => {
    test('a space is claimed once, and the claim can be given back', async () => {
      expect(await store.claimSpaceIntro('spaces/NEW')).toBe(true);
      expect(await store.claimSpaceIntro('spaces/NEW')).toBe(false);
      expect(await store.spaceIntro('spaces/NEW')).toMatchObject({ kind: 'space', message_name: null });

      await store.setSpaceIntroMessage('spaces/NEW', 'spaces/NEW/messages/m1');
      expect((await store.spaceIntro('spaces/NEW')).message_name).toBe('spaces/NEW/messages/m1');

      // Posting failed: the claim goes back and the next pass can post.
      await store.releaseSpaceIntro('spaces/NEW');
      expect(await store.spaceIntro('spaces/NEW')).toBeNull();
      expect(await store.claimSpaceIntro('spaces/NEW')).toBe(true);
    });

    test('a DM is its own claim, and two at once yield one winner', async () => {
      expect(await store.claimSpaceIntro('spaces/DM1', 'dm')).toBe(true);
      expect((await store.spaceIntro('spaces/DM1')).kind).toBe('dm');

      const results = await Promise.all([
        store.claimSpaceIntro('spaces/DM2', 'dm'),
        store.claimSpaceIntro('spaces/DM2', 'dm')
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    test('only "space" and "dm" are allowed kinds', async () => {
      await expect(store.claimSpaceIntro('spaces/BAD', 'other')).rejects.toThrow();
    });
  });
});
