/**
 * /meet — reading the ask, and finding times everyone is free
 *
 * Pure functions (the working-hours file is the only input read from disk).
 * Every clock here is fixed: Thursday 17 September 2026, 08:00 in Vancouver.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/meet-slots.test.js
 */

import {
  meetIntent, parseDuration, parseWindow, findSlots, slotMarks, slotWords, slotButtonWords,
  workingHours, localPosition, DEFAULT_DURATION_MINUTES, MIN_LEAD_MS
} from '../../src/cards/meet-slots.js';

const TZ = 'America/Vancouver';
const TORONTO = 'America/Toronto';
// Thursday 17 September 2026, 08:00 PDT.
const NOW = new Date('2026-09-17T15:00:00Z');
const HOUR = 60 * 60 * 1000;

const person = (email, busy = [], timeZone = TZ) => ({ email, timeZone, busy, seen: true });
const busyBlock = (start, end) => ({ start, end });

describe('meetIntent', () => {
  test('asks for a time', () => {
    expect(meetIntent('find 45 min with @Nat this week')).toBe('meet');
    expect(meetIntent('set up a call with @Nat')).toBe('meet');
    expect(meetIntent('schedule a meeting about RTRI')).toBe('meet');
    expect(meetIntent('when are we all free?')).toBe('meet');
  });

  test('questions about the past, and ordinary questions, are not asks', () => {
    expect(meetIntent('when did we meet about RTRI?')).toBeNull();
    expect(meetIntent('what was decided on the last call?')).toBeNull();
    expect(meetIntent('what is the RTRI deadline?')).toBeNull();
    expect(meetIntent('')).toBeNull();
  });
});

describe('parseDuration', () => {
  test('minutes and hours out of the words', () => {
    expect(parseDuration('find 45 min with @Nat')).toBe(45);
    expect(parseDuration('90 minutes please')).toBe(90);
    expect(parseDuration('an hour with the team')).toBe(60);
    expect(parseDuration('2 hours')).toBe(120);
    expect(parseDuration('half an hour')).toBe(30);
    expect(parseDuration('quick call')).toBe(15);
  });

  test('nothing said is 30 minutes', () => {
    expect(parseDuration('set up a call with @Nat')).toBe(DEFAULT_DURATION_MINUTES);
    expect(parseDuration('')).toBe(30);
  });

  test('a silly duration is ignored', () => {
    expect(parseDuration('3000 minutes')).toBe(30);
    expect(parseDuration('1 min')).toBe(30);
  });
});

describe('parseWindow', () => {
  test('the default window is the next three working days', () => {
    const w = parseWindow('set up a call', NOW, TZ);
    expect(w.words).toBeNull();
    expect(w.from).toEqual(NOW);
    // Thursday + Fri, Mon, Tue → ends at the start of Wednesday.
    expect(localPosition(new Date(w.to.getTime() - HOUR), TZ).date).toBe('2026-09-22');
  });

  test('"this week" ends after Friday, "next week" starts on Monday', () => {
    const week = parseWindow('this week', NOW, TZ);
    expect(week.words).toBe('this week');
    expect(localPosition(new Date(week.to.getTime() - HOUR), TZ).date).toBe('2026-09-18');

    const next = parseWindow('next week', NOW, TZ);
    expect(localPosition(next.from, TZ)).toMatchObject({ weekday: 1, date: '2026-09-21' });
  });

  test('"tomorrow" and a weekday are that local day', () => {
    expect(localPosition(parseWindow('tomorrow', NOW, TZ).from, TZ).date).toBe('2026-09-18');
    expect(localPosition(parseWindow('how about monday?', NOW, TZ).from, TZ)).toMatchObject({ weekday: 1 });
  });

  test('the asker’s own zone decides which day "tomorrow" is', () => {
    // 23:30 in Vancouver is already the next day in Toronto.
    const late = new Date('2026-09-18T06:30:00Z');
    expect(localPosition(parseWindow('tomorrow', late, TZ).from, TZ).date).toBe('2026-09-18');
    expect(localPosition(parseWindow('tomorrow', late, TORONTO).from, TORONTO).date).toBe('2026-09-19');
  });
});

describe('findSlots', () => {
  const window = () => parseWindow('this week', NOW, TZ);

  test('the three earliest times everyone is free, at least two hours out', () => {
    const w = window();
    const slots = findSlots({
      durationMinutes: 30, from: w.from, to: w.to, now: NOW,
      people: [person('a@granted.ca'), person('b@granted.ca')]
    });

    expect(slots).toHaveLength(3);
    expect(new Date(slots[0].start).getTime() - NOW.getTime()).toBeGreaterThanOrEqual(MIN_LEAD_MS);
    // 08:00 + 2h = 10:00 local, and each option is spread out from the last.
    expect(slotWords(slots[0], TZ)).toContain('10:00 AM');
    expect(new Date(slots[1].start) - new Date(slots[0].start)).toBeGreaterThanOrEqual(2 * HOUR);
  });

  test('a busy block is never offered', () => {
    const w = window();
    const slots = findSlots({
      durationMinutes: 30, from: w.from, to: w.to, now: NOW,
      people: [
        person('a@granted.ca', [busyBlock('2026-09-17T17:00:00Z', '2026-09-17T20:00:00Z')]),  // 10–13 local
        person('b@granted.ca')
      ]
    });
    expect(slotWords(slots[0], TZ)).toContain('1:00 PM');
    const blockFrom = Date.parse('2026-09-17T17:00:00Z');
    const blockTo = Date.parse('2026-09-17T20:00:00Z');
    for (const slot of slots) {
      const start = Date.parse(slot.start);
      const end = Date.parse(slot.end);
      expect(end <= blockFrom || start >= blockTo).toBe(true);
    }
  });

  test('nothing outside 9–5 local, and nothing at the weekend', () => {
    const w = parseWindow('this week', NOW, TZ);
    const slots = findSlots({
      durationMinutes: 60, from: w.from, to: w.to, now: NOW,
      people: [person('a@granted.ca'), person('b@granted.ca')]
    });
    for (const slot of slots) {
      const start = localPosition(new Date(slot.start), TZ);
      const end = localPosition(new Date(slot.end), TZ);
      expect(start.weekday).toBeLessThanOrEqual(5);
      expect(start.minutes).toBeGreaterThanOrEqual(9 * 60);
      expect(end.minutes).toBeLessThanOrEqual(17 * 60);
    }
  });

  test('two zones only overlap where both are inside working hours', () => {
    const w = parseWindow('tomorrow', NOW, TZ);
    const slots = findSlots({
      durationMinutes: 30, from: w.from, to: w.to, now: NOW,
      people: [person('west@granted.ca'), person('east@granted.ca', [], TORONTO)]
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const west = localPosition(new Date(slot.start), TZ);
      const east = localPosition(new Date(slot.end), TORONTO);
      expect(west.minutes).toBeGreaterThanOrEqual(9 * 60);
      expect(east.minutes).toBeLessThanOrEqual(17 * 60);
    }
    // Vancouver 09:00 is noon in Toronto, so the first option is a Toronto afternoon.
    expect(slotWords(slots[0], TORONTO)).toContain('PM');
  });

  test('a full window gives nothing rather than a bad time', () => {
    const w = parseWindow('tomorrow', NOW, TZ);
    const allDay = [busyBlock('2026-09-18T00:00:00Z', '2026-09-19T00:00:00Z')];
    expect(findSlots({
      durationMinutes: 30, from: w.from, to: w.to, now: NOW,
      people: [person('a@granted.ca', allDay), person('b@granted.ca')]
    })).toEqual([]);
  });

  test('ignoring working hours offers evenings, but still never a busy block', () => {
    const w = parseWindow('tomorrow', NOW, TZ);
    const people = [person('a@granted.ca', [busyBlock('2026-09-18T16:00:00Z', '2026-09-19T03:00:00Z')]), person('b@granted.ca')];
    expect(findSlots({ durationMinutes: 30, from: w.from, to: w.to, now: NOW, people })).toEqual([]);

    const outside = findSlots({ durationMinutes: 30, from: w.from, to: w.to, now: NOW, people, ignoreHours: true });
    expect(outside.length).toBeGreaterThan(0);
    for (const slot of outside) {
      expect(Date.parse(slot.start) >= Date.parse('2026-09-19T03:00:00Z')
        || Date.parse(slot.end) <= Date.parse('2026-09-18T16:00:00Z')).toBe(true);
    }
  });

  test('no people means no slots', () => {
    const w = window();
    expect(findSlots({ durationMinutes: 30, from: w.from, to: w.to, now: NOW, people: [] })).toEqual([]);
  });
});

describe('the card’s wording', () => {
  test('marks say who is busy and whose calendar was not visible', () => {
    const slot = { start: '2026-09-18T17:00:00Z', end: '2026-09-18T17:30:00Z' };
    const marks = slotMarks(slot, [
      { email: 'a@granted.ca', name: 'A Person', busy: [], seen: true },
      { email: 'b@granted.ca', name: 'B Person', busy: [busyBlock('2026-09-18T17:15:00Z', '2026-09-18T18:00:00Z')], seen: true },
      { email: 'c@outside.test', name: null, busy: [], seen: false }
    ]);
    expect(marks[0]).toMatchObject({ free: true, seen: true });
    expect(marks[1]).toMatchObject({ free: false });
    expect(marks[2]).toMatchObject({ seen: false });
  });

  test('times are written in the reader’s own zone', () => {
    const slot = { start: '2026-09-18T17:00:00Z', end: '2026-09-18T17:30:00Z' };
    expect(slotWords(slot, TZ)).toBe('Fri, Sep 18, 10:00 AM–10:30 AM PDT');
    expect(slotWords(slot, TORONTO)).toContain('1:00');
    expect(slotButtonWords(slot, TZ)).toBe('10:00 AM Fri');
  });
});

describe('working hours', () => {
  test('the default is 9–5, Monday to Friday', () => {
    expect(workingHours()).toEqual({ start: 9 * 60, end: 17 * 60, days: [1, 2, 3, 4, 5] });
  });

  test('somebody with no entry gets the default', () => {
    expect(workingHours('nobody@granted.ca')).toEqual(workingHours());
  });
});
