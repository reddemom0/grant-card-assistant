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
  workingHours, localPosition, DEFAULT_DURATION_MINUTES, MIN_LEAD_MS,
  rescheduleIntent, parseStatedTime, nearestSlots, slotWordsAcross
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
  test('the default is 9–5, Monday to Friday, Vancouver when no calendar zone can be read', () => {
    expect(workingHours()).toMatchObject({ start: 9 * 60, end: 17 * 60, days: [1, 2, 3, 4, 5], timeZone: TZ, place: null, ownZone: false });
  });

  test('Chris works 10:00–22:00, Monday to Friday, shown as Barcelona', () => {
    expect(workingHours('Writers@Granted.ca')).toMatchObject({
      start: 10 * 60, end: 22 * 60, days: [1, 2, 3, 4, 5], timeZone: 'Europe/Madrid', place: 'Barcelona', ownZone: true
    });
  });

  test('somebody with no entry gets the default', () => {
    expect(workingHours('nobody@granted.ca')).toEqual(workingHours());
  });
});

// ============================================================================
// MOVING A MEETING, A STATED TIME, AND HOURS ACROSS ZONES
// ============================================================================

const MADRID = 'Europe/Madrid';
const chris = (busy = []) => ({ email: 'writers@granted.ca', timeZone: MADRID, busy, seen: true });
const local = (iso, tz = TZ) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

describe('rescheduleIntent', () => {
  test('asks to move a meeting', () => {
    expect(rescheduleIntent('move my call with @Nat to Friday')).toBe(true);
    expect(rescheduleIntent('can you reschedule the budget review?')).toBe(true);
    expect(rescheduleIntent('push our sync back an hour')).toBe(true);
    expect(rescheduleIntent('postpone the meeting with @Nat')).toBe(true);
    expect(meetIntent('move my call with @Nat to Friday')).toBe('meet');
  });

  test('other moves, and plain asks, are not', () => {
    expect(rescheduleIntent('move this to done')).toBe(false);
    expect(rescheduleIntent('find 30 min with @Nat')).toBe(false);
    expect(meetIntent('did we reschedule the call?')).toBeNull();
  });
});

describe('parseStatedTime', () => {
  test('a time with a day, in the asker’s zone', () => {
    expect(parseStatedTime('today at 11am', NOW, TZ)).toEqual({ at: new Date('2026-09-17T18:00:00Z'), words: '11am' });
    expect(parseStatedTime('tomorrow 2:30 pm', NOW, TZ)).toEqual({ at: new Date('2026-09-18T21:30:00Z'), words: '2:30pm' });
    expect(parseStatedTime('Monday at noon', NOW, TZ)).toEqual({ at: new Date('2026-09-21T19:00:00Z'), words: '12pm' });
    // The same words from Barcelona are Barcelona's 11am.
    expect(parseStatedTime('today at 11am', NOW, MADRID).at).toEqual(new Date('2026-09-17T09:00:00Z'));
  });

  test('no day: today if still ahead, otherwise tomorrow', () => {
    expect(parseStatedTime('at 3', NOW, TZ).at).toEqual(new Date('2026-09-17T22:00:00Z'));   // 3pm today
    expect(parseStatedTime('7am', NOW, TZ).at).toEqual(new Date('2026-09-18T14:00:00Z'));    // 7am tomorrow
    expect(parseStatedTime('at 14:00', NOW, TZ).words).toBe('2pm');
  });

  test('durations and plain asks are not times', () => {
    expect(parseStatedTime('find 30 min with @Nat this week', NOW, TZ)).toBeNull();
    expect(parseStatedTime('an hour at 2 hours notice', NOW, TZ)).toBeNull();
    expect(parseStatedTime('', NOW, TZ)).toBeNull();
  });
});

describe('nearestSlots', () => {
  const target = new Date('2026-09-17T18:00:00Z');   // 11am PDT

  test('a free time comes first, then the nearest two either side', () => {
    const r = nearestSlots({ target, durationMinutes: 30, people: [person('a@granted.ca'), person('b@granted.ca')], now: NOW, timeZone: TZ });
    expect(r).toMatchObject({ targetFits: true, reason: null });
    expect(r.slots.map(s => s.start)).toEqual(['2026-09-17T18:00:00.000Z', '2026-09-17T17:30:00.000Z', '2026-09-17T18:30:00.000Z']);
  });

  test('a taken time: the nearest three that day, never overlapping', () => {
    const r = nearestSlots({
      target, durationMinutes: 60, now: NOW, timeZone: TZ,
      people: [person('a@granted.ca', [busyBlock('2026-09-17T17:00:00Z', '2026-09-17T20:00:00Z')]), person('b@granted.ca')]
    });
    expect(r).toMatchObject({ targetFits: false, reason: 'busy' });
    // 9:00 and 13:00 are equally near; the earlier comes first.
    expect(r.slots.map(s => local(s.start))).toEqual(['09:00', '13:00', '14:00']);
  });

  test('a day with nothing left moves on to the next, earliest first', () => {
    const r = nearestSlots({
      target, durationMinutes: 30, now: NOW, timeZone: TZ,
      people: [person('a@granted.ca', [busyBlock('2026-09-17T07:00:00Z', '2026-09-18T07:00:00Z')])]
    });
    expect(r.slots).toHaveLength(3);
    expect(r.slots.every(s => s.start.startsWith('2026-09-18'))).toBe(true);
  });

  test('outside someone’s hours says so', () => {
    const r = nearestSlots({ target: new Date('2026-09-18T02:00:00Z'), durationMinutes: 30, people: [person('a@granted.ca')], now: NOW, timeZone: TZ });
    expect(r.reason).toBe('hours');
  });
});

describe('hours across zones', () => {
  const allOf = (people, words) => {
    const w = parseWindow(words, NOW, TZ);
    return findSlots({ durationMinutes: 30, from: w.from, to: w.to, now: NOW, people, max: 100 });
  };

  test('Chris in Barcelona with someone in Vancouver: 9am–1pm Vancouver only', () => {
    const slots = allOf([chris(), person('nat@granted.ca')], 'tomorrow');
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(local(s.start) >= '09:00').toBe(true);
      expect(local(s.end) <= '13:00').toBe(true);
    }
    // 1pm Vancouver is 10pm in Barcelona: the end of Chris's day.
    expect(local(slots.at(-1).end, MADRID) <= '22:00').toBe(true);
  });

  test('the overlap follows each zone’s own clock change', () => {
    // Europe falls back on 25 October, North America on 1 November: for that
    // week Barcelona is eight hours ahead, not nine, so the day runs to 2pm.
    const people = [chris(), person('nat@granted.ca')];
    const fitsAt = (iso, now) => nearestSlots({ target: new Date(iso), durationMinutes: 30, people, now, timeZone: TZ }).targetFits;

    // A 30-minute call must end by 10pm in Barcelona.
    // Wed 21 Oct: nine hours apart, so the last start is 12:30pm Vancouver.
    expect(fitsAt('2026-10-21T19:30:00Z', new Date('2026-10-20T15:00:00Z'))).toBe(true);    // 12:30pm PDT
    expect(fitsAt('2026-10-21T20:00:00Z', new Date('2026-10-20T15:00:00Z'))).toBe(false);   // 1:00pm PDT
    // Wed 28 Oct: eight hours apart, so the last start is 1:30pm Vancouver.
    expect(fitsAt('2026-10-28T20:30:00Z', new Date('2026-10-27T15:00:00Z'))).toBe(true);    // 1:30pm PDT
    expect(fitsAt('2026-10-28T21:00:00Z', new Date('2026-10-27T15:00:00Z'))).toBe(false);   // 2:00pm PDT
  });

  test('an all-Vancouver meeting is 9–5', () => {
    const slots = allOf([person('a@granted.ca'), person('b@granted.ca')], 'tomorrow');
    expect(local(slots[0].start)).toBe('09:00');
    expect(local(slots.at(-1).end) <= '17:00').toBe(true);
  });
});

describe('slotWordsAcross', () => {
  const slot = { start: '2026-10-06T16:00:00Z', end: '2026-10-06T16:30:00Z' };

  test('each attendee’s zone, the asker’s first; the place name when there is one', () => {
    expect(slotWordsAcross(slot, [{ timeZone: TZ }, { timeZone: MADRID, place: 'Barcelona' }]))
      .toBe('Tue Oct 6 · 9:00am Vancouver / 6:00pm Barcelona');
  });

  test('one zone when everyone shares it', () => {
    expect(slotWordsAcross(slot, [{ timeZone: TZ }, { timeZone: TZ }])).toBe('Tue Oct 6 · 9:00am Vancouver');
  });

  test('a zone already on the next day says which day', () => {
    expect(slotWordsAcross({ start: '2026-10-06T23:30:00Z' }, [{ timeZone: TZ }, { timeZone: MADRID, place: 'Barcelona' }]))
      .toBe('Tue Oct 6 · 4:30pm Vancouver / 1:30am Wed Barcelona');
  });
});
