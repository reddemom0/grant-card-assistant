/**
 * The lesson card — "@Oracle /learn-this" asks the teacher before anything is saved
 *
 * One card per /learn-this run. It is posted at once as "Checking…" (privately
 * to the teacher in a space, normally in a DM), then updated in place:
 * - with the lessons waiting for confirmation — each with its check status and
 *   source, and Save / Edit / Discard (Save all / Discard all with two or more);
 * - or, when nothing is waiting (all already known, out of scope, nothing to
 *   learn), with Oracle's short result, and closed.
 * Lessons already in Granted's notes are listed, greyed, and never saved.
 *
 * Only the teacher (the card's owner) can press anything. Pending lessons are
 * never used in answers; unconfirmed ones expire after 24 hours, and the card
 * then updates silently — nothing is posted.
 *
 * Edit opens a dialog (lesson cards opt in to dialogs on their own; see
 * dialogsEnabled in render.js) and always has a typed fallback:
 * "@Oracle edit lesson 1: <new text>". Either way the new text is re-checked by
 * one restricted Oracle run before it is saved.
 *
 * The card renders from its own data (items, outcomes, known, overflow), so a
 * discarded or expired lesson — whose row is gone — still shows its outcome.
 */

import * as store from '../database/tracked-cards-store.js';
import * as lessons from '../database/team-lessons-store.js';
import {
  trackedCard, paragraph, decorated, button, buttonRow, esc, clip, mdToPlain, dialogsEnabled
} from './render.js';
import { postMessage } from './chat-api.js';

const TEACHER_ONLY = 'Only the person who ran /learn-this can save or change these lessons.';
const GONE = 'That lesson isn’t waiting any more — it was already saved, discarded, or it expired.';
const RESULT_CHARS = 700;
const LESSON_CHARS = 600;
const EDIT_CHARS = 1000;

export const LESSON_ACTIONS = {
  'lesson.save': { personal: false, label: 'saved a lesson' },
  'lesson.discard': { personal: false, label: 'discarded a lesson' },
  'lesson.edit': { personal: false, label: 'edited a lesson', dialog: true, saved: 'Checking the edited lesson…' },
  'lesson.save_all': { personal: false, label: 'saved all lessons' },
  'lesson.discard_all': { personal: false, label: 'discarded all lessons' }
};

function codeOf(err) {
  return err?.response?.status ?? err?.code ?? err?.name ?? 'unknown';
}

// ============================================================================
// TYPED EDIT — "@Oracle edit lesson 2: <new text>"
// ============================================================================

const TYPED_EDIT = /^\s*edit\s+lesson\s+(\d{1,2})\s*[:\-–—]\s*([\s\S]+)$/i;

/**
 * @param {string} text - message text with the @mention stripped
 * @returns {{number: number, text: string}|null}
 */
export function editLessonIntent(text) {
  const m = String(text || '').match(TYPED_EDIT);
  if (!m) return null;
  const newText = m[2].trim();
  return newText ? { number: Number(m[1]), text: clip(newText, EDIT_CHARS) } : null;
}

// ============================================================================
// STATUS AND OUTCOME WORDING
// ============================================================================

/** The check result, as the teacher sees it. */
export function statusLine(item) {
  if (item.from_document) {
    const base = `From ${item.from_document}, not yet in Granted’s notes`;
    return item.status === 'conflict' ? `${base} · conflicts with ${item.source_label || 'Granted’s notes'}` : base;
  }
  const source = item.source_label || item.source_url || null;
  if (item.status === 'verified') return `Verified${source ? ` — ${source}` : ''}`;
  if (item.status === 'conflict') return `Conflicts with ${source || 'an official source'} — the official source wins`;
  return 'Unverified — no source confirms or contradicts it';
}

/** What happened to a lesson, once it was handled. */
export function outcomeLine(outcome) {
  if (!outcome) return null;
  if (outcome.result === 'saved') return `Saved as ${outcome.status}${outcome.edited ? ' (edited)' : ''}`;
  if (outcome.result === 'discarded') return 'Discarded';
  if (outcome.result === 'expired') return 'Expired — not saved';
  if (outcome.result === 'replaced') return 'Not saved — replaced by a newer /learn-this';
  return null;
}

/** Tidy an internal note name before it reaches the card. */
function tidySource(text) {
  return String(text || '').replace(/PROGRAM_FACTS/g, 'program notes').replace(/APPLICATION_FIELDS/g, 'form notes');
}

function pendingItems(d) {
  return (d.items || []).filter(item => !d.outcomes?.[item.id]);
}

// ============================================================================
// RENDER
// ============================================================================

function render(card, participants = [], latestClick = null) {
  const d = card.data || {};
  const sections = [];
  const phase = d.phase || 'checking';

  if (phase === 'checking') {
    sections.push({ widgets: [paragraph('<i>Checking what to learn… (this can take a minute)</i>')] });
  } else if (phase === 'result') {
    sections.push({ widgets: [paragraph(esc(clip(mdToPlain(d.result || 'Nothing to learn in this thread.'), RESULT_CHARS)))] });
  } else {
    const waiting = pendingItems(d);
    const live = card.status !== 'closed';

    if (live && waiting.length >= 2) {
      sections.push({
        widgets: [buttonRow([
          button('Save all', { cardId: card.id, action: 'lesson.save_all' }),
          button('Discard all', { cardId: card.id, action: 'lesson.discard_all' })
        ])]
      });
    }

    for (const item of d.items || []) {
      const outcome = d.outcomes?.[item.id];
      const text = outcome?.lesson || item.lesson;
      const widgets = [
        decorated({
          top: `${item.topic}${item.taught_by_name ? ` · taught by ${item.taught_by_name}` : ''}`,
          text: esc(clip(mdToPlain(text), LESSON_CHARS)),
          bottom: outcome ? outcomeLine(outcome) : statusLine(item)
        })
      ];
      if (!outcome && item.status !== 'unverified' && item.source_url) {
        widgets.push(paragraph(`<a href="${esc(item.source_url)}">Source</a>`));
      }
      if (!outcome && live) {
        widgets.push(buttonRow([
          button('Save', { cardId: card.id, action: 'lesson.save', lessonId: item.id }),
          button('Edit', { cardId: card.id, action: 'lesson.edit', lessonId: item.id }, { openDialog: dialogsEnabled(lessonCard) }),
          button('Discard', { cardId: card.id, action: 'lesson.discard', lessonId: item.id })
        ]));
      }
      sections.push({ header: `Lesson ${item.n}`, widgets });
    }

    if (d.overflow) {
      const found = (d.items || []).length + d.overflow;
      sections.push({ widgets: [paragraph(`<i>Found ${found} — showing ${(d.items || []).length}. Send the rest in smaller pieces.</i>`)] });
    }
    if (live && waiting.length) {
      sections.push({ widgets: [paragraph('<i>Or reply: @Oracle edit lesson 1: &lt;new text&gt;</i>')] });
    }
  }

  if ((d.known || []).length) {
    sections.push({
      header: 'Already in Granted’s notes — not saved',
      collapsible: true,
      shown: 3,
      widgets: d.known.map(k => paragraph(
        `<font color="#80868b">${esc(clip(mdToPlain(k.topic || k.lesson), 120))} — ${esc(clip(tidySource(k.known_source), 160))}</font>`
      ))
    });
  }

  const waitingCount = phase === 'review' ? pendingItems(d).length : 0;
  return trackedCard({
    card,
    title: 'Lessons to confirm',
    subtitle: phase === 'checking' ? 'Checking…'
      : waitingCount ? `${waitingCount} waiting · only you can confirm` : 'Nothing waiting',
    sections,
    latestClick,
    labels: LESSON_ACTIONS
  });
}

// ============================================================================
// ACTIONS
// ============================================================================

async function setOutcome(card, lessonId, outcome) {
  const outcomes = { ...(card.data?.outcomes || {}), [lessonId]: outcome };
  await store.patchCardData(card.id, { outcomes });
  card.data = { ...(card.data || {}), outcomes };
}

/** Close the card once nothing on it is waiting. */
async function closeIfDone(card, now) {
  if (pendingItems(card.data || {}).length === 0) await store.closeCard(card.id, 'all_handled', now);
}

async function saveOne(card, lessonId) {
  const row = await lessons.confirmLesson(lessonId);
  if (!row) return false;
  await setOutcome(card, lessonId, { result: 'saved', status: row.status });
  return true;
}

async function discardOne(card, lessonId) {
  const gone = await lessons.discardLesson(lessonId);
  if (!gone) return false;
  await setOutcome(card, lessonId, { result: 'discarded' });
  return true;
}

function itemFor(card, lessonId) {
  return (card.data?.items || []).find(item => String(item.id) === String(lessonId)) || null;
}

async function handleAction({ card, actor, action, now = new Date(), params = {} }) {
  if (!LESSON_ACTIONS[action]) {
    return { changed: false, ignored: 'unknown_action', reply: 'That button doesn’t do anything on this card.' };
  }
  if (actor.chatUserId !== card.owner_chat_id) {
    return { changed: false, ignored: 'not_the_teacher', reply: TEACHER_ONLY };
  }

  if (action === 'lesson.save_all' || action === 'lesson.discard_all') {
    const waiting = pendingItems(card.data || {});
    let done = 0;
    for (const item of waiting) {
      done += (action === 'lesson.save_all' ? await saveOne(card, item.id) : await discardOne(card, item.id)) ? 1 : 0;
    }
    await closeIfDone(card, now);
    return done ? { changed: true } : { changed: false, ignored: 'nothing_waiting', reply: GONE };
  }

  const item = itemFor(card, params.lessonId);
  if (!item || card.data?.outcomes?.[item.id]) return { changed: false, ignored: 'not_waiting', reply: GONE };

  if (action === 'lesson.edit') {
    // Reaches here only when dialogs are off for this card: the typed fallback.
    return {
      changed: false,
      ignored: 'edit_typed',
      reply: `To edit lesson ${item.n}, reply: @Oracle edit lesson ${item.n}: <new text>`
    };
  }

  const ok = action === 'lesson.save' ? await saveOne(card, item.id) : await discardOne(card, item.id);
  if (!ok) return { changed: false, ignored: 'not_waiting', reply: GONE };
  await closeIfDone(card, now);
  return { changed: true };
}

// ============================================================================
// EDIT — dialog, typed fallback, and the re-check run
// ============================================================================

function dialogFor(card, action, actor, params = {}) {
  if (action !== 'lesson.edit' || actor.chatUserId !== card.owner_chat_id) return null;
  const item = itemFor(card, params.lessonId);
  if (!item || card.data?.outcomes?.[item.id]) return null;
  return {
    header: { title: `Edit lesson ${item.n}` },
    sections: [{
      widgets: [
        {
          textInput: {
            name: 'lesson',
            label: 'The lesson',
            type: 'MULTIPLE_LINE',
            value: clip(item.lesson, EDIT_CHARS),
            validation: { characterLimit: EDIT_CHARS }
          }
        },
        paragraph('<i>Saving re-checks the edited text first.</i>'),
        buttonRow([button('Check and save', { cardId: card.id, action, lessonId: item.id, step: 'submit' })])
      ]
    }]
  };
}

async function submitDialog(card, action, actor, formInputs = {}, now = new Date(), params = {}) {
  if (actor.chatUserId !== card.owner_chat_id) return { changed: false, ignored: 'not_the_teacher', reply: TEACHER_ONLY };
  const item = itemFor(card, params.lessonId);
  if (!item || card.data?.outcomes?.[item.id]) return { changed: false, ignored: 'not_waiting', reply: GONE };
  const text = String(formInputs.lesson?.[0] || '').trim();
  if (!text) return { changed: false, ignored: 'empty', reply: 'The lesson can’t be empty — nothing changed.' };
  return {
    changed: true,
    background: () => recheckEdit(card.id, item.id, clip(text, EDIT_CHARS), actor)
  };
}

/**
 * Typed fallback: "@Oracle edit lesson N: <new text>" from the Chat adapter.
 * @returns {Promise<{handled: boolean, reply?: string}>}
 */
export async function handleTypedEdit({ card, actor, number, text }) {
  if (!card) return { handled: false };
  if (actor.chatUserId !== card.owner_chat_id) return { handled: true, reply: TEACHER_ONLY };
  const item = (card.data?.items || []).find(i => i.n === number);
  if (!item || card.data?.outcomes?.[item.id]) return { handled: true, reply: GONE };
  await recheckEdit(card.id, item.id, text, actor);
  return { handled: true };
}

/**
 * Re-check the edited text with one restricted Oracle run, which saves it
 * through save_team_lesson (editLessonId), then update the card.
 */
export async function recheckEdit(cardId, lessonId, text, actor) {
  const card = await store.getCard(cardId);
  if (!card) return false;
  const item = itemFor(card, lessonId);
  const { runAgent } = await import('../claude/client.js');
  const { LEARN_MODE_TOOLS } = await import('../tools/team-lessons.js');
  const d = card.data || {};

  const message = [
    `[/learn-this edit — lesson ${item?.n ?? ''}. Follow the "Editing a lesson" rules in your instructions.]`,
    `Topic: ${item?.topic || ''}`,
    `Original: ${item?.lesson || ''}`,
    `Edited text to check and save: ${text}`
  ].join('\n');

  try {
    await runAgent({
      agentType: 'internal-oracle',
      message,
      conversationId: card.conversation_id,
      userId: card.owner_user_id,
      sessionId: (await import('crypto')).randomUUID(),
      allowedTools: LEARN_MODE_TOOLS,
      res: null,
      chatContext: {
        surface: d.surface || 'chat_space',
        spaceName: card.space_name,
        threadName: card.thread_name,
        senderChatId: card.owner_chat_id,
        senderDisplayName: actor?.name || null,
        learnMode: true,
        lessonCardId: card.id,
        editLessonId: lessonId
      }
    });
  } catch (err) {
    console.warn(`⚠️  Lesson edit check failed — code: ${codeOf(err)}`);
  }

  // The run saves through save_team_lesson; the row says whether it did.
  const [row] = (await lessons.lessonsForCard(card.id)).filter(r => String(r.id) === String(lessonId));
  const fresh = await store.getCard(card.id);
  if (row?.state === 'active') {
    await setOutcome(fresh, lessonId, { result: 'saved', status: row.status, edited: true, lesson: row.lesson });
    await closeIfDone(fresh, new Date());
    console.log(`🧠 Lesson edited and saved — card ${card.id}`);
  } else {
    const { tellPresser } = await import('./update.js');
    await tellPresser(fresh, { chatUserId: card.owner_chat_id }, 'I couldn’t check the edited lesson, so it’s still waiting — try again.');
  }
  const { rerenderCard } = await import('./update.js');
  await rerenderCard(card.id);
  return row?.state === 'active';
}

// ============================================================================
// THE /learn-this RUN — start, finish, replace
// ============================================================================

/**
 * The thread a lesson card is filed under and replies in: the /learn-this
 * message's own thread, in a DM as in a space. Only a message that arrives with
 * no thread falls back to one fixed name per space (like the intro card); such a
 * card is posted unthreaded.
 */
export function lessonThreadName({ spaceName, threadName }) {
  return threadName || `${spaceName}/threads/lessons`;
}

/**
 * The live lesson card in this thread, if any — one per thread. In a DM, where a
 * typed "@Oracle edit lesson N: …" is often sent top-level (a new thread), `anyInDm`
 * falls back to the teacher's newest live lesson card in that DM.
 */
export async function liveLessonCard({ surface, spaceName, threadName, ownerChatId = null, anyInDm = false }) {
  const here = await store.findLiveCard('lesson', lessonThreadName({ spaceName, threadName }));
  if (here || !anyInDm || surface !== 'chat_dm' || !ownerChatId) return here;
  const mine = (await store.liveCardsOfType('lesson'))
    .filter(c => c.space_name === spaceName && c.owner_chat_id === ownerChatId);
  return mine.pop() || null;
}

/**
 * Post the card as "Checking…" before the learn run, as a reply in the
 * /learn-this message's thread. A lesson card already live in this thread is
 * replaced first: its waiting lessons are deleted and it says so. Returns the
 * card row, or null when the card couldn't be posted (the run then falls back to
 * a text reply).
 */
export async function startLessonCard({ spaceName, threadName, surface, conversationId, ownerChatId, ownerUserId, now = new Date() }) {
  const dm = surface === 'chat_dm';
  const previous = await liveLessonCard({ surface, spaceName, threadName });
  if (previous) await replaceCard(previous, now);

  try {
    const row = await store.insertCard({
      cardType: 'lesson', status: 'open', spaceName, threadName: lessonThreadName({ spaceName, threadName }),
      conversationId, ownerChatId, ownerUserId,
      title: 'Lessons to confirm',
      // Filed under the fallback name only when the message had no thread; then
      // private replies to presses go unthreaded too (tellPresser).
      data: { surface, noThread: !threadName, phase: 'checking', items: [], outcomes: {}, known: [], overflow: 0 }
    });
    const { renderCard } = await import('./update.js');
    const messageName = await postMessage({
      spaceName,
      threadName: threadName || null,
      cardsV2: await renderCard(row),
      privateTo: dm ? null : ownerChatId
    });
    await store.updateCard(row.id, { messageName });
    return { ...row, message_name: messageName };
  } catch (err) {
    console.warn(`⚠️  Lesson card could not be posted — code: ${codeOf(err)}`);
    return null;
  }
}

/**
 * After the learn run: show the waiting lessons, or Oracle's result when nothing
 * is waiting (then close). Everything reaches the teacher through this one card.
 */
export async function finishLessonCard(cardId, resultText, now = new Date()) {
  const pending = await lessons.pendingForCard(cardId);
  if (pending.length) {
    const items = pending.map((r, i) => ({
      id: r.id,
      n: i + 1,
      lesson: r.lesson,
      topic: r.topic,
      status: r.status,
      source_label: r.source_label,
      source_url: r.source_url,
      from_document: r.from_document,
      taught_by_name: r.taught_by_name
    }));
    await store.patchCardData(cardId, { phase: 'review', items });
  } else {
    await store.patchCardData(cardId, { phase: 'result', result: resultText || 'Nothing to learn in this thread.' });
    await store.closeCard(cardId, 'nothing_to_confirm', now);
  }
  const { rerenderCard } = await import('./update.js');
  await rerenderCard(cardId);
  return pending.length;
}

/** A newer /learn-this replaces a live card: its waiting lessons are deleted. */
async function replaceCard(card, now) {
  for (const item of pendingItems(card.data || {})) {
    if (await lessons.discardLesson(item.id)) await setOutcome(card, item.id, { result: 'replaced' });
  }
  // Lessons saved while the card was still checking have no item yet.
  for (const row of await lessons.pendingForCard(card.id)) await lessons.discardLesson(row.id);
  await store.closeCard(card.id, 'replaced', now);
  const { rerenderCard } = await import('./update.js');
  await rerenderCard(card.id);
}

// ============================================================================
// EXPIRY — hourly, silent
// ============================================================================

/**
 * Delete pending lessons older than 24 hours and update their cards in place.
 * Patching a card notifies nobody; nothing is posted.
 */
export async function expireLessonCards(now = new Date()) {
  const { expired, cardIds } = await lessons.expirePending(now);
  const { rerenderCard } = await import('./update.js');
  for (const cardId of cardIds) {
    const card = await store.getCard(cardId);
    if (!card) continue;
    for (const id of expired) {
      if (itemFor(card, id) && !card.data?.outcomes?.[id]) await setOutcome(card, id, { result: 'expired' });
    }
    await closeIfDone(card, now);
    await rerenderCard(cardId);
  }
  if (expired.length) console.log(`🧠 Expired ${expired.length} unconfirmed lessons on ${cardIds.length} cards`);
  return { expired: expired.length, cards: cardIds.length };
}

// ============================================================================
// THE CARD TYPE
// ============================================================================

async function refresh() {
  return { changed: false };
}

function digestLine(card) {
  return card.title || 'Lessons to confirm';
}

/** Lesson cards are in nobody's digest: the teacher already has the card. */
async function digestItems() {
  return [];
}

export const lessonCard = {
  type: 'lesson',
  actions: LESSON_ACTIONS,
  neverStale: true,
  dialogs: true,
  render,
  handleAction,
  dialogFor,
  submitDialog,
  refresh,
  digestLine,
  digestItems
};
