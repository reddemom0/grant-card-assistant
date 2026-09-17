/**
 * Stored copy of Chat messages — all SQL for src/chat-listen/
 *
 * Tables from migrations/029_chat_listen.sql. Every write is idempotent on the
 * message resource name, because Pub/Sub delivers at least once and the backfill
 * can be interrupted and resumed.
 *
 * Two guards keep the copy honest when events arrive late or out of order:
 *   - a tombstoned message is never stored again;
 *   - a stored message is only overwritten by a version at least as new.
 * And a space marked 'removed' accepts no writes at all, so an in-flight fetch
 * cannot refill a space that was just torn down.
 *
 * Message text is UNTRUSTED. Nothing here logs it; query()/transaction() log a
 * statement label and error code only.
 */

import { query, transaction } from './connection.js';

// ============================================================================
// SPACES
// ============================================================================

export async function getListenSpace(spaceName) {
  const r = await query('SELECT * FROM chat_listen_spaces WHERE space_name = $1', [spaceName]);
  return r.rows[0] || null;
}

export async function listListenSpaces() {
  const r = await query('SELECT * FROM chat_listen_spaces ORDER BY space_name');
  return r.rows;
}

export async function findSpaceBySubscription(subscriptionName) {
  if (!subscriptionName) return null;
  const r = await query('SELECT * FROM chat_listen_spaces WHERE subscription_name = $1', [subscriptionName]);
  return r.rows[0] || null;
}

/**
 * Create the row for a space, or restart one that was removed.
 *
 * A new or restarted space begins paused ('not_started') and becomes active only
 * after members are told and a subscription exists. A space that is already
 * active or paused is left exactly as it is.
 *
 * @param {Object} p
 * @param {string} p.spaceName
 * @param {string} p.label
 * @param {Date} p.since - backfill window start
 * @param {boolean} [p.noticePosted] - members were already told (the join intro said so)
 */
export async function startListenSpace({ spaceName, label, since, noticePosted = false }) {
  await query(
    `INSERT INTO chat_listen_spaces
       (space_name, label, status, pause_reason, paused_at, backfill_state, backfill_since,
        notice_posted_at, enabled_at, updated_at)
     VALUES ($1, $2, 'paused', 'not_started', NOW(), 'pending', $3,
        CASE WHEN $4::boolean THEN NOW() END, NOW(), NOW())
     ON CONFLICT (space_name) DO UPDATE SET
       label = EXCLUDED.label,
       status = 'paused',
       pause_reason = 'not_started',
       paused_at = NOW(),
       subscription_name = NULL,
       subscription_expire_time = NULL,
       subscription_state = NULL,
       backfill_state = 'pending',
       backfill_since = EXCLUDED.backfill_since,
       backfill_page_token = NULL,
       notice_posted_at = EXCLUDED.notice_posted_at,
       enabled_at = NOW(),
       updated_at = NOW()
     WHERE chat_listen_spaces.status = 'removed'`,
    [spaceName, label, since, noticePosted]
  );
}

/** Pause a space, keeping its copy. The first pause time is kept across repeats. */
export async function setSpacePaused(spaceName, reason) {
  await query(
    `UPDATE chat_listen_spaces
     SET status = 'paused', pause_reason = $2, paused_at = COALESCE(paused_at, NOW()), updated_at = NOW()
     WHERE space_name = $1 AND status <> 'removed'`,
    [spaceName, reason]
  );
}

export async function setSpaceActive(spaceName) {
  await query(
    `UPDATE chat_listen_spaces
     SET status = 'active', pause_reason = NULL, paused_at = NULL, updated_at = NOW()
     WHERE space_name = $1 AND status <> 'removed'`,
    [spaceName]
  );
}

/** Stop all writes to a space immediately. Its copy is deleted separately. */
export async function setSpaceRemoved(spaceName) {
  await query(
    `UPDATE chat_listen_spaces
     SET status = 'removed', pause_reason = NULL, paused_at = NULL, updated_at = NOW()
     WHERE space_name = $1`,
    [spaceName]
  );
}

/** Record that members were told. The first time is kept. */
export async function markNoticePosted(spaceName) {
  await query(
    `UPDATE chat_listen_spaces
     SET notice_posted_at = COALESCE(notice_posted_at, NOW()), updated_at = NOW()
     WHERE space_name = $1`,
    [spaceName]
  );
}

export async function saveSubscription(spaceName, { name, expireTime, state }) {
  await query(
    `UPDATE chat_listen_spaces
     SET subscription_name = $2, subscription_expire_time = $3, subscription_state = $4, updated_at = NOW()
     WHERE space_name = $1`,
    [spaceName, name, expireTime || null, state || null]
  );
}

export async function setSubscriptionState(spaceName, state) {
  await query(
    'UPDATE chat_listen_spaces SET subscription_state = $2, updated_at = NOW() WHERE space_name = $1',
    [spaceName, state]
  );
}

export async function clearSubscription(spaceName) {
  await query(
    `UPDATE chat_listen_spaces
     SET subscription_name = NULL, subscription_expire_time = NULL, subscription_state = NULL, updated_at = NOW()
     WHERE space_name = $1`,
    [spaceName]
  );
}

/**
 * @param {string} spaceName
 * @param {Object} p
 * @param {'pending'|'running'|'done'|'failed'} p.state
 * @param {string|null} [p.pageToken] - omitted leaves the saved token untouched
 */
export async function setBackfill(spaceName, { state, pageToken }) {
  if (pageToken === undefined) {
    await query(
      'UPDATE chat_listen_spaces SET backfill_state = $2, updated_at = NOW() WHERE space_name = $1',
      [spaceName, state]
    );
    return;
  }
  await query(
    `UPDATE chat_listen_spaces
     SET backfill_state = $2, backfill_page_token = $3, updated_at = NOW()
     WHERE space_name = $1`,
    [spaceName, state, pageToken]
  );
}

/** Delete the row and, by cascade, anything still stored for it. */
export async function deleteListenSpace(spaceName) {
  await query('DELETE FROM chat_listen_spaces WHERE space_name = $1', [spaceName]);
}

// ============================================================================
// MESSAGES
// ============================================================================

/**
 * Turn a Chat API Message into a row, or say why it is not stored.
 *
 * Only the fields the copy needs. A private message ("only visible to you") is
 * never stored, whoever it was visible to. A message that does not belong to the
 * space it arrived for is dropped rather than filed under the wrong space.
 *
 * @param {Object} message - Chat API Message
 * @param {string} spaceName
 * @returns {{row: Object}|{skip: 'private'|'wrong_space'|'malformed'}}
 */
export function messageToRow(message, spaceName) {
  const name = message?.name;
  if (typeof name !== 'string' || !name.startsWith(`${spaceName}/messages/`)) return { skip: 'wrong_space' };
  if (message.privateMessageViewer) return { skip: 'private' };
  if (!message.createTime) return { skip: 'malformed' };

  return {
    row: {
      message_name: name,
      space_name: spaceName,
      thread_name: message.thread?.name ?? null,
      sender_user_id: message.sender?.name ?? null,
      create_time: message.createTime,
      update_time: message.lastUpdateTime || message.createTime,
      text: typeof message.text === 'string' ? message.text : null
    }
  };
}

/**
 * One thread from the stored copy, oldest first. Text is UNTRUSTED. Only for
 * spaces the caller has already checked are listened and active.
 */
export async function listThreadMessages(spaceName, threadName, limit = 100) {
  const r = await query(
    `SELECT message_name, thread_name, sender_user_id, create_time, text
     FROM chat_space_messages
     WHERE space_name = $1 AND thread_name = $2
     ORDER BY create_time
     LIMIT $3`,
    [spaceName, threadName, limit]
  );
  return r.rows;
}

const UPSERT_SQL = `
  INSERT INTO chat_space_messages
    (message_name, space_name, thread_name, sender_user_id, create_time, update_time, text)
  SELECT m.message_name, m.space_name, m.thread_name, m.sender_user_id, m.create_time, m.update_time, m.text
  FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::timestamptz[], $7::text[])
    AS m(message_name, space_name, thread_name, sender_user_id, create_time, update_time, text)
  WHERE NOT EXISTS (SELECT 1 FROM chat_message_tombstones t WHERE t.message_name = m.message_name)
    AND EXISTS (SELECT 1 FROM chat_listen_spaces s
                WHERE s.space_name = m.space_name AND s.status <> 'removed')
  ON CONFLICT (message_name) DO UPDATE SET
    thread_name = EXCLUDED.thread_name,
    sender_user_id = EXCLUDED.sender_user_id,
    update_time = EXCLUDED.update_time,
    text = EXCLUDED.text,
    stored_at = NOW()
  WHERE EXCLUDED.update_time >= chat_space_messages.update_time`;

/** Keep one row per name — the newest — so one statement never hits a row twice. */
function newestPerName(rows) {
  const byName = new Map();
  for (const row of rows) {
    const seen = byName.get(row.message_name);
    if (!seen || new Date(row.update_time) >= new Date(seen.update_time)) byName.set(row.message_name, row);
  }
  return [...byName.values()];
}

async function upsertWith(run, rows) {
  const unique = newestPerName(rows);
  if (unique.length === 0) return 0;
  const col = (key) => unique.map(r => r[key]);
  const r = await run(UPSERT_SQL, [
    col('message_name'), col('space_name'), col('thread_name'), col('sender_user_id'),
    col('create_time'), col('update_time'), col('text')
  ]);
  return r.rowCount;
}

/**
 * Store messages. Idempotent; returns how many rows were inserted or changed.
 * @param {Object[]} rows - from messageToRow
 */
export async function upsertMessages(rows) {
  return upsertWith(query, rows);
}

/**
 * Store one backfill page and the token for the next page, atomically — so a
 * crash between the two can never skip a page or lose the place.
 */
export async function storeBackfillPage(spaceName, rows, nextPageToken) {
  return transaction(async (client) => {
    const stored = await upsertWith((text, params) => client.query(text, params), rows);
    await client.query(
      `UPDATE chat_listen_spaces SET backfill_page_token = $2, updated_at = NOW()
       WHERE space_name = $1`,
      [spaceName, nextPageToken || null]
    );
    return stored;
  }, 'chat listen backfill page');
}

/**
 * Remove deleted messages and remember that they were deleted. Idempotent.
 * @returns {Promise<number>} rows removed from the copy
 */
export async function tombstoneMessages(spaceName, messageNames) {
  const names = [...new Set(messageNames)].filter(n => typeof n === 'string' && n.startsWith(`${spaceName}/messages/`));
  if (names.length === 0) return 0;

  return transaction(async (client) => {
    const removed = await client.query(
      'DELETE FROM chat_space_messages WHERE space_name = $1 AND message_name = ANY($2::text[])',
      [spaceName, names]
    );
    await client.query(
      `INSERT INTO chat_message_tombstones (message_name, space_name, deleted_at)
       SELECT n, $1, NOW() FROM unnest($2::text[]) AS n
       WHERE EXISTS (SELECT 1 FROM chat_listen_spaces s WHERE s.space_name = $1 AND s.status <> 'removed')
       ON CONFLICT (message_name) DO UPDATE SET deleted_at = NOW()`,
      [spaceName, names]
    );
    return removed.rowCount;
  }, 'chat listen tombstone');
}

/** Newest stored create_time for a space, or null. */
export async function latestCreateTime(spaceName) {
  const r = await query(
    'SELECT MAX(create_time) AS latest FROM chat_space_messages WHERE space_name = $1',
    [spaceName]
  );
  return r.rows[0]?.latest || null;
}

/** Delete a space's whole copy. @returns {Promise<{messages: number, tombstones: number}>} */
export async function deleteSpaceData(spaceName) {
  return transaction(async (client) => {
    const m = await client.query('DELETE FROM chat_space_messages WHERE space_name = $1', [spaceName]);
    const t = await client.query('DELETE FROM chat_message_tombstones WHERE space_name = $1', [spaceName]);
    return { messages: m.rowCount, tombstones: t.rowCount };
  }, 'chat listen space teardown');
}

/**
 * Retention: messages created before messagesBefore, tombstones older than
 * tombstonesBefore.
 * @returns {Promise<{messages: number, tombstones: number}>}
 */
export async function pruneExpired({ messagesBefore, tombstonesBefore }) {
  const m = await query('DELETE FROM chat_space_messages WHERE create_time < $1', [messagesBefore]);
  const t = await query('DELETE FROM chat_message_tombstones WHERE deleted_at < $1', [tombstonesBefore]);
  return { messages: m.rowCount, tombstones: t.rowCount };
}
