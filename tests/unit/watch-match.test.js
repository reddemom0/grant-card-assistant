/**
 * /watch — which program a post is about, and when to say something
 *
 * Pure functions only (matchProgram, the one read, is covered in
 * watch-card.test.js with the fake grants table).
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/watch-match.test.js
 */

import {
  watchIntent, stopWatchIntent, programFromPost, programKey, watchThreadName, keyFromWatchThread,
  dateFromText, datesFromPost, closureFromPost, postMatchesProgram, dueNotices,
  CHECK_AFTER_DAYS, DEADLINE_NOTICES
} from '../../src/cards/watch-match.js';

const NOW = new Date('2026-09-17T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(NOW.getTime() + n * DAY).toISOString();

describe('the trigger is never automatic', () => {
  test('only an explicit ask starts a watch', () => {
    expect(watchIntent('watch')).toBe('watch');
    expect(watchIntent('watch this')).toBe('watch');
    expect(watchIntent('start watching this one')).toBe('watch');
  });

  test('a post about a program, or a question, starts nothing', () => {
    expect(watchIntent('RTRI changed its deadline again')).toBeNull();
    expect(watchIntent('what is the RTRI deadline?')).toBeNull();
    expect(watchIntent('keep an eye on this')).toBeNull();   // that is /track
    expect(watchIntent('')).toBeNull();
  });

  test('stopping is its own wording', () => {
    expect(stopWatchIntent('stop watching')).toBe('stop');
    expect(stopWatchIntent('unwatch')).toBe('stop');
    expect(stopWatchIntent('watch this')).toBeNull();
  });
});

describe('programFromPost', () => {
  test('a label in front of a link wins', () => {
    const found = programFromPost('Rural Transportation Research Initiative: https://granted.ca/rtri');
    expect(found.name).toBe('Rural Transportation Research Initiative');
    expect(found.url).toBe('https://granted.ca/rtri');
  });

  test('a Title Case name, then an acronym', () => {
    expect(programFromPost('Heads up: the Canada Summer Jobs intake moved').name).toContain('Canada Summer Jobs');
    expect(programFromPost('ETG is open again').name).toBe('ETG');
    expect(programFromPost('ETG is open again').acronym).toBe('ETG');
  });

  test('nothing to go on', () => {
    expect(programFromPost('that changed again').name).toBeNull();
    expect(programFromPost('').name).toBeNull();
  });
});

describe('one watch per program per space', () => {
  test('the key is a slug, and the thread key round-trips', () => {
    expect(programKey('Rural Transportation Research Initiative (RTRI)')).toBe('rural-transportation-research-initiative-rtri');
    const thread = watchThreadName('spaces/TEAM', 'rtri');
    expect(thread).toBe('spaces/TEAM/threads/watch-rtri');
    expect(keyFromWatchThread(thread)).toBe('rtri');
  });

  test('the same program written differently lands on the same key', () => {
    expect(programKey('Canada Summer Jobs')).toBe(programKey('canada summer jobs'));
    expect(programKey('Canada  Summer—Jobs')).toBe('canada-summer-jobs');
  });

  test('an empty name still gives a usable key', () => {
    expect(programKey('')).toBe('unnamed');
  });
});

describe('dates written in a post', () => {
  test('a month and day, with or without a year', () => {
    expect(dateFromText('closes November 15, 2026', NOW).toISOString()).toBe('2026-11-15T12:00:00.000Z');
    expect(dateFromText('closes Nov 15', NOW).toISOString()).toBe('2026-11-15T12:00:00.000Z');
    expect(dateFromText('2026-11-15', NOW).toISOString()).toBe('2026-11-15T12:00:00.000Z');
  });

  test('a date already past means next year', () => {
    expect(dateFromText('closes Feb 1', NOW).toISOString()).toBe('2027-02-01T12:00:00.000Z');
  });

  test('opens and closes are read separately', () => {
    const dates = datesFromPost('The intake opens October 1 and closes Nov 15, 2026.', NOW);
    expect(dates.opensAt.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(dates.deadline.toISOString()).toBe('2026-11-15T12:00:00.000Z');
  });

  test('a post with no dates gives none — nothing is invented', () => {
    expect(datesFromPost('RTRI eligibility changed again.', NOW)).toEqual({ opensAt: null, deadline: null });
    expect(dateFromText('sometime next quarter', NOW)).toBeNull();
  });
});

describe('closureFromPost', () => {
  test('closed, and nearly gone', () => {
    expect(closureFromPost('Heads up — the fund is now closed for the year')).toBe('closed');
    expect(closureFromPost('applications are fully subscribed')).toBe('closed');
    expect(closureFromPost('funds are running out, last chance')).toBe('nearly_gone');
  });

  test('ordinary news is neither', () => {
    expect(closureFromPost('the guidelines changed')).toBeNull();
  });
});

describe('postMatchesProgram', () => {
  const program = { name: 'Rural Transportation Research Initiative (RTRI)', url: 'https://granted.ca/rtri' };

  test('the name, the acronym or the link count as a match', () => {
    expect(postMatchesProgram('Any news on RTRI?', program)).toBe(true);
    expect(postMatchesProgram('Rural Transportation Research Initiative (RTRI) moved its deadline', program)).toBe(true);
    expect(postMatchesProgram('see https://granted.ca/rtri for the change', program)).toBe(true);
  });

  test('an unrelated post does not', () => {
    expect(postMatchesProgram('Canada Summer Jobs opened today', program)).toBe(false);
    expect(postMatchesProgram('', program)).toBe(false);
    expect(postMatchesProgram('RTRI', {})).toBe(false);
  });
});

describe('dueNotices', () => {
  const program = (extra) => ({ name: 'RTRI', ...extra });

  test('the day before it opens', () => {
    const { due } = dueNotices({ program: program({ opensAt: inDays(1) }), now: NOW });
    expect(due).toEqual([{ kind: 'opens', text: 'RTRI opens tomorrow.' }]);
  });

  test('14 days and 2 days before the deadline, nearest mark first', () => {
    expect(dueNotices({ program: program({ deadline: inDays(10) }), now: NOW }).due[0].kind).toBe(`deadline_${DEADLINE_NOTICES[0]}`);
    expect(dueNotices({ program: program({ deadline: inDays(2) }), now: NOW }).due[0].kind).toBe('deadline_2');
    expect(dueNotices({ program: program({ deadline: inDays(30) }), now: NOW }).due).toEqual([]);
  });

  test('the day after the deadline ends the watch', () => {
    const { due, ends } = dueNotices({ program: program({ deadline: inDays(-1) }), now: NOW });
    expect(ends).toBe(true);
    expect(due[0].kind).toBe('deadline_passed');
  });

  test('a kind already sent is never repeated', () => {
    const sent = { deadline_2: '2026-09-15' };
    expect(dueNotices({ program: program({ deadline: inDays(2) }), sent, now: NOW }).due).toEqual([]);
  });

  test('no dates: the six-month question, and nothing before it', () => {
    const young = new Date(NOW.getTime() - 30 * DAY).toISOString();
    expect(dueNotices({ program: program(), createdAt: young, now: NOW }).due).toEqual([]);

    const old = new Date(NOW.getTime() - (CHECK_AFTER_DAYS + 1) * DAY).toISOString();
    const { due } = dueNotices({ program: program(), createdAt: old, now: NOW });
    expect(due[0].kind).toBe('still_watching');
  });

  test('a program with a deadline never gets the six-month question', () => {
    const old = new Date(NOW.getTime() - (CHECK_AFTER_DAYS + 1) * DAY).toISOString();
    const { due } = dueNotices({ program: program({ deadline: inDays(60) }), createdAt: old, now: NOW });
    expect(due).toEqual([]);
  });
});
