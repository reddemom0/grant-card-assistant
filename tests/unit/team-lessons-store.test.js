/**
 * Team lessons in the database — pending until the teacher confirms
 *
 * The SQL the store sends (recorded, not run): only active lessons reach
 * answers; new lessons are saved pending with a 24-hour expiry; only pending
 * rows can be confirmed or discarded. And what save_team_lesson does with each
 * kind of lesson: already known (recorded on the card, not saved), past the cap
 * (refused, counted), an edit (confirms that one row, never inserts), a document
 * fact (never verified by the document itself).
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/team-lessons-store.test.js
 */

import { jest } from '@jest/globals';

const sent = [];
let answer = () => ({ rows: [] });
jest.unstable_mockModule('../../src/database/connection.js', () => ({
  query: async (text, params = []) => {
    sent.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    return answer(text, params);
  }
}));

const store = await import('../../src/database/team-lessons-store.js');
const { saveTeamLesson, lessonRow } = await import('../../src/tools/team-lessons.js');

const CARD = '00000000-0000-4000-8000-000000000001';
const LEARN = { learnMode: true, surface: 'chat_space', spaceName: 'spaces/A', threadName: 'spaces/A/threads/T', lessonCardId: CARD };
const lesson = { lesson: 'Acknowledged within 10 business days.', topic: 'acknowledgement', status: 'unverified', skill: 'rtri-tariff' };

beforeEach(() => {
  sent.length = 0;
  answer = () => ({ rows: [] });
});

describe('what reaches answers', () => {
  test('only active lessons — pending ones never', async () => {
    await store.activeLessons();
    expect(sent[0].text).toMatch(/WHERE state = 'active' AND retired_at IS NULL/);
  });
});

describe('saving and confirming', () => {
  test('a new lesson is saved pending, with its card and a 24-hour expiry', async () => {
    answer = (text) => (/count\(\*\)/.test(text) ? { rows: [{ n: 0 }] } : { rows: [{ id: 7 }] });
    const before = Date.now();
    const r = await saveTeamLesson(lesson, { userId: 1, chatContext: LEARN });
    expect(r).toMatchObject({ success: true, id: 7, saved: 'pending' });
    const insert = sent.find(s => /INSERT INTO team_lessons/.test(s.text));
    expect(insert.text).toMatch(/'pending'/);
    const expiresAt = Date.parse(insert.params[13]);
    expect(expiresAt - before).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000);
    expect(expiresAt - before).toBeLessThan(24 * 3600 * 1000 + 60 * 1000);
    expect(insert.params[14]).toBe(CARD);
  });

  test('confirming and discarding touch pending rows only', async () => {
    await store.confirmLesson(7);
    await store.discardLesson(7);
    expect(sent[0].text).toMatch(/SET state = 'active', confirmed_at = NOW\(\).*WHERE id = \$1 AND state = 'pending'/);
    expect(sent[1].text).toMatch(/DELETE FROM team_lessons WHERE id = \$1 AND state = 'pending'/);
  });

  test('expiry deletes only pending rows past their time, and returns their cards', async () => {
    answer = () => ({ rows: [{ id: 1, card_id: CARD }, { id: 2, card_id: CARD }] });
    const r = await store.expirePending(new Date('2026-09-25T12:00:00Z'));
    expect(sent[0].text).toMatch(/DELETE FROM team_lessons WHERE state = 'pending' AND expires_at <= \$1/);
    expect(r).toEqual({ expired: [1, 2], cardIds: [CARD] });
  });
});

describe('what save_team_lesson does with each kind of lesson', () => {
  test('already known: recorded on the card, not saved', async () => {
    const r = await saveTeamLesson({ lesson: 'x', topic: 'pivot end date', already_known: true, known_source: 'Granted\'s RTRI notes — Sept 21 guide changes' }, { userId: 1, chatContext: LEARN });
    expect(r).toMatchObject({ success: true, saved: false, already_known: true });
    expect(sent.some(s => /INSERT INTO team_lessons/.test(s.text))).toBe(false);
    const update = sent.find(s => /UPDATE tracked_cards/.test(s.text));
    expect(update.text).toMatch(/'\{known\}'/);
    expect(JSON.parse(update.params[1])[0]).toMatchObject({ topic: 'pivot end date', known_source: 'Granted\'s RTRI notes — Sept 21 guide changes' });
  });

  test('already known needs to say where', () => {
    expect(lessonRow({ lesson: 'x', topic: 't', already_known: true }, { chatContext: LEARN }).error).toMatch(/known_source/);
  });

  test('past the cap of 10: refused, counted on the card, nothing inserted', async () => {
    answer = (text) => (/count\(\*\)/.test(text) ? { rows: [{ n: 10 }] } : { rows: [] });
    const r = await saveTeamLesson(lesson, { userId: 1, chatContext: LEARN });
    expect(r).toMatchObject({ success: false, capped: true });
    expect(sent.some(s => /INSERT INTO team_lessons/.test(s.text))).toBe(false);
    expect(sent.find(s => /UPDATE tracked_cards/.test(s.text)).text).toMatch(/'\{overflow\}'/);
  });

  test('an edit run confirms that one lesson with the re-checked text — it never inserts', async () => {
    answer = (text) => (/UPDATE team_lessons/.test(text) ? { rows: [{ id: 5, status: 'verified' }] } : { rows: [] });
    const r = await saveTeamLesson(
      { lesson: 'new text', topic: 'acknowledgement', status: 'verified', source_label: 'Applicant Guide' },
      { userId: 1, chatContext: { ...LEARN, editLessonId: 5 } }
    );
    expect(r).toMatchObject({ success: true, id: 5, saved: 'active' });
    expect(sent.some(s => /INSERT INTO team_lessons/.test(s.text))).toBe(false);
    const update = sent.find(s => /UPDATE team_lessons/.test(s.text));
    expect(update.params.slice(0, 4)).toEqual([5, 'new text', 'verified', 'Applicant Guide']);
  });

  test('an edit of a lesson that is no longer pending says so', async () => {
    const r = await saveTeamLesson({ ...lesson }, { userId: 1, chatContext: { ...LEARN, editLessonId: 5 } });
    expect(r).toMatchObject({ success: false });
    expect(r.error).toMatch(/no longer pending/);
  });

  test('a document never verifies itself', () => {
    expect(lessonRow({ ...lesson, status: 'verified', from_document: 'Guide.pdf' }, { chatContext: LEARN }).error)
      .toMatch(/verified only by another source/);
    const { row } = lessonRow({ ...lesson, status: 'unverified', from_document: 'Guide.pdf' }, { chatContext: LEARN });
    expect(row.from_document).toBe('Guide.pdf');
  });

  test('a document fact is labelled as not yet in Granted\'s notes', () => {
    expect(store.statusLabel({ status: 'unverified', from_document: 'Guide.pdf' })).toBe('from Guide.pdf, not yet in Granted\'s notes');
  });
});
