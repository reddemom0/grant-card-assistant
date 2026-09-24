/**
 * /learn-this — the team teaches Oracle from a Chat thread
 *
 * The Chat adapter (src/api/chat-google.js) recognises the command, reads the
 * thread as the person asking, and runs Oracle once in learn mode with a
 * restricted tool set. Oracle checks each lesson and saves it with
 * save_team_lesson. Where the lesson came from — space, thread, link, who asked —
 * is taken from the verified Chat event, never from the model.
 */

import { saveLesson, LESSON_STATUSES } from '../database/team-lessons-store.js';
import { threadLink } from './chat-history.js';

/**
 * The command. The slash form counts anywhere in the message, as its own word —
 * people write the lesson first and add "/learn-this" at the end. The plain form
 * ("learn this") counts only at the start, so "can you learn this" is a question.
 */
const SLASH_COMMAND = /(^|\s)\/learn[\s-]?this(?=$|[\s.,!?;:])/gi;
const PLAIN_COMMAND = /^\s*learn[\s-]this(?=$|[\s.,!?;:])/i;

/**
 * Is this @Oracle message the /learn-this command?
 * @param {string} text - message text with the @mention stripped
 * @returns {boolean}
 */
export function learnIntent(text) {
  const t = String(text || '');
  return new RegExp(SLASH_COMMAND.source, 'i').test(t) || PLAIN_COMMAND.test(t);
}

/**
 * The only tools a learn run may use: reading, checking, and saving the lesson.
 * Nothing that sends, posts, creates, or edits.
 */
export const LEARN_MODE_TOOLS = [
  'web_search', 'web_fetch',
  'load_skill',
  'search_google_drive', 'read_google_drive_file', 'list_files_in_folder',
  'read_sheet_metadata', 'read_sheet_range',
  'search_oracle_kb',
  'save_team_lesson'
];

/**
 * The message with the command taken out, wherever it was:
 * "Pivot costs exclude X. /learn-this" → "Pivot costs exclude X."
 * @param {string} text
 * @returns {string}
 */
export function textWithoutCommand(text) {
  return String(text || '')
    .replace(SLASH_COMMAND, '$1')
    .replace(PLAIN_COMMAND, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

/**
 * The message Oracle runs on for /learn-this: the fixed instruction and what to
 * learn from. Attachment text goes separately, as attachment blocks.
 *
 * In a space the source is the thread. In a DM it is the person's own message:
 * the text after the command, or their recent messages when the command is alone.
 *
 * @param {Array<{sender: string, time: string, text: string, files: string[]}>} messages - oldest first
 * @param {string} askerText - the /learn-this message itself
 * @param {Object} [opts]
 * @param {boolean} [opts.dm] - taught in a direct message
 * @returns {string}
 */
export function buildLearnMessage(messages, askerText = '', { dm = false } = {}) {
  const extra = textWithoutCommand(askerText);
  const transcript = messages.map(m => {
    const files = m.files?.length ? ` [attached: ${m.files.join(', ')}]` : '';
    return `- ${m.sender} (${m.time || 'undated'}): ${m.text || '(no text)'}${files}`;
  }).join('\n');
  if (dm) {
    return [
      '[/learn-this in a direct message — follow the "Team lessons (/learn-this)" rules in your instructions. The person below is the one teaching.]',
      '',
      'What they sent, oldest first:',
      transcript || '(nothing to learn from — no text after the command and no recent messages)'
    ].join('\n');
  }
  return [
    '[/learn-this — follow the "Team lessons (/learn-this)" rules in your instructions.]',
    extra ? `The person who asked added: ${extra}` : '',
    '',
    'Thread transcript, oldest first:',
    transcript || '(the thread has no messages I can read)'
  ].filter(line => line !== '').join('\n');
}

/**
 * The row to save for one lesson, or the reason it can't be saved. Pure, so the
 * rules are testable without a database.
 *
 * Where the lesson came from is taken from the verified Chat event. A DM lesson
 * has no thread anyone else can open, so it gets no thread name or link, and the
 * person in the DM is always the one who taught it.
 *
 * @param {Object} input - lesson, skill, topic, status, source_label, source_url, taught_by_name, taught_at
 * @param {Object} ctx - { userId, chatContext }
 * @returns {{row?: Object, error?: string}}
 */
export function lessonRow(input = {}, { userId, chatContext } = {}) {
  if (!chatContext?.learnMode) {
    return { error: 'Lessons are saved only when someone uses /learn-this in Chat.' };
  }
  const dm = chatContext.surface === 'chat_dm';
  if (!chatContext.spaceName || (!dm && !chatContext.threadName)) {
    return { error: 'This lesson has no Chat thread to link back to, so it was not saved.' };
  }

  const lesson = String(input.lesson || '').trim();
  const topic = String(input.topic || '').trim();
  const status = String(input.status || '').trim();
  if (!lesson || !topic) return { error: 'A lesson needs both the lesson text and a short topic.' };
  if (!LESSON_STATUSES.includes(status)) {
    return { error: `status must be one of: ${LESSON_STATUSES.join(', ')}.` };
  }
  if ((status === 'verified' || status === 'conflict') && !input.source_label && !input.source_url) {
    return { error: `A ${status} lesson needs the source it was checked against (source_label or source_url).` };
  }

  return {
    row: {
      lesson,
      topic,
      status,
      skill: input.skill ? String(input.skill).trim() : null,
      source_label: input.source_label || null,
      source_url: input.source_url || null,
      taught_by_name: dm ? (chatContext.senderDisplayName || input.taught_by_name || null) : (input.taught_by_name || null),
      taught_at: input.taught_at || null,
      captured_by: userId || null,
      space_name: chatContext.spaceName,
      thread_name: dm ? null : chatContext.threadName,
      thread_link: dm ? null : threadLink(chatContext.spaceName, chatContext.threadName),
      taught_in: dm ? 'dm' : 'space'
    }
  };
}

/**
 * Tool: save one checked lesson. Only works inside a /learn-this run.
 *
 * @param {Object} input - lesson, skill, topic, status, source_label, source_url, taught_by_name, taught_at
 * @param {Object} ctx - { userId, chatContext }
 */
export async function saveTeamLesson(input = {}, ctx = {}) {
  const { row, error } = lessonRow(input, ctx);
  if (error) return { success: false, error };
  const { id } = await saveLesson(row);
  console.log(`🧠 Team lesson saved — id ${id}, status ${row.status}, taught in ${row.taught_in}`);
  return { success: true, id, status: row.status };
}
