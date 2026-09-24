/**
 * /learn-this — team-taught lessons
 *
 * The command matcher, the learn-run message, the rules save_team_lesson enforces
 * before anything is written, and how lessons are labelled when they reach an
 * answer. No database: saves are refused before they get that far, and the
 * labels are formatted from plain rows.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/team-lessons.test.js
 */

import { learnIntent, buildLearnMessage, saveTeamLesson, lessonRow, textAfterCommand, LEARN_MODE_TOOLS } from '../../src/tools/team-lessons.js';
import { selectRecentOwnMessages, DM_LEARN_WINDOW_MS } from '../../src/tools/chat-attachments.js';
import { formatLessons } from '../../src/database/team-lessons-store.js';
import { userContentToStore, toolsForRun } from '../../src/claude/client.js';
import { attachmentPlaceholder } from '../../src/tools/chat-attachments.js';

const LEARN_CTX = { learnMode: true, spaceName: 'spaces/AAA', threadName: 'spaces/AAA/threads/TTT' };

describe('the command', () => {
  test.each(['/learn-this', '/learn-this please', 'learn this', 'Learn-this', '  /learn-this'])('"%s" is /learn-this', text => {
    expect(learnIntent(text)).toBe(true);
  });

  test.each(['can you learn this for me', 'learnthis', '/learn', 'what did you learn this week', ''])('"%s" is not', text => {
    expect(learnIntent(text)).toBe(false);
  });
});

describe('the learn run', () => {
  test('may only read, check, and save a lesson', () => {
    expect(LEARN_MODE_TOOLS).toContain('save_team_lesson');
    for (const writer of ['create_google_doc', 'update_hubspot_deal', 'create_calendar_event', 'track_review', 'memory_store']) {
      expect(LEARN_MODE_TOOLS).not.toContain(writer);
    }
  });

  test('the run gets exactly those tools, and a normal run keeps its full set', () => {
    const restricted = toolsForRun('internal-oracle', LEARN_MODE_TOOLS).map(t => t.name);
    expect(new Set(restricted)).toEqual(new Set(LEARN_MODE_TOOLS));
    expect(toolsForRun('internal-oracle').length).toBeGreaterThan(restricted.length);
  });

  test('the message carries the transcript in order, with files named', () => {
    const msg = buildLearnMessage([
      { sender: 'Kelly', time: '2026-09-23T10:00:00Z', text: 'PacifiCan says hauling trailers are vehicles', files: [] },
      { sender: 'Chris', time: '2026-09-23T10:05:00Z', text: '', files: ['note.pdf'] }
    ], '/learn-this about vehicles');
    expect(msg).toMatch(/Kelly \(2026-09-23T10:00:00Z\): PacifiCan says hauling trailers are vehicles/);
    expect(msg).toMatch(/Chris .*\(no text\) \[attached: note\.pdf\]/);
    expect(msg.indexOf('Kelly')).toBeLessThan(msg.indexOf('Chris'));
    expect(msg).toMatch(/added: about vehicles/);
  });

  test('the transcript is saved as a placeholder, like a Chat file', () => {
    const transcript = { type: 'text', text: buildLearnMessage([{ sender: 'Kelly', time: 't', text: 'secret', files: [] }]) };
    const stored = userContentToStore([transcript, { type: 'text', text: '/learn-this' }], new Map([[0, 'thread transcript']]));
    expect(stored[0]).toEqual({ type: 'text', text: attachmentPlaceholder('thread transcript') });
    expect(JSON.stringify(stored)).not.toMatch(/secret/);
  });
});

describe('save_team_lesson refuses before writing', () => {
  const lesson = { lesson: 'Hauling equipment counts as a motorized vehicle.', topic: 'motorized vehicles', skill: 'rtri-tariff' };

  test('outside a /learn-this run', async () => {
    const r = await saveTeamLesson({ ...lesson, status: 'unverified' }, { userId: 1, chatContext: { surface: 'chat_space' } });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/only when someone uses \/learn-this/);
  });

  test('without a thread to link back to', async () => {
    const r = await saveTeamLesson({ ...lesson, status: 'unverified' }, { userId: 1, chatContext: { learnMode: true } });
    expect(r.success).toBe(false);
  });

  test('with an unknown status', async () => {
    const r = await saveTeamLesson({ ...lesson, status: 'probably' }, { userId: 1, chatContext: LEARN_CTX });
    expect(r.error).toMatch(/verified, unverified, conflict/);
  });

  test.each(['verified', 'conflict'])('a %s lesson without its source', async status => {
    const r = await saveTeamLesson({ ...lesson, status }, { userId: 1, chatContext: LEARN_CTX });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/needs the source/);
  });

  test('without lesson text or topic', async () => {
    const r = await saveTeamLesson({ status: 'unverified' }, { userId: 1, chatContext: LEARN_CTX });
    expect(r.success).toBe(false);
  });
});

describe('how lessons are labelled in answers', () => {
  const base = {
    topic: 'motorized vehicles',
    lesson: 'Hauling equipment counts as a motorized vehicle.',
    taught_by_name: 'Kelly',
    taught_at: '2026-09-23T16:00:00Z',
    thread_link: 'https://chat.google.com/room/AAA/TTT'
  };

  test('nothing to add when there are no lessons', () => {
    expect(formatLessons([])).toBe('');
  });

  test('unverified: who, when, status, and the thread', () => {
    const block = formatLessons([{ ...base, status: 'unverified' }]);
    expect(block).toMatch(/not official/);
    expect(block).toMatch(/Team note from Kelly, Sept 23, 2026 \(unverified\) — motorized vehicles: Hauling equipment/);
    expect(block).toMatch(/thread: https:\/\/chat\.google\.com\/room\/AAA\/TTT/);
  });

  test('verified names its source', () => {
    const block = formatLessons([{ ...base, status: 'verified', source_label: 'Applicant Guide', source_url: 'https://example.ca/guide' }]);
    expect(block).toMatch(/\(verified — Applicant Guide \(https:\/\/example\.ca\/guide\)\)/);
  });

  test('a conflict says the official source wins', () => {
    const block = formatLessons([{ ...base, status: 'conflict', source_label: "Granted's RTRI notes" }]);
    expect(block).toMatch(/conflicts with Granted's RTRI notes — the official source wins/);
    expect(block).toMatch(/Official sources win/);
  });
});

describe('/learn-this in a direct message', () => {
  const DM_CTX = {
    learnMode: true,
    surface: 'chat_dm',
    spaceName: 'spaces/DM1',
    threadName: 'spaces/DM1/threads/X',
    senderDisplayName: 'Kelly Tran'
  };
  const lesson = { lesson: 'Acknowledgement comes within 10 business days.', topic: 'acknowledgement time', status: 'unverified' };

  test('the text after the command is the lesson', () => {
    expect(textAfterCommand('/learn-this acknowledgement takes 10 business days')).toBe('acknowledgement takes 10 business days');
    expect(textAfterCommand('learn this')).toBe('');
  });

  test('the learn message says who is teaching and shows what they sent', () => {
    const msg = buildLearnMessage([{ sender: 'Kelly Tran', time: 't', text: 'acknowledgement takes 10 business days', files: [] }], '/learn-this acknowledgement takes 10 business days', { dm: true });
    expect(msg).toMatch(/direct message/);
    expect(msg).toMatch(/Kelly Tran \(t\): acknowledgement takes 10 business days/);
    expect(msg).not.toMatch(/Thread transcript/);
  });

  test('a DM lesson needs no thread, stores no thread or link, and is taught by the person in the DM', () => {
    const { row, error } = lessonRow({ ...lesson, taught_by_name: 'Someone Else' }, { userId: 7, chatContext: DM_CTX });
    expect(error).toBeUndefined();
    expect(row).toMatchObject({
      taught_in: 'dm',
      thread_name: null,
      thread_link: null,
      space_name: 'spaces/DM1',
      taught_by_name: 'Kelly Tran',
      captured_by: 7
    });
  });

  test('a DM lesson without a thread in the event still saves', () => {
    const { row } = lessonRow(lesson, { userId: 7, chatContext: { ...DM_CTX, threadName: null } });
    expect(row.taught_in).toBe('dm');
  });

  test('a space lesson keeps its thread link and the teacher Oracle named', () => {
    const { row } = lessonRow({ ...lesson, taught_by_name: 'Fadi' }, { userId: 7, chatContext: { ...LEARN_CTX, surface: 'chat_space' } });
    expect(row).toMatchObject({
      taught_in: 'space',
      thread_name: 'spaces/AAA/threads/TTT',
      thread_link: 'https://chat.google.com/room/AAA/TTT',
      taught_by_name: 'Fadi'
    });
  });

  test('the same status and source rules apply in a DM', () => {
    expect(lessonRow({ ...lesson, status: 'verified' }, { chatContext: DM_CTX }).error).toMatch(/needs the source/);
    expect(lessonRow({ ...lesson, status: 'maybe' }, { chatContext: DM_CTX }).error).toMatch(/status must be/);
  });

  test('labelled "taught by [name] in a DM", with no link', () => {
    const block = formatLessons([{
      ...lesson,
      taught_by_name: 'Kelly Tran',
      taught_at: '2026-09-23T16:00:00Z',
      taught_in: 'dm',
      thread_link: null
    }]);
    expect(block).toMatch(/Team note taught by Kelly Tran in a DM, Sept 23, 2026 \(unverified\) — acknowledgement time: /);
    expect(block).not.toMatch(/thread:/);
  });

  describe('when the command is alone: the person\'s recent messages', () => {
    const now = Date.parse('2026-09-24T12:00:00Z');
    const at = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();
    const mine = (name, minutesAgo) => ({ name, sender: { name: 'users/KELLY' }, createTime: at(minutesAgo), text: name });

    test('only theirs, only the last 10 minutes, never the command, oldest first', () => {
      const picked = selectRecentOwnMessages([
        mine('m1', 2),
        { name: 'bot', sender: { name: 'users/ORACLE' }, createTime: at(1), text: 'reply' },
        mine('old', 11),
        mine('cmd', 0),
        mine('m2', 5)
      ], { senderChatId: 'users/KELLY', excludeMessageName: 'cmd', now });
      expect(picked.map(m => m.name)).toEqual(['m2', 'm1']);
    });

    test('at most five — the most recent five', () => {
      const msgs = [1, 2, 3, 4, 5, 6, 7].map(i => mine(`m${i}`, i));
      const picked = selectRecentOwnMessages(msgs, { senderChatId: 'users/KELLY', now });
      expect(picked.map(m => m.name)).toEqual(['m5', 'm4', 'm3', 'm2', 'm1']);
    });

    test('the window is ten minutes', () => {
      expect(DM_LEARN_WINDOW_MS).toBe(10 * 60 * 1000);
    });

    test('nothing recent → nothing picked', () => {
      expect(selectRecentOwnMessages([mine('old', 30)], { senderChatId: 'users/KELLY', now })).toEqual([]);
    });
  });
});
