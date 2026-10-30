/**
 * Quoted-message context, kept for the rest of a Chat thread
 *
 * findQuotedMessage (src/services/quoted-message.js) runs only on the message
 * that carries the quote. So that later turns still know what was quoted,
 * src/api/chat-google.js saves its result against the thread's conversation in
 * quoted_contexts (migration 059) and, on a turn with no new Oracle quote,
 * loads it back. Nothing is read from the Chat API again; a sweep card's files
 * are re-read from filing_sweep_suggestions so their status stays current.
 *
 * A newer Oracle quote in the same thread replaces the saved one.
 *
 * DM fallback: in a DM, a message typed in the main box starts a new thread,
 * and so a new conversation. When that conversation has nothing saved, the
 * newest quote saved in the same DM in the last DM_FALLBACK_MINUTES is used
 * instead, labelled as possibly unrelated, and copied to the new conversation
 * (so the window runs from the last time it was used).
 *
 * Never fails a turn: errors are logged with a code; a missing table is silent.
 * Logs carry codes only, never names or text.
 */

import { findSweepFiles } from './quoted-message.js';

export const DM_FALLBACK_MINUTES = 30;

const codeOf = (err) => err?.code ?? err?.name ?? 'unknown';

async function defaultQuery(text, params) {
  const { query } = await import('../database/connection.js');
  return query(text, params);
}

const SAVE_SQL = `
INSERT INTO quoted_contexts (conversation_id, space_name, quoted_message_name, context, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (conversation_id) DO UPDATE
  SET space_name = EXCLUDED.space_name,
      quoted_message_name = EXCLUDED.quoted_message_name,
      context = EXCLUDED.context,
      updated_at = NOW()`;

const LOAD_SQL = `
SELECT space_name, quoted_message_name, context
  FROM quoted_contexts
 WHERE conversation_id = $1`;

const DM_RECENT_SQL = `
SELECT space_name, quoted_message_name, context
  FROM quoted_contexts
 WHERE space_name = $1 AND conversation_id <> $2
   AND updated_at > NOW() - make_interval(mins => $3)
 ORDER BY updated_at DESC
 LIMIT 1`;

/** What is stored: the found quote, without the per-turn label. Exported for testing. */
export function toStored(q) {
  return {
    text: q.text ?? null,
    sentAt: q.sentAt ? new Date(q.sentAt).toISOString() : null,
    files: Array.isArray(q.files) ? q.files : [],
    // A DM-fallback copy stays labelled as possibly unrelated in its new thread.
    ...(q.carried === 'dm' ? { fromDm: true } : {})
  };
}

/**
 * Save (or replace) the quote for this conversation.
 * @returns {Promise<boolean>} whether it was saved
 */
export async function saveQuotedContext({ conversationId, spaceName, quotedMessage }, runQuery = defaultQuery) {
  if (!conversationId || !spaceName || !quotedMessage?.messageName) return false;
  try {
    await runQuery(SAVE_SQL, [conversationId, spaceName, quotedMessage.messageName, JSON.stringify(toStored(quotedMessage))]);
    return true;
  } catch (err) {
    if (err?.code !== '42P01') console.warn(`⚠️  Quoted context: not saved — code: ${codeOf(err)}`);
    return false;
  }
}

/** A stored row → the shape quotedContextBlock reads. */
function fromRow(row, carried) {
  const c = typeof row.context === 'string' ? JSON.parse(row.context) : (row.context || {});
  return {
    messageName: row.quoted_message_name,
    spaceName: row.space_name,
    text: c.text ?? null,
    sentAt: c.sentAt ? new Date(c.sentAt) : null,
    readCode: null,
    files: Array.isArray(c.files) ? c.files : [],
    carried: c.fromDm ? 'dm' : carried
  };
}

/**
 * The quote this conversation started from, or (DM only) the newest recent one
 * in the same DM. Null when there is none.
 *
 * @param {Object} p
 * @param {string} p.conversationId
 * @param {string|null} p.spaceName - the event's space resource name
 * @param {boolean} [p.isDm]
 * @param {Object} [deps] - {runQuery, findFiles}, for tests
 * @returns {Promise<Object|null>} a quotedMessage with `carried: 'thread' | 'dm'`
 */
export async function loadQuotedContext(
  { conversationId, spaceName, isDm = false },
  { runQuery = defaultQuery, findFiles = findSweepFiles } = {}
) {
  if (!conversationId) return null;
  let q = null;
  try {
    const own = (await runQuery(LOAD_SQL, [conversationId])).rows?.[0];
    if (own) {
      q = fromRow(own, 'thread');
    } else if (isDm && spaceName) {
      const recent = (await runQuery(DM_RECENT_SQL, [spaceName, conversationId, DM_FALLBACK_MINUTES])).rows?.[0];
      if (recent) q = fromRow(recent, 'dm');
    }
  } catch (err) {
    if (err?.code !== '42P01') console.warn(`⚠️  Quoted context: load failed — code: ${codeOf(err)}`);
    return null;
  }
  if (!q) return null;

  // Refresh a sweep card's files (a database read, not the Chat API); keep the
  // saved list when the lookup finds nothing, which is also what an error gives.
  if (q.files.length && q.spaceName) {
    const fresh = await findFiles({ spaceName: q.spaceName, messageName: q.messageName }, runQuery);
    if (fresh.length) q.files = fresh;
  }

  // The DM fallback follows the person into the new thread (and keeps its window open).
  if (q.carried === 'dm') await saveQuotedContext({ conversationId, spaceName: q.spaceName, quotedMessage: q }, runQuery);
  return q;
}
