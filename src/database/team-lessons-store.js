/**
 * Team lessons — what the team taught Oracle with "@Oracle /learn-this"
 *
 * Table from migrations/035–037. Lessons are written only by the save_team_lesson
 * tool during a /learn-this run, always as 'pending': nothing is used in answers
 * until the teacher confirms it on the lesson card (src/cards/lesson-card.js).
 * Unconfirmed lessons expire after 24 hours. Active lessons are read back into every
 * Oracle run as one labelled "Team notes" block, grouped by skill, in runAgent's
 * learning step (src/claude/client.js) — whichever skill files that run loads.
 * Official sources always win over them.
 */

import { query } from './connection.js';

export const LESSON_STATUSES = ['verified', 'unverified', 'conflict'];

/** A pending lesson not confirmed within this long is deleted (hourly job). */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** At most this many pending lessons on one card. */
export const MAX_PENDING_PER_CARD = 10;

/** Lessons injected into every Oracle run are capped; newest first. */
const MAX_PROMPT_LESSONS = 40;

/**
 * Save one lesson as pending, waiting for the teacher to confirm it on the card.
 * @param {Object} row - team_lessons columns (id and created_at are set here)
 * @returns {Promise<{id: number}>}
 */
export async function saveLesson(row) {
  const result = await query(
    `INSERT INTO team_lessons
       (lesson, skill, topic, status, source_label, source_url, taught_by_name, taught_at,
        captured_by, space_name, thread_name, thread_link, taught_in,
        state, expires_at, card_id, from_document)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', $14, $15, $16)
     RETURNING id`,
    [
      row.lesson, row.skill || null, row.topic, row.status,
      row.source_label || null, row.source_url || null,
      row.taught_by_name || null, row.taught_at || null,
      row.captured_by || null, row.space_name, row.thread_name || null, row.thread_link || null,
      row.taught_in === 'dm' ? 'dm' : 'space',
      row.expires_at, row.card_id || null, row.from_document || null
    ]
  );
  return { id: result.rows[0]?.id };
}

/** Pending lessons on one card, oldest first (the card's lesson numbering). */
export async function pendingForCard(cardId) {
  const r = await query(
    `SELECT * FROM team_lessons WHERE card_id = $1 AND state = 'pending' ORDER BY id`,
    [cardId]
  );
  return r.rows;
}

/** Every lesson on one card, pending or confirmed, oldest first. */
export async function lessonsForCard(cardId) {
  const r = await query(`SELECT * FROM team_lessons WHERE card_id = $1 ORDER BY id`, [cardId]);
  return r.rows;
}

/** How many pending lessons a card holds, for the cap. */
export async function countPendingForCard(cardId) {
  const r = await query(
    `SELECT count(*)::int AS n FROM team_lessons WHERE card_id = $1 AND state = 'pending'`,
    [cardId]
  );
  return r.rows[0]?.n || 0;
}

/**
 * Make a pending lesson active, optionally with edited text and a new check result.
 * Only a pending lesson can be confirmed. Returns the updated row, or null.
 */
export async function confirmLesson(id, edits = {}) {
  const r = await query(
    `UPDATE team_lessons
     SET state = 'active', confirmed_at = NOW(), expires_at = NULL,
         lesson = COALESCE($2, lesson), status = COALESCE($3, status),
         source_label = COALESCE($4, source_label), source_url = COALESCE($5, source_url)
     WHERE id = $1 AND state = 'pending'
     RETURNING *`,
    [id, edits.lesson ?? null, edits.status ?? null, edits.source_label ?? null, edits.source_url ?? null]
  );
  return r.rows[0] || null;
}

/**
 * Retire a saved lesson: it stops appearing in answers at once (activeLessons
 * reads retired_at IS NULL on every run). Only an active, not-yet-retired lesson.
 * Returns true if one was retired.
 */
export async function retireLesson(id) {
  const r = await query(
    `UPDATE team_lessons SET retired_at = NOW()
     WHERE id = $1 AND state = 'active' AND retired_at IS NULL
     RETURNING id`,
    [id]
  );
  return r.rows.length > 0;
}

/** Delete a pending lesson. Returns true if one was deleted. */
export async function discardLesson(id) {
  const r = await query(`DELETE FROM team_lessons WHERE id = $1 AND state = 'pending' RETURNING id`, [id]);
  return r.rows.length > 0;
}

/**
 * Delete every pending lesson past its expiry. Returns the cards that held them,
 * so they can be re-rendered in place. Nothing is posted.
 */
export async function expirePending(now = new Date()) {
  const r = await query(
    `DELETE FROM team_lessons WHERE state = 'pending' AND expires_at <= $1
     RETURNING id, card_id`,
    [now]
  );
  return {
    expired: r.rows.map(x => x.id),
    cardIds: [...new Set(r.rows.map(x => x.card_id).filter(Boolean))]
  };
}

/** Record, on the card, a lesson that is already in Granted's notes (never stored as a lesson). */
export async function recordKnown(cardId, item) {
  await query(
    `UPDATE tracked_cards
     SET data = jsonb_set(data, '{known}', COALESCE(data->'known', '[]'::jsonb) || $2::jsonb), updated_at = NOW()
     WHERE id = $1`,
    [cardId, JSON.stringify([item])]
  );
}

/** Count, on the card, a lesson refused because the card is full. */
export async function recordOverflow(cardId) {
  await query(
    `UPDATE tracked_cards
     SET data = jsonb_set(data, '{overflow}', to_jsonb(COALESCE((data->>'overflow')::int, 0) + 1)), updated_at = NOW()
     WHERE id = $1`,
    [cardId]
  );
}

/**
 * Every active lesson, general and skill-tagged, newest first, capped. Oracle
 * gets them all in one block, so a lesson doesn't depend on which skill file
 * the model happens to load.
 * @returns {Promise<Array>}
 */
export async function activeLessons() {
  const result = await query(
    `SELECT * FROM team_lessons WHERE state = 'active' AND retired_at IS NULL
     ORDER BY created_at DESC LIMIT $1`,
    [MAX_PROMPT_LESSONS]
  );
  return result.rows;
}

/** "Sept 23" — how a lesson's date appears in a team-note label. */
function shortDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return 'undated';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** The status part of a label: verified or conflicting lessons name their source. */
export function statusLabel(row) {
  if (row.from_document) {
    const base = `from ${row.from_document}, not yet in Granted's notes`;
    return row.status === 'conflict' ? `${base}; conflicts with ${row.source_label || 'Granted\'s notes'}` : base;
  }
  const source = row.source_url ? `${row.source_label || 'source'} (${row.source_url})` : (row.source_label || 'an official source');
  if (row.status === 'verified') return `verified — ${source}`;
  if (row.status === 'conflict') return `conflicts with ${source} — the official source wins`;
  return 'unverified';
}

/**
 * The labelled block the model sees. Empty string when there are no lessons.
 * @param {Array} rows - from activeLessons()
 * @returns {string}
 */
export function formatLessons(rows) {
  if (!rows?.length) return '';
  const line = r => {
    const who = r.taught_by_name || 'a team member';
    const when = shortDate(r.taught_at || r.created_at);
    // A DM has no thread anyone else can open, so it gets no link.
    return r.taught_in === 'dm' || !r.thread_link
      ? `- Team note taught by ${who} in a DM, ${when} (${statusLabel(r)}) — ${r.topic}: ${r.lesson}`
      : `- Team note from ${who}, ${when} (${statusLabel(r)}) — ${r.topic}: ${r.lesson} — thread: ${r.thread_link}`;
  };

  // Grouped by skill, general notes last; within a group, as given (newest first).
  const groups = new Map();
  for (const r of rows) {
    const key = r.skill || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  const sections = keys.flatMap(key => [
    '',
    key ? `### ${key}` : '### General',
    ...groups.get(key).map(line)
  ]);

  return [
    '## Team notes (taught in Chat — not official)',
    '',
    'Taught by the team with /learn-this. Use one when it is relevant, and label it the way it is labelled here. Official sources win: where a note conflicts with the program notes, a guide, or another official source, give the official fact and mention the note as conflicting.',
    ...sections
  ].join('\n');
}
