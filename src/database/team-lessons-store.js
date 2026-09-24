/**
 * Team lessons — what the team taught Oracle with "@Oracle /learn-this"
 *
 * Table from migrations/035_team_lessons.sql. Lessons are written only by the
 * save_team_lesson tool during a /learn-this run, and read back into answers
 * labelled as team notes: skill-tagged ones when that skill's overview loads
 * (src/tools/load-skill.js), general ones in runAgent's learning step
 * (src/claude/client.js). Official sources always win over them.
 */

import { query } from './connection.js';

export const LESSON_STATUSES = ['verified', 'unverified', 'conflict'];

/** General lessons injected into every Oracle run are capped; newest first. */
const MAX_GENERAL_LESSONS = 20;
/** Lessons appended to one skill's overview. */
const MAX_SKILL_LESSONS = 30;

/**
 * Save one lesson.
 * @param {Object} row - team_lessons columns (id and created_at are set here)
 * @returns {Promise<{id: number}>}
 */
export async function saveLesson(row) {
  const result = await query(
    `INSERT INTO team_lessons
       (lesson, skill, topic, status, source_label, source_url, taught_by_name, taught_at,
        captured_by, space_name, thread_name, thread_link)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      row.lesson, row.skill || null, row.topic, row.status,
      row.source_label || null, row.source_url || null,
      row.taught_by_name || null, row.taught_at || null,
      row.captured_by || null, row.space_name, row.thread_name, row.thread_link
    ]
  );
  return { id: result.rows[0]?.id };
}

/**
 * Active lessons for one skill, or general lessons when skill is null.
 * @param {Object} opts
 * @param {string|null} opts.skill
 * @returns {Promise<Array>}
 */
export async function activeLessons({ skill = null } = {}) {
  const result = skill
    ? await query(
      `SELECT * FROM team_lessons WHERE skill = $1 AND retired_at IS NULL
       ORDER BY created_at DESC LIMIT $2`,
      [skill, MAX_SKILL_LESSONS]
    )
    : await query(
      `SELECT * FROM team_lessons WHERE skill IS NULL AND retired_at IS NULL
       ORDER BY created_at DESC LIMIT $1`,
      [MAX_GENERAL_LESSONS]
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
  const lines = rows.map(r =>
    `- Team note from ${r.taught_by_name || 'a team member'}, ${shortDate(r.taught_at || r.created_at)} (${statusLabel(r)}) — ${r.topic}: ${r.lesson} — thread: ${r.thread_link}`
  );
  return [
    '## Team notes (taught in Chat — not official)',
    '',
    'Taught by the team with /learn-this. Use one when it is relevant, and label it the way it is labelled here. Official sources win: where a note conflicts with the program notes, a guide, or another official source, give the official fact and mention the note as conflicting.',
    '',
    ...lines
  ].join('\n');
}
