/**
 * /meet — finding times, without a model
 *
 * Pure functions over free/busy blocks: no I/O except the working-hours file,
 * which is read once per process. What the card asks Google for is in
 * meet-card.js.
 *
 * Working hours are assumed, not read: no Google API exposes them (Calendar's
 * Settings has no working-hours key, and reading settings at all would need a
 * scope Oracle does not have). data/cards/working-hours.json is the override.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { tzOffsetMinutes } from './render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULT_DURATION_MINUTES = 30;
export const DEFAULT_WINDOW_DAYS = 3;
/** Nothing is offered less than this far out — nobody books a call in ten minutes. */
export const MIN_LEAD_MS = 2 * HOUR;
/** Candidate starts are on the quarter hour. */
const STEP_MS = 15 * MINUTE;
/** Two offered slots are at least this far apart, so three options feel like three. */
const SPREAD_MS = 2 * HOUR;
const MAX_SLOTS = 3;
const MAX_DAYS_SCANNED = 21;

// ============================================================================
// WORKING HOURS
// ============================================================================

let hours = null;

const HHMM = /^(\d{1,2}):(\d{2})$/;

function minutesOfDay(value, fallback) {
  const m = HHMM.exec(String(value || ''));
  if (!m) return fallback;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60 ? minutes : fallback;
}

function loadHours() {
  if (hours) return hours;
  const fallback = { start: 9 * 60, end: 17 * 60, days: [1, 2, 3, 4, 5] };
  try {
    const raw = JSON.parse(readFileSync(join(__dirname, '../../data/cards/working-hours.json'), 'utf8'));
    const shape = (entry, base) => ({
      start: minutesOfDay(entry?.start, base.start),
      end: minutesOfDay(entry?.end, base.end),
      days: Array.isArray(entry?.days) && entry.days.length
        ? entry.days.map(Number).filter(d => d >= 1 && d <= 7)
        : base.days
    });
    const base = shape(raw.default, fallback);
    hours = {
      base,
      people: new Map(Object.entries(raw.people || {}).map(([email, entry]) => [
        String(email).trim().toLowerCase(), shape(entry, base)
      ]))
    };
  } catch (err) {
    console.warn(`⚠️  Working-hours file unreadable — code: ${err?.code || err?.name || 'unknown'}`);
    hours = { base: fallback, people: new Map() };
  }
  return hours;
}

/** This person's working hours, in their own local time. */
export function workingHours(email = null) {
  const { base, people } = loadHours();
  const own = email ? people.get(String(email).trim().toLowerCase()) : null;
  return own || base;
}

// ============================================================================
// WHAT THE ASK SAYS
// ============================================================================

const DURATION = /\b(\d{1,3})\s*(min(?:ute)?s?|m|hours?|hrs?|h)\b/i;
const HALF_HOUR = /\bhalf(?:[\s-]an?)?[\s-]hour\b/i;
const QUICK = /\b(?:quick (?:call|chat|sync)|15)\b/i;

/** Minutes, from "45 min", "an hour", "half an hour"; 30 when nothing says. */
export function parseDuration(text) {
  const t = String(text || '');
  const m = DURATION.exec(t);
  if (m) {
    const n = Number(m[1]);
    const minutes = /^h/i.test(m[2]) ? n * 60 : n;
    if (minutes >= 5 && minutes <= 8 * 60) return minutes;
  }
  if (HALF_HOUR.test(t)) return 30;
  if (/\ban hour\b/i.test(t)) return 60;
  if (QUICK.test(t)) return 15;
  return DEFAULT_DURATION_MINUTES;
}

/**
 * Does this @Oracle message ask for a time to be found? Plain wording, checked
 * before the model, like trackIntent and leadIntent.
 *
 * @returns {'meet'|null} null → answer normally
 */
export function meetIntent(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  // "when did we meet about X?" is a question about the past, not a request.
  if (/\b(?:did|was|were|last)\b/i.test(t) && /\?\s*$/.test(t)) return null;
  const asks = [
    /\bfind\s+(?:a\s+)?(?:\d{1,3}\s*(?:min(?:ute)?s?|hours?|hrs?|h)|time|slot)\b/i,
    /\b(?:set up|schedule|book|arrange|organise|organize)\s+(?:a\s+)?(?:call|meeting|chat|sync|catch[\s-]?up)\b/i,
    /\bwhen\s+(?:are|is)\s+(?:we|everyone|you)\b.*\bfree\b/i,
    /\bget\s+(?:us|everyone)\s+(?:a\s+)?(?:time|call|meeting)\b/i
  ];
  return asks.some(re => re.test(t)) ? 'meet' : null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * The window to search, from the words in the ask. Default: from now to the end
 * of the third working day.
 *
 * @param {string} text
 * @param {Date} now
 * @param {string} timeZone - the asker's zone, so "tomorrow" means their tomorrow
 * @returns {{from: Date, to: Date, words: string|null}}
 */
export function parseWindow(text, now = new Date(), timeZone = 'UTC') {
  const t = String(text || '').toLowerCase();
  const startOfLocalDay = (date) => localMidnight(date, timeZone);

  if (/\btomorrow\b/.test(t)) {
    const from = startOfLocalDay(new Date(now.getTime() + DAY));
    return { from, to: new Date(from.getTime() + DAY), words: 'tomorrow' };
  }
  if (/\btoday\b/.test(t)) {
    return { from: now, to: new Date(startOfLocalDay(now).getTime() + DAY), words: 'today' };
  }
  if (/\bnext week\b/.test(t)) {
    const from = nextWeekday(now, 1, timeZone, { skipThisWeek: true });
    return { from, to: new Date(from.getTime() + 5 * DAY), words: 'next week' };
  }
  if (/\bthis week\b/.test(t)) {
    const friday = nextWeekday(now, 5, timeZone);
    return { from: now, to: new Date(friday.getTime() + DAY), words: 'this week' };
  }
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) {
      const from = nextWeekday(now, i === 0 ? 7 : i, timeZone);
      return { from, to: new Date(from.getTime() + DAY), words: WEEKDAYS[i] };
    }
  }
  // Default: the next three working days, ending at the end of the third.
  const from = now;
  let to = startOfLocalDay(now);
  for (let added = 0; added < DEFAULT_WINDOW_DAYS;) {
    to = new Date(to.getTime() + DAY);
    if (isWorkingDay(to, timeZone)) added++;
  }
  return { from, to: new Date(to.getTime() + DAY), words: null };
}

/** Midnight at the start of this instant's local day, as a real instant. */
function localMidnight(at, timeZone) {
  const parts = localParts(at, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  return new Date(asUtc - tzOffsetMinutes(new Date(asUtc), timeZone) * MINUTE);
}

function localParts(at, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(at).map(part => [part.type, part.value]));
  const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute),
    weekday: weekdays[p.weekday] || 1
  };
}

/** Minutes past local midnight, and the local weekday (1–7). */
export function localPosition(at, timeZone) {
  const p = localParts(at, timeZone);
  return { minutes: p.hour * 60 + p.minute, weekday: p.weekday, date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` };
}

function isWorkingDay(at, timeZone, days = [1, 2, 3, 4, 5]) {
  return days.includes(localPosition(at, timeZone).weekday);
}

/** The next instant that is local midnight on that weekday (1=Mon…7=Sun). */
function nextWeekday(now, weekday, timeZone, { skipThisWeek = false } = {}) {
  let day = localMidnight(now, timeZone);
  if (skipThisWeek) {
    // Move past this week first, then land on the weekday asked for.
    while (localPosition(day, timeZone).weekday !== 7) day = new Date(day.getTime() + DAY);
    day = new Date(day.getTime() + DAY);
    while (localPosition(day, timeZone).weekday !== weekday) day = new Date(day.getTime() + DAY);
    return day;
  }
  for (let i = 0; i < 14; i++) {
    const at = new Date(day.getTime() + i * DAY);
    if (localPosition(at, timeZone).weekday === weekday && at.getTime() >= localMidnight(now, timeZone).getTime()) return at;
  }
  return day;
}

// ============================================================================
// FINDING SLOTS
// ============================================================================

const overlaps = (start, end, busy) =>
  busy.some(b => start < new Date(b.end).getTime() && end > new Date(b.start).getTime());

function insideHours(startMs, endMs, person, ignoreHours) {
  if (ignoreHours) return true;
  const own = workingHours(person.email);
  const start = localPosition(new Date(startMs), person.timeZone);
  const end = localPosition(new Date(endMs), person.timeZone);
  if (!own.days.includes(start.weekday)) return false;
  // A slot that runs past the end of the day, or into the next one, is out.
  if (end.date !== start.date) return false;
  return start.minutes >= own.start && (end.minutes || 24 * 60) <= own.end;
}

/**
 * The earliest times everyone is free, in their own working hours.
 *
 * @param {Object} p
 * @param {number} p.durationMinutes
 * @param {Date} p.from - window start
 * @param {Date} p.to - window end
 * @param {Array<{email: string, timeZone: string, busy: Array<{start: string, end: string}>, seen?: boolean}>} p.people
 * @param {Date} [p.now]
 * @param {boolean} [p.ignoreHours] - offer times outside working hours too
 * @param {number} [p.max]
 * @returns {Array<{start: string, end: string, free: string[], busyFor: string[]}>}
 */
export function findSlots({ durationMinutes, from, to, people = [], now = new Date(), ignoreHours = false, max = MAX_SLOTS }) {
  const duration = Math.max(5, Number(durationMinutes) || DEFAULT_DURATION_MINUTES) * MINUTE;
  const earliest = Math.max(new Date(from).getTime(), now.getTime() + MIN_LEAD_MS);
  const latest = new Date(to).getTime();
  if (!(latest > earliest) || !people.length) return [];
  if (latest - earliest > MAX_DAYS_SCANNED * DAY) return [];

  // Start on the next quarter hour.
  let cursor = Math.ceil(earliest / STEP_MS) * STEP_MS;
  const slots = [];

  while (cursor + duration <= latest && slots.length < max) {
    const start = cursor;
    const end = cursor + duration;
    const withHours = people.filter(p => insideHours(start, end, p, ignoreHours));

    if (withHours.length === people.length) {
      const free = [];
      const busyFor = [];
      for (const person of people) {
        (overlaps(start, end, person.busy || []) ? busyFor : free).push(person.email);
      }
      if (!busyFor.length) {
        slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), free, busyFor });
        cursor = start + Math.max(duration, SPREAD_MS);
        continue;
      }
    }
    cursor = start + STEP_MS;
  }
  return slots;
}

/** How each person's day looks for a slot, for the card's per-person marks. */
export function slotMarks(slot, people = []) {
  return people.map(person => ({
    email: person.email,
    name: person.name || null,
    free: !overlaps(new Date(slot.start).getTime(), new Date(slot.end).getTime(), person.busy || []),
    seen: person.seen !== false
  }));
}

/** "Thu Sep 18, 9:00–9:30 AM PDT" in the reader's own zone. */
export function slotWords(slot, timeZone) {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(start);
  const from = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(start);
  const till = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(end);
  return `${day}, ${from}–${till}`;
}

/** "9:00 AM Thu" — short enough for a button. */
export function slotButtonWords(slot, timeZone) {
  const start = new Date(slot.start);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(start);
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(start);
  return `${time} ${day}`;
}
