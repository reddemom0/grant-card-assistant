/**
 * Reading a grant's deadline as written on its card ("31/08/2026", "Open Until
 * Filled", "15 mars 2027"). Pure — no database, no imports — so the /watch card
 * can use it as well as the grants modes in grant-data-modes.js.
 */

const blank = (v) => v == null || String(v).trim() === '';
const fold = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '');

const MONTHS = {
  january: 1, jan: 1, janvier: 1, february: 2, feb: 2, fevrier: 2, march: 3, mar: 3, mars: 3,
  april: 4, apr: 4, avril: 4, may: 5, mai: 5, june: 6, jun: 6, juin: 6, july: 7, jul: 7, juillet: 7,
  august: 8, aug: 8, aout: 8, september: 9, sep: 9, sept: 9, septembre: 9, october: 10, oct: 10, octobre: 10,
  november: 11, nov: 11, novembre: 11, december: 12, dec: 12, decembre: 12
};
const MONTH_WORD = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const ROLLING = /open until|until filled|until funds|while funds|jusqu|epuisement|ongoing|continuous|rolling|year round|no deadline|no fixed deadline|en continu/;

const pad = (n) => String(n).padStart(2, '0');
function isoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Read a deadline as written on the card. Never guesses: a numeric date whose
 * day and month could swap (04/09/2026), a month with no day, or text with more
 * than one date is unreadable.
 * @returns {{kind: 'blank'|'rolling'|'date'|'unreadable', date?: string}}
 */
export function parseDeadline(text) {
  if (blank(text)) return { kind: 'blank' };
  const s = fold(text).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  if (ROLLING.test(s)) return { kind: 'rolling' };

  const found = [];
  let ambiguous = false;
  const t = s.replace(/(\d+)(st|nd|rd|th|er)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
  for (const m of t.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) found.push(isoDate(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g)) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    if (a > 12) found.push(isoDate(y, b, a));
    else if (b > 12) found.push(isoDate(y, a, b));
    else if (a === b) found.push(isoDate(y, a, a));
    else ambiguous = true;
  }
  for (const m of t.matchAll(new RegExp(`\\b(${MONTH_WORD})\\.? (\\d{1,2}) (\\d{4})\\b`, 'g'))) found.push(isoDate(+m[3], MONTHS[m[1]], +m[2]));
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2}) (?:de )?(${MONTH_WORD})\\.? (\\d{4})\\b`, 'g'))) found.push(isoDate(+m[3], MONTHS[m[2]], +m[1]));

  const dates = [...new Set(found)];
  if (ambiguous || dates.length !== 1 || dates[0] === null) return { kind: 'unreadable' };
  return { kind: 'date', date: dates[0] };
}
