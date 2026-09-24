/**
 * Team lessons — what the team taught Oracle with "@Oracle /learn-this"
 *
 * Table from migrations/035_team_lessons.sql. Lessons are written only by the
 * save_team_lesson tool during a /learn-this run, and read back into every
 * Oracle run as one labelled "Team notes" block, grouped by skill, in runAgent's
 * learning step (src/claude/client.js) — whichever skill files that run loads.
 * Official sources always win over them.
 */

import { query } from './connection.js';

export const LESSON_STATUSES = ['verified', 'unverified', 'conflict'];

/** Lessons injected into every Oracle run are capped; newest first. */
const MAX_PROMPT_LESSONS = 40;

/**
 * Save one lesson.
 * @param {Object} row - team_lessons columns (id and created_at are set here)
 * @returns {Promise<{id: number}>}
 */
export async function saveLesson(row) {
  const result = await query(
    `INSERT INTO team_lessons
       (lesson, skill, topic, status, source_label, source_url, taught_by_name, taught_at,
        captured_by, space_name, thread_name, thread_link, taught_in)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      row.lesson, row.skill || null, row.topic, row.status,
      row.source_label || null, row.source_url || null,
      row.taught_by_name || null, row.taught_at || null,
      row.captured_by || null, row.space_name, row.thread_name || null, row.thread_link || null,
      row.taught_in === 'dm' ? 'dm' : 'space'
    ]
  );
  return { id: result.rows[0]?.id };
}

/**
 * Every active lesson, general and skill-tagged, newest first, capped. Oracle
 * gets them all in one block, so a lesson doesn't depend on which skill file
 * the model happens to load.
 * @returns {Promise<Array>}
 */
export async function activeLessons() {
  const result = await query(
    `SELECT * FROM team_lessons WHERE retired_at IS NULL
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
function statusLabel(row) {
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
