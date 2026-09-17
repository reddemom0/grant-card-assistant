/**
 * /track — reading intent from words. Pure functions, no I/O.
 *
 * - trackIntent: does an @Oracle message ask to track the thread?
 * - typedCommand: the typed fallbacks for the card's dialogs
 *   ("@Oracle decision: …", "pass to @Name", "response: …", "remove @Name",
 *   "promised @Name by Friday").
 * - detectShape / isFeedbackAsk: one ball or everyone; is it asking for responses?
 * - parseDueDate: "by Sept 1", "before EOD Friday", "by tomorrow 3pm" → a time.
 * - pickHolder: who the ask is directed at.
 *
 * Nothing here logs: the input is message text.
 */

// ============================================================================
// INTENT
// ============================================================================

const TRACK_EXPLICIT = /^\s*(?:please\s+|pls\s+|can you\s+|could you\s+)?(?:start\s+)?track(?:ing)?\s+(?:this|it|that)\b(?:\s+(?:thread|ask|one|request|for me|for us|please|pls))*\s*[.!]*\s*$/i;
const TRACK_MAYBE = /\b(?:keep (?:an )?eye on (?:this|it|that)|follow(?:ing)? (?:up )?on (?:this|it|that)|keep track of (?:this|it|that)|track (?:this|it|that))\b/i;
const QUESTION = /\?\s*$/;

/**
 * @param {string} text - the message with Oracle's @mention removed
 * @returns {'track'|'maybe'|null} null → answer normally
 */
export function trackIntent(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (TRACK_EXPLICIT.test(t)) return 'track';
  if (QUESTION.test(t)) return null;            // "who has the ball on X?" is a question
  return TRACK_MAYBE.test(t) ? 'maybe' : null;
}

const TYPED = [
  { kind: 'decision', re: /^\s*(?:decision|decided|we decided)\s*[:—-]\s*([\s\S]+)$/i },
  { kind: 'response', re: /^\s*(?:my\s+)?(?:response|answer|feedback)\s*[:—-]\s*([\s\S]+)$/i },
  { kind: 'pass', re: /^\s*pass(?:\s+(?:it|this|the ball))?\s+to\b/i },
  { kind: 'remove', re: /^\s*remove\b/i },
  { kind: 'promise', re: /^\s*(?:promised|promise)\b([\s\S]*)$/i }
];

/**
 * A typed fallback for a card dialog, or null.
 * @returns {{kind: 'decision'|'response'|'pass'|'remove'|'promise', text?: string}|null}
 */
export function typedCommand(text) {
  const t = String(text || '');
  for (const { kind, re } of TYPED) {
    const m = re.exec(t);
    if (!m) continue;
    const rest = (m[1] || '').trim();
    if ((kind === 'decision' || kind === 'response') && !rest) return null;
    return rest ? { kind, text: rest } : { kind };
  }
  return null;
}

// ============================================================================
// SHAPE
// ============================================================================

const EVERYONE = /(?:^|\s)@all\b|\b(?:everyone|everybody|all of you|y'?all|folks|all hands)\b|^\s*(?:hi\s+|hey\s+)?(?:team|all)\s*[,:—-]/i;
const FEEDBACK = /\b(?:feedback|thoughts|input|opinions?|vote|votes|respond|responses?|reply with|let me know (?:what|which|your|if)|what do you (?:all )?think|which (?:one )?(?:do|would) you (?:prefer|like))\b/i;

/** @returns {'everyone'|'one'} */
export function detectShape(text, mentionsAll = false) {
  return mentionsAll || EVERYONE.test(String(text || '')) ? 'everyone' : 'one';
}

export function isFeedbackAsk(text) {
  return FEEDBACK.test(String(text || ''));
}

/**
 * The person an ask is directed at: the first @mentioned person who is not
 * excluded (Oracle, the listener account, apps, @all).
 * @param {Array<{chatUserId: string, displayName?: string}>} mentions
 * @param {(m: Object) => boolean} [isExcluded]
 */
export function pickHolder(mentions = [], isExcluded = () => false) {
  for (const m of mentions) {
    if (!m?.chatUserId || m.chatUserId === 'users/all' || m.type === 'BOT') continue;
    if (isExcluded(m)) continue;
    return { chatUserId: m.chatUserId, name: m.displayName || null };
  }
  return null;
}

// ============================================================================
// DUE DATES
// ============================================================================

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};
const WEEKDAYS = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const WEEKDAY_RE = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');

const LEAD = /\b(by|before|due(?:\s+(?:on|by))?|until|no later than|deadline(?:\s+is)?:?)\s+/ig;
const EOD = /^(?:the\s+)?(?:eod|cob|end of (?:the )?(?:day|business)|close of business)\b[\s,]*(?:on\s+|this\s+)?/i;
const TIME = /^(?:,?\s*(?:at\s+)?)(?:(noon|midday)|(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)|(\d{1,2}):(\d{2}))\b/i;
const TIME_EOD = /^(?:,?\s*)(?:eod|cob|end of (?:the )?day)\b/i;

/** Calendar parts of `now` in a time zone. */
function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hourCycle: 'h23', hour: 'numeric', minute: 'numeric'
  }).formatToParts(date).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    weekday: WEEKDAYS[parts.weekday.toLowerCase()], hour: Number(parts.hour), minute: Number(parts.minute)
  };
}

function offsetMinutes(utcMs, timeZone) {
  const p = zonedParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(utcMs / 60000) * 60000) / 60000);
}

/** A wall-clock time in a time zone, as a Date. */
export function zonedTime(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let utc = guess - offsetMinutes(guess, timeZone) * 60000;
  const again = guess - offsetMinutes(utc, timeZone) * 60000;   // across a DST change
  if (again !== utc) utc = again;
  return new Date(utc);
}

function addDays({ year, month, day }, n) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const dayNumber = ({ year, month, day }) => Date.UTC(year, month - 1, day) / 86400000;

/** The date part at the start of `s`: {date, eod, length} or null. */
function readDate(s, today) {
  let m;
  if ((m = /^(?:today|tonight)\b/i.exec(s))) return { date: today, length: m[0].length };
  if ((m = /^(?:tomorrow|tmrw|tmr)\b/i.exec(s))) return { date: addDays(today, 1), length: m[0].length };
  if ((m = /^(?:the\s+)?(?:end of (?:the |this )?week|eow|this week)\b/i.exec(s))) {
    const toFriday = (5 - today.weekday + 7) % 7;
    return { date: addDays(today, toFriday), eod: true, length: m[0].length };
  }
  if ((m = /^(?:the\s+)?(?:end of (?:the |this )?month|eom)\b/i.exec(s))) {
    const last = new Date(Date.UTC(today.year, today.month, 0));
    return { date: { year: today.year, month: today.month, day: last.getUTCDate() }, length: m[0].length };
  }
  if ((m = new RegExp(`^(?:(next|this)\\s+)?(${WEEKDAY_RE})\\b\\.?`, 'i').exec(s))) {
    const target = WEEKDAYS[m[2].toLowerCase()];
    let ahead = (target - today.weekday + 7) % 7;
    if (m[1]?.toLowerCase() === 'next') {
      const toMonday = ((1 - today.weekday + 7) % 7) || 7;       // the Monday that starts next week
      ahead = toMonday + ((target + 6) % 7);
    }
    return { date: addDays(today, ahead), length: m[0].length };
  }
  if ((m = new RegExp(`^(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i').exec(s))) {
    return withYear(MONTHS[m[1].toLowerCase()], Number(m[2]), m[3], today, m[0].length);
  }
  if ((m = new RegExp(`^(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b\\.?(?:,?\\s+(\\d{4}))?`, 'i').exec(s))) {
    return withYear(MONTHS[m[2].toLowerCase()], Number(m[1]), m[3], today, m[0].length);
  }
  if ((m = /^(\d{4})-(\d{2})-(\d{2})\b/.exec(s))) {
    return valid(Number(m[1]), Number(m[2]), Number(m[3]), m[0].length);
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/.exec(s))) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    return withYear(Number(m[1]), Number(m[2]), year, today, m[0].length);
  }
  return null;
}

function valid(year, month, day, length) {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || d.getUTCMonth() !== month - 1) return null;
  return { date: { year, month, day }, length };
}

/** A date without a year is its next occurrence (today counts). */
function withYear(month, day, year, today, length) {
  if (year) return valid(Number(year), month, day, length);
  const thisYear = valid(today.year, month, day, length);
  if (!thisYear) return null;
  if (dayNumber(thisYear.date) >= dayNumber(today)) return thisYear;
  return valid(today.year + 1, month, day, length);
}

function readTime(s) {
  let m;
  if ((m = TIME_EOD.exec(s))) return { hour: 17, minute: 0, length: m[0].length };
  if (!(m = TIME.exec(s))) return null;
  if (m[1]) return { hour: 12, minute: 0, length: m[0].length };
  if (m[2]) {
    let hour = Number(m[2]) % 12;
    if (/^p/i.test(m[4])) hour += 12;
    return valid24(hour, Number(m[3] || 0), m[0].length);
  }
  // "by 2:30" without am/pm is a working-hours time: 1:00–7:59 means the afternoon.
  const hour = Number(m[5]);
  return valid24(hour >= 1 && hour < 8 ? hour + 12 : hour, Number(m[6]), m[0].length);
}

function valid24(hour, minute, length) {
  return hour < 24 && minute < 60 ? { hour, minute, length } : null;
}

/**
 * The due date an ask names, in the requester's time zone.
 * A date alone means the end of that day (23:59); EOD / COB / end of week mean 17:00.
 *
 * @param {string} text
 * @param {string} timeZone - IANA zone
 * @param {Date} [now] - when the ask was written: "Friday" is the Friday after that
 * @returns {{at: Date, label: string, hasTime: boolean}|null}
 */
export function parseDueDate(text, timeZone, now = new Date()) {
  const source = String(text || '');
  const today = zonedParts(now, timeZone);
  LEAD.lastIndex = 0;
  let lead;
  while ((lead = LEAD.exec(source))) {
    let rest = source.slice(lead.index + lead[0].length);
    let used = lead[0].length;
    let eod = false;

    const eodPrefix = EOD.exec(rest);
    if (eodPrefix) {
      eod = true;
      rest = rest.slice(eodPrefix[0].length);
      used += eodPrefix[0].length;
    }

    // The time may come first: "by noon today", "before 3pm Friday".
    let time = readTime(rest);
    if (time) {
      rest = rest.slice(time.length).replace(/^\s+(?:on\s+)?/, (ws) => { used += ws.length; return ''; });
      used += time.length;
    }

    const date = readDate(rest, today) || ((eod || time) ? { date: today, length: 0 } : null);
    if (!date) continue;
    rest = rest.slice(date.length);
    used += date.length;

    if (!time) {
      time = readTime(rest);
      if (time) used += time.length;
    }

    const hour = time ? time.hour : (eod || date.eod) ? 17 : 23;
    const minute = time ? time.minute : (eod || date.eod) ? 0 : 59;
    const { year, month, day } = date.date;
    return {
      at: zonedTime(year, month, day, hour, minute, timeZone),
      label: source.slice(lead.index, lead.index + used).trim().replace(/[,.;:]+$/, ''),
      hasTime: Boolean(time) || eod || Boolean(date.eod)
    };
  }
  return null;
}
