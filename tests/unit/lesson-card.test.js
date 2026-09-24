/**
 * The /learn-this lesson card
 *
 * "Checking…" first (private in a space), then the lessons to confirm or
 * Oracle's result; teacher-only Save / Edit / Discard (and Save all / Discard all
 * with two or more); silent 24-hour expiry; edits re-checked before saving; a
 * newer /learn-this replacing the live card; lesson cards' own dialog switch.
 *
 * In-memory stores and Chat; no network, no database.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/lesson-card.test.js
 */

import { jest } from '@jest/globals';
import { createTrackedCardFakes, cardText, cardButtons } from './helpers/tracked-cards-fakes.js';

process.env.GOOGLE_CHAT_AUDIENCE = 'https://hub.example/api/chat/google';
delete process.env.TRACK_DIALOGS_ENABLED;
delete process.env.LESSON_DIALOGS_DISABLED;

const fakes = createTrackedCardFakes();

// team_lessons, in memory, with the SQL's rules: only pending rows can be
// confirmed or discarded; expiry deletes pending rows past expires_at.
const lessonRows = new Map();
let lessonSeq = 0;
const lessonsFake = {
  async pendingForCard(cardId) {
    return [...lessonRows.values()].filter(r => r.card_id === cardId && r.state === 'pending').sort((a, b) => a.id - b.id);
  },
  async lessonsForCard(cardId) {
    return [...lessonRows.values()].filter(r => r.card_id === cardId).sort((a, b) => a.id - b.id);
  },
  async confirmLesson(id, edits = {}) {
    const r = lessonRows.get(Number(id));
    if (!r || r.state !== 'pending') return null;
    Object.assign(r, { state: 'active', confirmed_at: new Date() }, Object.fromEntries(Object.entries(edits).filter(([, v]) => v != null)));
    return { ...r };
  },
  async retireLesson(id) {
    const r = lessonRows.get(Number(id));
    if (!r || r.state !== 'active' || r.retired_at) return false;
    r.retired_at = new Date();
    return true;
  },
  async discardLesson(id) {
    const r = lessonRows.get(Number(id));
    if (!r || r.state !== 'pending') return false;
    lessonRows.delete(Number(id));
    return true;
  },
  async expirePending(now = new Date()) {
    const gone = [...lessonRows.values()].filter(r => r.state === 'pending' && r.expires_at <= now);
    gone.forEach(r => lessonRows.delete(r.id));
    return { expired: gone.map(r => r.id), cardIds: [...new Set(gone.map(r => r.card_id))] };
  }
};
function addPending(cardId, fields = {}) {
  const id = ++lessonSeq;
  lessonRows.set(id, {
    id, card_id: cardId, state: 'pending', status: 'unverified', topic: `topic ${id}`, lesson: `lesson ${id}`,
    taught_by_name: 'Kelly', expires_at: new Date(Date.now() + 24 * 3600 * 1000), ...fields
  });
  return id;
}

jest.unstable_mockModule('../../src/database/tracked-cards-store.js', () => fakes.store);
jest.unstable_mockModule('../../src/cards/chat-api.js', () => fakes.chat.module);
jest.unstable_mockModule('../../src/claude/client.js', () => fakes.agent.module);
jest.unstable_mockModule('../../src/database/team-lessons-store.js', () => lessonsFake);
jest.unstable_mockModule('../../src/tools/team-lessons.js', () => ({ LEARN_MODE_TOOLS: ['load_skill', 'save_team_lesson'] }));
jest.unstable_mockModule('../../src/cards/types.js', async () => {
  const { lessonCard } = await import('../../src/cards/lesson-card.js');
  return { cardTypeOf: (c) => ((typeof c === 'string' ? c : c?.card_type) === 'lesson' ? lessonCard : null), allCardTypes: () => [lessonCard] };
});

const {
  lessonCard, startLessonCard, finishLessonCard, expireLessonCards,
  editLessonIntent, handleTypedEdit, liveLessonCard, statusLine
} = await import('../../src/cards/lesson-card.js');
const { renderCard } = await import('../../src/cards/update.js');
const { dialogsEnabled } = await import('../../src/cards/render.js');

const TEACHER = 'users/kelly';
const OTHER = 'users/nat';
const SPACE = 'spaces/RTRI';
const THREAD = `${SPACE}/threads/T1`;
const teacher = { chatUserId: TEACHER, name: 'Kelly' };
const other = { chatUserId: OTHER, name: 'Nat' };

beforeEach(() => {
  fakes.reset();
  lessonRows.clear();
  delete process.env.LESSON_DIALOGS_DISABLED;
  delete process.env.TRACK_DIALOGS_ENABLED;
});

async function startInSpace() {
  return startLessonCard({ spaceName: SPACE, threadName: THREAD, surface: 'chat_space', conversationId: null, ownerChatId: TEACHER, ownerUserId: 3 });
}
const current = async (id) => fakes.store.getCard(id);
const press = async (card, action, actor, params = {}) =>
  lessonCard.handleAction({ card: await current(card.id), actor, action, now: new Date(), params });

describe('posting', () => {
  test('in a space, "Checking…" goes privately to the teacher, in the thread', async () => {
    const card = await startInSpace();
    const post = fakes.chat.posts.at(-1);
    expect(post).toMatchObject({ spaceName: SPACE, threadName: THREAD, privateTo: TEACHER });
    expect(cardText(post.cardsV2)).toMatch(/Checking what to learn/);
    expect(cardButtons(post.cardsV2)).toEqual([]);
    expect(card.owner_chat_id).toBe(TEACHER);
  });

  test('in a DM, it is a normal card posted as a reply in the /learn-this message\'s thread', async () => {
    const card = await startLessonCard({ spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/x', surface: 'chat_dm', conversationId: null, ownerChatId: TEACHER, ownerUserId: 3 });
    expect(fakes.chat.posts.at(-1)).toMatchObject({ spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/x', privateTo: null });
    expect(card.thread_name).toBe('spaces/DM1/threads/x');
    expect(card.data.noThread).toBe(false);
    expect((await liveLessonCard({ surface: 'chat_dm', spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/x' })).id).toBe(card.id);
  });

  test('a message that arrives with no thread: the card is posted unthreaded and filed under the fallback name', async () => {
    const card = await startLessonCard({ spaceName: 'spaces/DM1', threadName: null, surface: 'chat_dm', conversationId: null, ownerChatId: TEACHER, ownerUserId: 3 });
    expect(fakes.chat.posts.at(-1)).toMatchObject({ threadName: null, privateTo: null });
    expect(card.thread_name).toBe('spaces/DM1/threads/lessons');
    expect(card.data.noThread).toBe(true);
  });

  test('in a DM, one live card per thread: a /learn-this in another thread gets its own card', async () => {
    const first = await startLessonCard({ spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/a', surface: 'chat_dm', conversationId: null, ownerChatId: TEACHER, ownerUserId: 3 });
    const again = await startLessonCard({ spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/a', surface: 'chat_dm', conversationId: null, ownerChatId: TEACHER, ownerUserId: 3 });
    const other = await startLessonCard({ spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/b', surface: 'chat_dm', conversationId: null, ownerChatId: TEACHER, ownerUserId: 3 });
    expect((await current(first.id)).status).toBe('closed');
    expect((await current(again.id)).status).toBe('open');
    expect((await current(other.id)).status).toBe('open');
  });

  test('a typed edit sent top-level in a DM (a new thread) still finds the teacher\'s live card there', async () => {
    const card = await startLessonCard({ spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/a', surface: 'chat_dm', conversationId: null, ownerChatId: TEACHER, ownerUserId: 3 });
    const found = await liveLessonCard({ surface: 'chat_dm', spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/new', ownerChatId: TEACHER, anyInDm: true });
    expect(found.id).toBe(card.id);
    // Not in a space, and never someone else's card.
    expect(await liveLessonCard({ surface: 'chat_dm', spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/new', ownerChatId: OTHER, anyInDm: true })).toBeNull();
    await startInSpace();
    expect(await liveLessonCard({ surface: 'chat_space', spaceName: SPACE, threadName: `${SPACE}/threads/other`, ownerChatId: TEACHER, anyInDm: true })).toBeNull();
  });

  test('in a DM, a reply to a press goes in the card\'s thread and needs no privacy flag', async () => {
    const card = await startLessonCard({ spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/a', surface: 'chat_dm', conversationId: null, ownerChatId: TEACHER, ownerUserId: 3 });
    const { tellPresser } = await import('../../src/cards/update.js');
    await tellPresser(await current(card.id), teacher, 'That lesson isn’t waiting any more.');
    expect(fakes.chat.posts.at(-1)).toMatchObject({ spaceName: 'spaces/DM1', threadName: 'spaces/DM1/threads/a', privateTo: null });
  });

  test('a refusal to a press is a private reply in the card\'s own thread', async () => {
    const card = await startInSpace();
    const id = addPending(card.id);
    await finishLessonCard(card.id, '');
    const { tellPresser } = await import('../../src/cards/update.js');
    await tellPresser(await current(card.id), other, 'Only the person who ran /learn-this can save or change these lessons.');
    expect(fakes.chat.posts.at(-1)).toMatchObject({ threadName: THREAD, privateTo: OTHER });
    expect(lessonRows.get(id).state).toBe('pending');
  });

  test('nothing waiting: the card shows Oracle\'s result, closes, and nothing else is posted', async () => {
    const card = await startInSpace();
    const posts = fakes.chat.posts.length;
    await finishLessonCard(card.id, 'This is FedDev Ontario\'s RTRI guide (Oct 2025), not BC\'s — nothing saved.');
    const shown = await renderCard(await current(card.id));
    expect(cardText(shown)).toMatch(/FedDev Ontario.*nothing saved/);
    expect(cardButtons(shown)).toEqual([]);
    expect((await current(card.id)).status).toBe('closed');
    expect(fakes.chat.posts.length).toBe(posts);
  });

  test('lessons already in Granted\'s notes are listed greyed, with no buttons, and internal names tidied', async () => {
    const card = await startInSpace();
    await fakes.store.patchCardData(card.id, { known: [{ topic: 'pivot end date', lesson: 'x', known_source: 'Granted\'s RTRI notes (PROGRAM_FACTS reviewed 2026-09-23)' }] });
    await finishLessonCard(card.id, 'All already known.');
    const text = cardText(await renderCard(await current(card.id)));
    expect(text).toMatch(/Already in Granted’s notes — not saved/);
    expect(text).toMatch(/pivot end date — Granted's RTRI notes \(program notes reviewed/);
    expect(text).not.toMatch(/PROGRAM_FACTS/);
  });
});

describe('the lessons to confirm', () => {
  test('one lesson: its text, status and Save / Edit / Discard — no Save all', async () => {
    const card = await startInSpace();
    addPending(card.id, { status: 'verified', source_label: 'Applicant Guide', source_url: 'https://example.ca/g', lesson: 'Acknowledged within 10 business days.' });
    await finishLessonCard(card.id, '');
    const shown = await renderCard(await current(card.id));
    expect(cardText(shown)).toMatch(/Acknowledged within 10 business days/);
    expect(cardText(shown)).toMatch(/Verified — Applicant Guide/);
    expect(cardButtons(shown).map(b => b.text)).toEqual(['Save', 'Edit', 'Discard']);
  });

  test('two or more: Save all and Discard all at the top', async () => {
    const card = await startInSpace();
    addPending(card.id);
    addPending(card.id);
    await finishLessonCard(card.id, '');
    const names = cardButtons(await renderCard(await current(card.id))).map(b => b.text);
    expect(names.slice(0, 2)).toEqual(['Save all', 'Discard all']);
    expect(names.filter(n => n === 'Save')).toHaveLength(2);
  });

  test('a fact from a document says so, and never shows as verified by itself', () => {
    expect(statusLine({ status: 'unverified', from_document: 'RTRI BC Applicant Guide.pdf' }))
      .toBe('From RTRI BC Applicant Guide.pdf, not yet in Granted’s notes');
  });

  test('overflow past the cap is shown', async () => {
    const card = await startInSpace();
    addPending(card.id);
    await fakes.store.patchCardData(card.id, { overflow: 4 });
    await finishLessonCard(card.id, '');
    expect(cardText(await renderCard(await current(card.id)))).toMatch(/Found 5 — showing 1\. Send the rest in smaller pieces/);
  });
});

describe('only the teacher can act', () => {
  test.each(['lesson.save', 'lesson.discard', 'lesson.edit', 'lesson.save_all', 'lesson.discard_all'])('%s by someone else is refused politely, nothing changes', async (action) => {
    const card = await startInSpace();
    const id = addPending(card.id);
    addPending(card.id);
    await finishLessonCard(card.id, '');
    const outcome = await press(card, action, other, { lessonId: id });
    expect(outcome).toMatchObject({ changed: false, ignored: 'not_the_teacher' });
    expect(outcome.reply).toMatch(/Only the person who ran \/learn-this/);
    expect(lessonRows.get(id).state).toBe('pending');
  });

  test('typed edit by someone else is refused too', async () => {
    const card = await startInSpace();
    addPending(card.id);
    await finishLessonCard(card.id, '');
    const r = await handleTypedEdit({ card: await current(card.id), actor: other, number: 1, text: 'new' });
    expect(r.reply).toMatch(/Only the person who ran \/learn-this/);
    expect(fakes.agent.calls).toHaveLength(0);
  });
});

describe('Save, Discard, and their outcome on the card', () => {
  test('Save makes it active; the card says "Saved as unverified", stays open, and offers only Remove on it', async () => {
    const card = await startInSpace();
    const id = addPending(card.id);
    await finishLessonCard(card.id, '');
    expect(await press(card, 'lesson.save', teacher, { lessonId: id })).toMatchObject({ changed: true });
    expect(lessonRows.get(id).state).toBe('active');
    const after = await current(card.id);
    const shown = await renderCard(after);
    expect(cardText(shown)).toMatch(/Saved as unverified/);
    expect(after.status).toBe('open');
    expect(cardButtons(shown).map(b => b.text)).toEqual(['Remove']);
    expect(cardButtons(shown)[0].params).toMatchObject({ action: 'lesson.remove', lessonId: String(id) });
  });

  test('Discard deletes it and the card says "Discarded"', async () => {
    const card = await startInSpace();
    const id = addPending(card.id);
    const keep = addPending(card.id);
    await finishLessonCard(card.id, '');
    await press(card, 'lesson.discard', teacher, { lessonId: id });
    expect(lessonRows.has(id)).toBe(false);
    const after = await current(card.id);
    expect(cardText(await renderCard(after))).toMatch(/Discarded/);
    expect(after.status).not.toBe('closed');
    expect(lessonRows.get(keep).state).toBe('pending');
  });

  test('Save all saves what is still waiting and leaves handled lessons alone', async () => {
    const card = await startInSpace();
    const a = addPending(card.id);
    const b = addPending(card.id, { status: 'verified', source_label: 'Guide' });
    const c = addPending(card.id);
    await finishLessonCard(card.id, '');
    await press(card, 'lesson.discard', teacher, { lessonId: a });
    await press(card, 'lesson.save_all', teacher);
    expect(lessonRows.has(a)).toBe(false);
    expect(lessonRows.get(b).state).toBe('active');
    expect(lessonRows.get(c).state).toBe('active');
    const text = cardText(await renderCard(await current(card.id)));
    expect(text).toMatch(/Discarded/);
    expect(text).toMatch(/Saved as verified/);
  });

  test('Discard all deletes everything still waiting', async () => {
    const card = await startInSpace();
    const a = addPending(card.id);
    const b = addPending(card.id);
    await finishLessonCard(card.id, '');
    await press(card, 'lesson.discard_all', teacher);
    expect(lessonRows.size).toBe(0);
    expect((await current(card.id)).status).toBe('closed');
    expect([a, b].every(id => !lessonRows.has(id))).toBe(true);
  });

  test('pressing Save on a lesson that already expired says so', async () => {
    const card = await startInSpace();
    const id = addPending(card.id);
    await finishLessonCard(card.id, '');
    lessonRows.delete(id);
    const outcome = await press(card, 'lesson.save', teacher, { lessonId: id });
    expect(outcome).toMatchObject({ changed: false, ignored: 'not_waiting' });
    expect(outcome.reply).toMatch(/isn’t waiting any more/);
  });
});

describe('Remove, on a saved lesson', () => {
  async function savedCard(extraPending = 0) {
    const card = await startInSpace();
    const id = addPending(card.id);
    const others = Array.from({ length: extraPending }, () => addPending(card.id));
    await finishLessonCard(card.id, '');
    await press(card, 'lesson.save', teacher, { lessonId: id });
    return { card, id, others };
  }

  test('retires the lesson at once; the card says "Removed" and closes when nothing is left', async () => {
    const { card, id } = await savedCard();
    expect(await press(card, 'lesson.remove', teacher, { lessonId: id })).toMatchObject({ changed: true });
    expect(lessonRows.get(id).retired_at).toBeInstanceOf(Date);
    const after = await current(card.id);
    expect(cardText(await renderCard(after))).toMatch(/Removed/);
    expect(cardButtons(await renderCard(after))).toEqual([]);
    expect(after.status).toBe('closed');
  });

  test('someone else pressing Remove is refused politely; the lesson stays', async () => {
    const { card, id } = await savedCard();
    const outcome = await press(card, 'lesson.remove', other, { lessonId: id });
    expect(outcome).toMatchObject({ changed: false, ignored: 'not_the_teacher' });
    expect(outcome.reply).toMatch(/Only the person who ran \/learn-this/);
    expect(lessonRows.get(id).retired_at).toBeUndefined();
  });

  test('Remove on a lesson that isn\'t saved changes nothing', async () => {
    const card = await startInSpace();
    const id = addPending(card.id);
    await finishLessonCard(card.id, '');
    const outcome = await press(card, 'lesson.remove', teacher, { lessonId: id });
    expect(outcome).toMatchObject({ changed: false, ignored: 'not_saved' });
    expect(lessonRows.get(id).state).toBe('pending');
  });

  test('pressing Remove twice: the second says there is nothing to remove', async () => {
    const { card, id } = await savedCard(1);
    await press(card, 'lesson.remove', teacher, { lessonId: id });
    expect(await press(card, 'lesson.remove', teacher, { lessonId: id })).toMatchObject({ changed: false, ignored: 'not_saved' });
  });

  test('an edited-and-saved lesson can be removed too', async () => {
    const card = await startInSpace();
    const id = addPending(card.id);
    await finishLessonCard(card.id, '');
    fakes.agent.impl = async (args) => {
      await lessonsFake.confirmLesson(args.chatContext.editLessonId, { lesson: 'new text', status: 'verified' });
      return { success: true, response: { content: [] } };
    };
    await handleTypedEdit({ card: await current(card.id), actor: teacher, number: 1, text: 'new text' });
    expect(cardButtons(await renderCard(await current(card.id))).map(b => b.text)).toEqual(['Remove']);
    await press(card, 'lesson.remove', teacher, { lessonId: id });
    expect(cardText(await renderCard(await current(card.id)))).toMatch(/Removed/);
  });

  test('saved lessons don\'t count as waiting: no Save all for one waiting next to a saved one', async () => {
    const { card } = await savedCard(1);
    const shown = await renderCard(await current(card.id));
    const names = cardButtons(shown).map(b => b.text);
    expect(names).not.toContain('Save all');
    expect(names).toEqual(['Remove', 'Save', 'Edit', 'Discard']);
    expect(cardText(shown)).toMatch(/1 waiting/);
  });

  test('Save all counts only what is waiting, and leaves saved lessons with their Remove', async () => {
    const { card, id, others } = await savedCard(2);
    const names = cardButtons(await renderCard(await current(card.id))).map(b => b.text);
    expect(names.slice(0, 2)).toEqual(['Save all', 'Discard all']);
    await press(card, 'lesson.save_all', teacher);
    expect(others.every(o => lessonRows.get(o).state === 'active')).toBe(true);
    const after = cardButtons(await renderCard(await current(card.id))).map(b => b.text);
    expect(after).toEqual(['Remove', 'Remove', 'Remove']);
    expect(lessonRows.get(id).state).toBe('active');
  });
});

describe('expiry', () => {
  test('after 24 hours pending lessons are deleted and the card updates in place — nothing is posted', async () => {
    const card = await startInSpace();
    const old = addPending(card.id, { expires_at: new Date(Date.now() - 1000) });
    await finishLessonCard(card.id, '');
    const posts = fakes.chat.posts.length;
    const patches = fakes.chat.patches.length;
    expect(await expireLessonCards(new Date())).toEqual({ expired: 1, cards: 1 });
    expect(lessonRows.has(old)).toBe(false);
    expect(fakes.chat.posts.length).toBe(posts);
    expect(fakes.chat.patches.length).toBeGreaterThan(patches);
    const after = await current(card.id);
    expect(cardText(await renderCard(after))).toMatch(/Expired — not saved/);
    expect(cardButtons(await renderCard(after))).toEqual([]);
  });

  test('expiry touches only pending lessons: a saved lesson keeps its Remove and the card stays open', async () => {
    const card = await startInSpace();
    const saved = addPending(card.id);
    const old = addPending(card.id, { expires_at: new Date(Date.now() - 1000) });
    await finishLessonCard(card.id, '');
    await press(card, 'lesson.save', teacher, { lessonId: saved });
    lessonRows.get(saved).expires_at = new Date(Date.now() - 1000); // even an overdue timestamp on a saved row
    expect(await expireLessonCards(new Date())).toEqual({ expired: 1, cards: 1 });
    expect(lessonRows.has(old)).toBe(false);
    expect(lessonRows.get(saved).state).toBe('active');
    const after = await current(card.id);
    expect(after.status).toBe('open');
    const shown = await renderCard(after);
    expect(cardText(shown)).toMatch(/Expired — not saved/);
    expect(cardButtons(shown).map(b => b.text)).toEqual(['Remove']);
  });

  test('lessons still within 24 hours are untouched', async () => {
    const card = await startInSpace();
    const fresh = addPending(card.id);
    await finishLessonCard(card.id, '');
    expect(await expireLessonCards(new Date())).toEqual({ expired: 0, cards: 0 });
    expect(lessonRows.get(fresh).state).toBe('pending');
  });
});

describe('editing re-checks before saving', () => {
  test('typed edit parser', () => {
    expect(editLessonIntent('edit lesson 2: Acknowledged in 10 business days')).toEqual({ number: 2, text: 'Acknowledged in 10 business days' });
    expect(editLessonIntent('Edit lesson 1 — new wording')).toEqual({ number: 1, text: 'new wording' });
    expect(editLessonIntent('edit lesson two: x')).toBeNull();
    expect(editLessonIntent('can you edit lesson 1')).toBeNull();
  });

  test('the edited text goes through one restricted check run, which saves it; the card says "(edited)"', async () => {
    const card = await startInSpace();
    const id = addPending(card.id, { lesson: 'old text' });
    await finishLessonCard(card.id, '');
    fakes.agent.impl = async (args) => {
      // What save_team_lesson does in an edit run: confirm that one lesson.
      await lessonsFake.confirmLesson(args.chatContext.editLessonId, { lesson: 'new text', status: 'verified' });
      return { success: true, response: { content: [] } };
    };
    await handleTypedEdit({ card: await current(card.id), actor: teacher, number: 1, text: 'new text' });
    const call = fakes.agent.calls.at(-1);
    expect(call.chatContext).toMatchObject({ learnMode: true, editLessonId: id, lessonCardId: card.id });
    expect(call.allowedTools).toContain('save_team_lesson');
    expect(call.message).toMatch(/Edited text to check and save: new text/);
    expect(lessonRows.get(id)).toMatchObject({ state: 'active', lesson: 'new text', status: 'verified' });
    const text = cardText(await renderCard(await current(card.id)));
    expect(text).toMatch(/Saved as verified \(edited\)/);
    expect(text).toMatch(/new text/);
  });

  test('if the check run doesn\'t save it, the lesson stays waiting and the teacher is told', async () => {
    const card = await startInSpace();
    const id = addPending(card.id);
    await finishLessonCard(card.id, '');
    fakes.agent.impl = async () => ({ success: true, response: { content: [] } });
    await handleTypedEdit({ card: await current(card.id), actor: teacher, number: 1, text: 'new text' });
    expect(lessonRows.get(id).state).toBe('pending');
    expect(fakes.chat.posts.at(-1)).toMatchObject({ privateTo: TEACHER });
    expect(fakes.chat.posts.at(-1).text).toMatch(/couldn’t check the edited lesson/);
  });

  test('the Edit dialog is the teacher\'s only, pre-filled; an empty submit changes nothing; a submit re-checks in the background', async () => {
    const card = await startInSpace();
    const id = addPending(card.id, { lesson: 'old text' });
    await finishLessonCard(card.id, '');
    const c = await current(card.id);
    expect(lessonCard.dialogFor(c, 'lesson.edit', other, { lessonId: id })).toBeNull();
    const dialog = lessonCard.dialogFor(c, 'lesson.edit', teacher, { lessonId: String(id) });
    expect(JSON.stringify(dialog)).toMatch(/"value":"old text"/);
    expect(await lessonCard.submitDialog(c, 'lesson.edit', teacher, { lesson: ['  '] }, new Date(), { lessonId: String(id) }))
      .toMatchObject({ changed: false, ignored: 'empty' });
    const submitted = await lessonCard.submitDialog(c, 'lesson.edit', teacher, { lesson: ['new text'] }, new Date(), { lessonId: String(id) });
    expect(submitted.changed).toBe(true);
    expect(typeof submitted.background).toBe('function');
  });
});

describe('dialogs are switched on for lesson cards only', () => {
  test('on for lesson cards by default, off for other cards', () => {
    expect(dialogsEnabled(lessonCard)).toBe(true);
    expect(dialogsEnabled({ type: 'track' })).toBe(false);
    expect(dialogsEnabled()).toBe(false);
  });

  test('with dialogs on, Edit opens a dialog and Save does not', async () => {
    const card = await startInSpace();
    addPending(card.id);
    await finishLessonCard(card.id, '');
    const buttons = JSON.parse(JSON.stringify(await renderCard(await current(card.id))));
    const find = (label) => {
      let hit = null;
      const walk = (v) => { if (hit || !v || typeof v !== 'object') return; if (v.text === label && v.onClick) { hit = v; return; } Object.values(v).forEach(walk); };
      walk(buttons);
      return hit;
    };
    expect(find('Edit').onClick.action.interaction).toBe('OPEN_DIALOG');
    expect(find('Save').onClick.action.interaction).toBeUndefined();
  });

  test('LESSON_DIALOGS_DISABLED turns them off; Edit then answers with the typed instruction', async () => {
    process.env.LESSON_DIALOGS_DISABLED = 'true';
    expect(dialogsEnabled(lessonCard)).toBe(false);
    const card = await startInSpace();
    const id = addPending(card.id);
    await finishLessonCard(card.id, '');
    expect(JSON.stringify(await renderCard(await current(card.id)))).not.toMatch(/OPEN_DIALOG/);
    const outcome = await press(card, 'lesson.edit', teacher, { lessonId: id });
    expect(outcome.reply).toMatch(/@Oracle edit lesson 1: <new text>/);
  });
});

describe('a newer /learn-this replaces the live card', () => {
  test('its waiting lessons are deleted and it closes; the new card is live', async () => {
    const first = await startInSpace();
    const id = addPending(first.id);
    await finishLessonCard(first.id, '');
    const second = await startInSpace();
    expect(lessonRows.has(id)).toBe(false);
    expect((await current(first.id)).status).toBe('closed');
    expect(cardText(await renderCard(await current(first.id)))).toMatch(/replaced by a newer \/learn-this/);
    expect((await liveLessonCard({ surface: 'chat_space', spaceName: SPACE, threadName: THREAD })).id).toBe(second.id);
  });
});
