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

/** "/learn-this", "learn this", "learn-this" at the start of the message. */
const LEARN = /^\s*\/?learn[\s-]this\b/i;

/**
 * Is this @Oracle message the /learn-this command?
 * @param {string} text - message text with the @mention stripped
 * @returns {boolean}
 */
export function learnIntent(text) {
  return LEARN.test(String(text || ''));
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
 * The message Oracle runs on for /learn-this: the fixed instruction and the
 * thread transcript. Attachment text goes separately, as attachment blocks.
 *
 * @param {Array<{sender: string, time: string, text: string, files: string[]}>} messages - oldest first
 * @param {string} askerText - anything the person added after /learn-this
 * @returns {string}
 */
export function buildLearnMessage(messages, askerText = '') {
  const extra = String(askerText || '').replace(LEARN, '').trim();
  const transcript = messages.map(m => {
    const files = m.files?.length ? ` [attached: ${m.files.join(', ')}]` : '';
    return `- ${m.sender} (${m.time || 'undated'}): ${m.text || '(no text)'}${files}`;
  }).join('\n');
  return [
    '[/learn-this — follow the "Team lessons (/learn-this)" rules in your instructions.]',
    extra ? `The person who asked added: ${extra}` : '',
    '',
    'Thread transcript, oldest first:',
    transcript || '(the thread has no messages I can read)'
  ].filter(line => line !== '').join('\n');
}

/**
 * Tool: save one checked lesson. Only works inside a /learn-this run.
 *
 * @param {Object} input - lesson, skill, topic, status, source_label, source_url, taught_by_name, taught_at
 * @param {Object} ctx - { userId, chatContext }
 */
export async function saveTeamLesson(input = {}, ctx = {}) {
  const { userId, chatContext } = ctx;
  if (!chatContext?.learnMode) {
    return { success: false, error: 'Lessons are saved only when someone uses /learn-this in a Chat thread.' };
  }
  if (!chatContext.spaceName || !chatContext.threadName) {
    return { success: false, error: 'This lesson has no Chat thread to link back to, so it was not saved.' };
  }

  const lesson = String(input.lesson || '').trim();
  const topic = String(input.topic || '').trim();
  const status = String(input.status || '').trim();
  if (!lesson || !topic) return { success: false, error: 'A lesson needs both the lesson text and a short topic.' };
  if (!LESSON_STATUSES.includes(status)) {
    return { success: false, error: `status must be one of: ${LESSON_STATUSES.join(', ')}.` };
  }
  if ((status === 'verified' || status === 'conflict') && !input.source_label && !input.source_url) {
    return { success: false, error: `A ${status} lesson needs the source it was checked against (source_label or source_url).` };
  }

  const { id } = await saveLesson({
    lesson,
    topic,
    status,
    skill: input.skill ? String(input.skill).trim() : null,
    source_label: input.source_label || null,
    source_url: input.source_url || null,
    taught_by_name: input.taught_by_name || null,
    taught_at: input.taught_at || null,
    captured_by: userId || null,
    space_name: chatContext.spaceName,
    thread_name: chatContext.threadName,
    thread_link: threadLink(chatContext.spaceName, chatContext.threadName)
  });
  console.log(`🧠 Team lesson saved — id ${id}, status ${status}`);
  return { success: true, id, status };
}
