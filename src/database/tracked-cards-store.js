/**
 * Tracked cards — all SQL for src/cards/
 *
 * Tables from migrations/030_tracked_cards.sql. query()/transaction() log a
 * statement label and error code only, so card titles, pre-check text and
 * emails never reach the log from here.
 */

import { query } from './connection.js';

const LIVE = ['offered', 'awaiting_docs', 'open', 'stale'];

// Columns updateCard() may set, mapped from the camelCase field names callers use.
const CARD_FIELDS = {
  status: 'status',
  title: 'title',
  data: 'data',
  messageName: 'message_name',
  ownerChatId: 'owner_chat_id',
  ownerUserId: 'owner_user_id',
  sourceMessageName: 'source_message_name',
  conversationId: 'conversation_id',
  lastActivityAt: 'last_activity_at',
  staleSince: 'stale_since',
  closedAt: 'closed_at',
  closedReason: 'closed_reason',
  lastRefreshedAt: 'last_refreshed_at',
  completedAt: 'completed_at',
  dueAt: 'due_at'
};

// ============================================================================
// CARDS
// ============================================================================

/**
 * Insert a card. Returns null when a live card of this type already exists for
 * the thread — the partial unique index decides, so two concurrent requests
 * cannot both create one.
 */
export async function insertCard({
  cardType, status, spaceName, threadName, sourceMessageName = null,
  conversationId = null, ownerChatId, ownerUserId = null, title = null, data = {}
}) {
  const r = await query(
    `INSERT INTO tracked_cards
       (card_type, status, space_name, thread_name, source_message_name,
        conversation_id, owner_chat_id, owner_user_id, title, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (card_type, thread_name) WHERE status <> 'closed' DO NOTHING
     RETURNING *`,
    [cardType, status, spaceName, threadName, sourceMessageName,
      conversationId, ownerChatId, ownerUserId, title, JSON.stringify(data)]
  );
  return r.rows[0] || null;
}

export async function getCard(id) {
  const r = await query('SELECT * FROM tracked_cards WHERE id = $1', [id]);
  return r.rows[0] || null;
}

export async function findLiveCard(cardType, threadName) {
  const r = await query(
    `SELECT * FROM tracked_cards
     WHERE card_type = $1 AND thread_name = $2 AND status <> 'closed'`,
    [cardType, threadName]
  );
  return r.rows[0] || null;
}

/** Set any of CARD_FIELDS. Returns the updated row. */
export async function updateCard(id, fields) {
  const sets = [];
  const params = [id];
  for (const [key, value] of Object.entries(fields)) {
    const column = CARD_FIELDS[key];
    if (!column) throw new Error(`updateCard: unknown field ${key}`);
    params.push(key === 'data' ? JSON.stringify(value) : value);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length === 0) return getCard(id);
  const r = await query(
    `UPDATE tracked_cards SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    params
  );
  return r.rows[0] || null;
}

/**
 * Merge top-level keys into a card's data, atomically: presses, refreshes, typed
 * commands and the listened-space hook can all write the same card, and a
 * read-modify-write would lose one of them. Other CARD_FIELDS may be set too.
 */
export async function patchCardData(id, patch, fields = {}) {
  const sets = ['data = data || $2::jsonb'];
  const params = [id, JSON.stringify(patch || {})];
  for (const [key, value] of Object.entries(fields)) {
    const column = CARD_FIELDS[key];
    if (!column || key === 'data') throw new Error(`patchCardData: unknown field ${key}`);
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  const r = await query(
    `UPDATE tracked_cards SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    params
  );
  return r.rows[0] || null;
}

/** Record a human action on a live card. A stale card becomes open again. */
export async function touchActivity(id, at = new Date()) {
  const r = await query(
    `UPDATE tracked_cards
     SET last_activity_at = $2,
         status = CASE WHEN status = 'stale' THEN 'open' ELSE status END,
         stale_since = CASE WHEN status = 'stale' THEN NULL ELSE stale_since END,
         updated_at = NOW()
     WHERE id = $1 AND status <> 'closed'
     RETURNING *`,
    [id, at]
  );
  return r.rows[0] || null;
}

export async function closeCard(id, reason, at = new Date()) {
  const r = await query(
    `UPDATE tracked_cards
     SET status = 'closed', closed_at = $2, closed_reason = $3, updated_at = NOW()
     WHERE id = $1 AND status <> 'closed'
     RETURNING *`,
    [id, at, reason]
  );
  return r.rows[0] || null;
}

export async function listCardsByStatus(statuses) {
  const r = await query(
    'SELECT * FROM tracked_cards WHERE status = ANY($1::text[]) ORDER BY created_at',
    [statuses]
  );
  return r.rows;
}

/** Open cards idle since before `cutoff` become stale. Returns the rows changed. */
export async function markStaleBefore(cutoff, at = new Date(), { onlyTypes = null, exceptTypes = null } = {}) {
  const r = await query(
    `UPDATE tracked_cards
     SET status = 'stale', stale_since = $2, updated_at = NOW()
     WHERE status = 'open' AND last_activity_at < $1
       AND ($3::text[] IS NULL OR card_type = ANY($3))
       AND ($4::text[] IS NULL OR card_type <> ALL($4))
     RETURNING *`,
    [cutoff, at, onlyTypes, exceptTypes]
  );
  return r.rows;
}

/** Stale cards unanswered since before `cutoff` close. Returns the rows changed. */
export async function closeStaleBefore(cutoff, at = new Date()) {
  const r = await query(
    `UPDATE tracked_cards
     SET status = 'closed', closed_at = $2, closed_reason = 'auto_stale', updated_at = NOW()
     WHERE status = 'stale' AND stale_since < $1
     RETURNING *`,
    [cutoff, at]
  );
  return r.rows;
}

/** Live cards of one type. */
export async function liveCardsOfType(cardType) {
  const r = await query(
    `SELECT * FROM tracked_cards WHERE card_type = $1 AND status IN ('open', 'stale') ORDER BY created_at`,
    [cardType]
  );
  return r.rows;
}

/** Open or stale cards of any type in one thread. */
export async function liveCardsInThread(threadName) {
  const r = await query(
    `SELECT * FROM tracked_cards WHERE thread_name = $1 AND status IN ('open', 'stale') ORDER BY created_at`,
    [threadName]
  );
  return r.rows;
}

/** Set (or clear) a card's due date; both "already sent" markers start over. */
export async function setDue(id, dueAt) {
  const r = await query(
    `UPDATE tracked_cards
     SET due_at = $2, due_reminded_at = NULL, due_summary_sent_at = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, dueAt]
  );
  return r.rows[0] || null;
}

/** Live cards of one type with a due date before `until`. */
export async function dueCardsOfType(cardType, until) {
  const r = await query(
    `SELECT * FROM tracked_cards
     WHERE card_type = $1 AND status IN ('open', 'stale')
       AND due_at IS NOT NULL AND due_at <= $2
     ORDER BY due_at`,
    [cardType, until]
  );
  return r.rows;
}

/** Claim the due-today reminder. True only for the first caller. */
export async function claimDueReminder(id, at = new Date()) {
  const r = await query(
    `UPDATE tracked_cards SET due_reminded_at = $2
     WHERE id = $1 AND due_reminded_at IS NULL AND status IN ('open', 'stale')
     RETURNING id`,
    [id, at]
  );
  return r.rowCount > 0;
}

/** Claim the requester's due-date summary. True only for the first caller. */
export async function claimDueSummary(id, at = new Date()) {
  const r = await query(
    `UPDATE tracked_cards SET due_summary_sent_at = $2
     WHERE id = $1 AND due_summary_sent_at IS NULL AND status IN ('open', 'stale')
     RETURNING id`,
    [id, at]
  );
  return r.rowCount > 0;
}

/**
 * Decisions recorded on track cards in one space, open or closed, most recent
 * first. The text is what a person typed into the card.
 */
export async function decisionsForSpace(spaceName, since = null, until = null, limit = 50) {
  const r = await query(
    `SELECT id, space_name, thread_name, title, data->'decision' AS decision
     FROM tracked_cards
     WHERE space_name = $1 AND card_type = 'track'
       AND data->'decision'->>'text' IS NOT NULL
       AND ($2::timestamptz IS NULL OR (data->'decision'->>'at')::timestamptz >= $2)
       AND ($3::timestamptz IS NULL OR (data->'decision'->>'at')::timestamptz <= $3)
     ORDER BY (data->'decision'->>'at')::timestamptz DESC
     LIMIT $4`,
    [spaceName, since, until, limit]
  );
  return r.rows;
}

/** Delete cards closed before `cutoff` (participants and clicks go with them). */
export async function purgeClosedBefore(cutoff) {
  const r = await query(
    `DELETE FROM tracked_cards WHERE status = 'closed' AND closed_at < $1`,
    [cutoff]
  );
  return r.rowCount;
}

/** Live cards completed before `cutoff` close. Returns the rows changed. */
export async function closeCompletedBefore(cutoff, at = new Date()) {
  const r = await query(
    `UPDATE tracked_cards
     SET status = 'closed', closed_at = $2, closed_reason = 'completed', updated_at = NOW()
     WHERE status IN ('open', 'stale') AND completed_at < $1
     RETURNING *`,
    [cutoff, at]
  );
  return r.rows;
}

/** Open or stale cards in one Oracle conversation (a Chat thread). */
export async function liveCardsForConversation(conversationId) {
  const r = await query(
    `SELECT * FROM tracked_cards
     WHERE conversation_id = $1 AND status IN ('open', 'stale')
     ORDER BY created_at`,
    [conversationId]
  );
  return r.rows;
}

/** Offers nobody answered since before `cutoff` close. Returns the rows changed. */
export async function closeOffersBefore(cutoff, at = new Date()) {
  const r = await query(
    `UPDATE tracked_cards
     SET status = 'closed', closed_at = $2, closed_reason = 'offer_expired', updated_at = NOW()
     WHERE status IN ('offered', 'awaiting_docs') AND last_activity_at < $1
     RETURNING *`,
    [cutoff, at]
  );
  return r.rows;
}

// ============================================================================
// PARTICIPANTS
// ============================================================================

/**
 * Add people to a card. An existing row keeps its status and mute setting;
 * only the display name is refreshed, and only a reviewer role replaces
 * another. A reviewer starts not_started unless a status is given.
 * @param {Array<{chatUserId: string, role: string, displayName?: string, status?: string}>} people
 */
export async function addParticipants(cardId, people) {
  for (const p of people) {
    const status = p.status ?? (p.role === 'reviewer' ? 'not_started' : null);
    await query(
      `INSERT INTO tracked_card_participants (card_id, chat_user_id, role, display_name, status, status_changed_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() END)
       ON CONFLICT (card_id, chat_user_id) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, tracked_card_participants.display_name),
         role = CASE WHEN EXCLUDED.role = 'reviewer' THEN 'reviewer' ELSE tracked_card_participants.role END,
         status = COALESCE(tracked_card_participants.status, EXCLUDED.status)`,
      [cardId, p.chatUserId, p.role, p.displayName || null, status]
    );
  }
}

/**
 * Change ONE member's own checklist status (track, everyone shape). Returns
 * false when the person has no member row on this card.
 */
export async function setMemberStatus(cardId, chatUserId, status, at = new Date()) {
  const r = await query(
    `UPDATE tracked_card_participants
     SET status = $3, status_changed_at = $4
     WHERE card_id = $1 AND chat_user_id = $2 AND role = 'member'`,
    [cardId, chatUserId, status, at]
  );
  return r.rowCount > 0;
}

/** Take someone off a card. The owner cannot be removed. */
export async function removeParticipant(cardId, chatUserId) {
  const r = await query(
    `DELETE FROM tracked_card_participants
     WHERE card_id = $1 AND chat_user_id = $2 AND role <> 'owner'`,
    [cardId, chatUserId]
  );
  return r.rowCount > 0;
}

export async function getParticipants(cardId) {
  const r = await query(
    `SELECT * FROM tracked_card_participants WHERE card_id = $1
     ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, display_name NULLS LAST, chat_user_id`,
    [cardId]
  );
  return r.rows;
}

/**
 * Change ONE reviewer's own status. Returns false when the person is not a
 * reviewer on this card — a personal button can only move its presser.
 */
export async function setReviewerStatus(cardId, chatUserId, status, at = new Date()) {
  const r = await query(
    `UPDATE tracked_card_participants
     SET status = $3, status_changed_at = $4
     WHERE card_id = $1 AND chat_user_id = $2 AND role = 'reviewer'`,
    [cardId, chatUserId, status, at]
  );
  return r.rowCount > 0;
}

/** Mute or unmute a card for one participant. Returns false if they aren't one. */
export async function setMuted(cardId, chatUserId, muted) {
  const r = await query(
    `UPDATE tracked_card_participants SET muted = $3
     WHERE card_id = $1 AND chat_user_id = $2`,
    [cardId, chatUserId, muted]
  );
  return r.rowCount > 0;
}

/**
 * Claim today's notice for one person on one card. True only for the first
 * caller on that local date, so several things happening at once become one DM.
 */
export async function claimParticipantNotice(cardId, chatUserId, localDate) {
  const r = await query(
    `UPDATE tracked_card_participants SET notified_on = $3::date
     WHERE card_id = $1 AND chat_user_id = $2
       AND (notified_on IS NULL OR notified_on < $3::date)`,
    [cardId, chatUserId, localDate]
  );
  return r.rowCount > 0;
}

export async function markAssignedNotified(cardId, chatUserId, at = new Date()) {
  await query(
    `UPDATE tracked_card_participants SET assigned_notified_at = $3
     WHERE card_id = $1 AND chat_user_id = $2`,
    [cardId, chatUserId, at]
  );
}

// ============================================================================
// CLICKS
// ============================================================================

/**
 * Log a press. `result` is 'changed', 'unchanged', or the reason it was ignored.
 */
export async function logClick(cardId, { chatUserId, name = null }, action, at = new Date(), result = 'changed') {
  await query(
    `INSERT INTO tracked_card_clicks (card_id, actor_chat_id, actor_name, action, result, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [cardId, chatUserId, name, action, result, at]
  );
}

/**
 * The press the card shows as its last update: the latest one that changed
 * something. A mute is personal, so it is never shown to the thread.
 */
export async function latestClick(cardId) {
  const r = await query(
    `SELECT * FROM tracked_card_clicks
     WHERE card_id = $1 AND result = 'changed' AND action <> 'card.mute'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [cardId]
  );
  return r.rows[0] || null;
}

// ============================================================================
// PEOPLE
// ============================================================================

export async function getPerson(chatUserId) {
  const r = await query('SELECT * FROM chat_people WHERE chat_user_id = $1', [chatUserId]);
  return r.rows[0] || null;
}

/** Insert or update what is known about a person. NULL fields never erase known values. */
export async function upsertPerson({ chatUserId, userId = null, email = null, displayName = null }) {
  const r = await query(
    `INSERT INTO chat_people (chat_user_id, user_id, email, display_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (chat_user_id) DO UPDATE SET
       user_id = COALESCE(EXCLUDED.user_id, chat_people.user_id),
       email = COALESCE(EXCLUDED.email, chat_people.email),
       display_name = COALESCE(EXCLUDED.display_name, chat_people.display_name),
       updated_at = NOW()
     RETURNING *`,
    [chatUserId, userId, email, displayName]
  );
  return r.rows[0];
}

export async function setPersonTimeZone(chatUserId, timeZone, at = new Date()) {
  await query(
    `UPDATE chat_people SET time_zone = $2, time_zone_checked_at = $3, updated_at = NOW()
     WHERE chat_user_id = $1`,
    [chatUserId, timeZone, at]
  );
}

export async function setPersonDm(chatUserId, dmSpaceName, at = new Date()) {
  await query(
    `UPDATE chat_people SET dm_space_name = $2, dm_checked_at = $3, updated_at = NOW()
     WHERE chat_user_id = $1`,
    [chatUserId, dmSpaceName, at]
  );
}

/** The active Hub user for a known Hub id, a Chat id or an email — in that order of preference. */
export async function findHubUser({ chatUserId = null, email = null, userId = null }) {
  const r = await query(
    `SELECT id, email, name FROM users
     WHERE is_active = true
       AND (($3::int IS NOT NULL AND id = $3)
         OR ($1::text IS NOT NULL AND chat_user_id = $1)
         OR ($2::text IS NOT NULL AND LOWER(email) = LOWER($2)))
     ORDER BY (id = $3) DESC NULLS LAST, (chat_user_id = $1) DESC NULLS LAST
     LIMIT 1`,
    [chatUserId, email, userId]
  );
  return r.rows[0] || null;
}

/** Remember a Hub user's Chat id. */
export async function setUserChatId(userId, chatUserId) {
  await query(
    'UPDATE users SET chat_user_id = $2 WHERE id = $1 AND chat_user_id IS DISTINCT FROM $2',
    [userId, chatUserId]
  );
}

// ============================================================================
// DIGEST
// ============================================================================

/** Everyone with something that could go in a digest. */
export async function digestCandidates() {
  const r = await query(
    `SELECT DISTINCT p.chat_user_id
     FROM tracked_card_participants p
     JOIN tracked_cards c ON c.id = p.card_id
     WHERE c.status IN ('open', 'stale') AND p.muted = false
     UNION
     SELECT DISTINCT c.owner_chat_id FROM tracked_cards c WHERE c.status = 'stale'`
  );
  return r.rows.map(row => row.chat_user_id);
}

/** Cards where this person is a reviewer who is not done. */
export async function waitingOn(chatUserId) {
  const r = await query(
    `SELECT c.*, p.status AS my_status
     FROM tracked_cards c
     JOIN tracked_card_participants p ON p.card_id = c.id
     WHERE p.chat_user_id = $1 AND p.role = 'reviewer' AND p.muted = false
       AND p.status <> 'done' AND c.status IN ('open', 'stale')
     ORDER BY c.created_at`,
    [chatUserId]
  );
  return r.rows;
}

/**
 * Cards this person owns, by status. A completed card is included until a
 * digest has shown it — and still on that digest's own local day, so pressing a
 * button on that digest re-renders it unchanged.
 */
export async function ownedBy(chatUserId, statuses, localDate = null) {
  const r = await query(
    `SELECT c.*
     FROM tracked_cards c
     LEFT JOIN tracked_card_participants p ON p.card_id = c.id AND p.chat_user_id = c.owner_chat_id
     WHERE c.owner_chat_id = $1 AND c.status = ANY($2::text[])
       AND (c.status = 'stale' OR COALESCE(p.muted, false) = false)
       AND (c.completed_at IS NULL OR c.completion_shown_on IS NULL OR c.completion_shown_on = $3::date)
     ORDER BY c.created_at`,
    [chatUserId, statuses, localDate]
  );
  return r.rows;
}

/** Remember that a digest dated `localDate` showed these cards' completion. */
export async function markCompletionShown(cardIds, localDate) {
  if (!cardIds.length) return;
  await query(
    `UPDATE tracked_cards SET completion_shown_on = $2, updated_at = NOW()
     WHERE id = ANY($1::uuid[]) AND completed_at IS NOT NULL AND completion_shown_on IS NULL`,
    [cardIds, localDate]
  );
}

export async function digestSent(chatUserId, localDate) {
  const r = await query(
    'SELECT 1 FROM tracked_card_digests WHERE chat_user_id = $1 AND local_date = $2',
    [chatUserId, localDate]
  );
  return r.rowCount > 0;
}

/** Record a digest. Returns false if one was already recorded for that day. */
export async function recordDigest(chatUserId, localDate, messageName = null) {
  const r = await query(
    `INSERT INTO tracked_card_digests (chat_user_id, local_date, message_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (chat_user_id, local_date) DO NOTHING`,
    [chatUserId, localDate, messageName]
  );
  return r.rowCount > 0;
}

// ============================================================================
// INTROS (migration 034)
// ============================================================================

/**
 * Claim the right to introduce Oracle in this space (or DM). The first caller
 * wins; everyone else gets false and posts nothing.
 * @param {string} spaceName
 * @param {'space'|'dm'} [kind]
 */
export async function claimSpaceIntro(spaceName, kind = 'space') {
  if (!spaceName) return false;
  const r = await query(
    `INSERT INTO space_intros (space_name, kind)
     VALUES ($1, $2)
     ON CONFLICT (space_name) DO NOTHING
     RETURNING space_name`,
    [spaceName, kind]
  );
  return r.rowCount > 0;
}

/** Has Oracle already introduced itself here? */
export async function spaceIntro(spaceName) {
  if (!spaceName) return null;
  const r = await query('SELECT * FROM space_intros WHERE space_name = $1', [spaceName]);
  return r.rows[0] || null;
}

/** Posting failed: give the claim back, so the next pass can try again. */
export async function releaseSpaceIntro(spaceName) {
  if (!spaceName) return;
  await query('DELETE FROM space_intros WHERE space_name = $1', [spaceName]);
}

export async function setSpaceIntroMessage(spaceName, messageName) {
  await query('UPDATE space_intros SET message_name = $2 WHERE space_name = $1', [spaceName, messageName]);
}

// ============================================================================
// REAL SOURCES
// ============================================================================

/** The confirmation gate's view of a proposal: status and result. */
export async function pendingActionState(actionId) {
  if (!actionId) return null;
  const r = await query(
    `SELECT status, result, expires_at FROM pending_actions WHERE id = $1`,
    [actionId]
  );
  return r.rows[0] || null;
}

export { LIVE as LIVE_STATUSES };
