/**
 * /watch — working out which funding program a post is about, and when to say
 * something about it.
 *
 * The program name and link come from the post. Dates and a line of description
 * come from our own grants table, which is never named in anything Oracle
 * posts or sends: the card says what the program is and when it closes, not
 * where that came from.
 *
 * Everything here is either pure or a single read. No writes, no model.
 */

const DAY = 24 * 60 * 60 * 1000;

/** How long a watch with no dates runs before Oracle asks whether to keep it. */
export const CHECK_AFTER_DAYS = 182;
/** The deadline reminders, in days before it. */
export const DEADLINE_NOTICES = [14, 2];

// ============================================================================
// TRIGGER
// ============================================================================

const WATCH = /^\s*watch\b|\bwatch (?:this|that|it)\b|\bstart watching\b/i;

/**
 * Does this @Oracle message ask for a program to be watched? Deliberately
 * narrow: watching is never started automatically, and "keep an eye on this"
 * belongs to the /track card.
 *
 * @returns {'watch'|null}
 */
export function watchIntent(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  return WATCH.test(t) ? 'watch' : null;
}

const STOP = /^\s*(?:stop|un)\s*watch(?:ing)?\b|\bstop watching\b/i;

export function stopWatchIntent(text) {
  return STOP.test(String(text || '')) ? 'stop' : null;
}

// ============================================================================
// WHAT THE POST IS ABOUT
// ============================================================================

const URL = /https?:\/\/[^\s<>"')]+/g;
const NOISE = /\b(?:the|this|that|a|an|new|update|updated|changes?|change|deadline|intake|program|programme|fund(?:ing)?|grant)\b/gi;

/** An acronym or a Title Case name, which is how programs are written about. */
const ACRONYM = /\b([A-Z][A-Z0-9]{2,9})\b/;
const TITLE_CASE = /\b([A-Z][\p{L}&'’-]+(?:\s+(?:[A-Z][\p{L}&'’-]+|of|for|and|the))+)\b/u;

/**
 * The program a post seems to be about, from its own words.
 * @returns {{name: string|null, url: string|null, acronym: string|null}}
 */
export function programFromPost(text) {
  const t = String(text || '');
  const urls = [...t.matchAll(URL)].map(m => m[0]);
  // A label in front of a link ("RTRI: https://…") beats a guess from prose.
  const labelled = /([^\n:]{3,80}):\s*https?:\/\//.exec(t)?.[1];
  const acronym = ACRONYM.exec(t)?.[1] || null;
  const title = TITLE_CASE.exec(t)?.[1] || null;
  const name = clean(labelled) || title || acronym;
  return { name: name || null, url: urls[0] || null, acronym };
}

const clean = (v, max = 120) => {
  const s = String(v || '').replace(/\s+/g, ' ').trim().replace(/[.,;:–-]$/, '').trim();
  return s ? s.slice(0, max) : null;
};

/** A stable key for one program, so one watch per program per space. */
export function programKey(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'unnamed';
}

/** The synthetic thread the watch card lives under: one live watch per program. */
export function watchThreadName(spaceName, key) {
  return `${spaceName}/threads/watch-${key}`;
}

export function keyFromWatchThread(threadName) {
  return /\/threads\/watch-(.+)$/.exec(String(threadName || ''))?.[1] || null;
}

// ============================================================================
// DATES IN A POST
// ============================================================================

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
const MONTH_DAY = new RegExp(`\\b(${MONTHS.map(m => `${m.slice(0, 3)}[a-z]*`).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`, 'i');
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;

/** A date written in a post, as a UTC date at noon (no time is ever implied). */
export function dateFromText(text, now = new Date()) {
  const t = String(text || '');
  const iso = ISO.exec(t);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12));
  const m = MONTH_DAY.exec(t);
  if (!m) return null;
  const month = MONTHS.findIndex(name => name.startsWith(m[1].toLowerCase().slice(0, 3)));
  if (month < 0) return null;
  const day = Number(m[2]);
  const year = m[3] ? Number(m[3]) : null;
  if (!(day >= 1 && day <= 31)) return null;
  if (year) return new Date(Date.UTC(year, month, day, 12));
  // No year: the next occurrence, so "closes Oct 1" in December means next year.
  const guess = new Date(Date.UTC(now.getUTCFullYear(), month, day, 12));
  return guess.getTime() < now.getTime() - 7 * DAY
    ? new Date(Date.UTC(now.getUTCFullYear() + 1, month, day, 12))
    : guess;
}

const OPENS = /\b(?:opens?|open(?:ing)?|intake (?:opens|starts)|applications? open)\b[^.\n]{0,40}/i;
const CLOSES = /\b(?:closes?|closing|deadline|due|applications? close|last day)\b[^.\n]{0,40}/i;

/** The dates a post states, if any. */
export function datesFromPost(text, now = new Date()) {
  const t = String(text || '');
  const opensPhrase = OPENS.exec(t)?.[0] || '';
  const closesPhrase = CLOSES.exec(t)?.[0] || '';
  return {
    opensAt: opensPhrase ? dateFromText(opensPhrase, now) : null,
    deadline: closesPhrase ? dateFromText(closesPhrase, now) : null
  };
}

const CLOSED_WORDS = /\b(?:now closed|is closed|has closed|closed for (?:the year|applications|intake)|fully (?:subscribed|allocated)|funds? (?:are )?(?:exhausted|depleted|gone)|no longer accepting|paused|suspended|cancelled|canceled)\b/i;
const NEARLY_GONE = /\b(?:nearly (?:gone|out)|almost (?:gone|out)|running out|limited funds|last chance|closing soon|final (?:week|days))\b/i;

/** Does this post say the program has closed, or is nearly gone? */
export function closureFromPost(text) {
  const t = String(text || '');
  if (CLOSED_WORDS.test(t)) return 'closed';
  if (NEARLY_GONE.test(t)) return 'nearly_gone';
  return null;
}

// ============================================================================
// MATCHING AGAINST WHAT WE KNOW
// ============================================================================

const scoreOf = (needle, name) => {
  const a = String(needle || '').toLowerCase();
  const b = String(name || '').toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.includes(a) || a.includes(b)) return 70;
  const words = a.replace(NOISE, ' ').split(/\s+/).filter(w => w.length > 2);
  const hits = words.filter(w => b.includes(w)).length;
  return words.length ? Math.round((hits / words.length) * 50) : 0;
};

/**
 * Programs that look like the one in the post, best first. A single read of our
 * own grants table; the source is never named in what Oracle says.
 *
 * @param {{name: string|null, acronym: string|null}} guess - programFromPost()
 * @param {Object} [opts]
 * @returns {Promise<Array<{name, key, url, deadline, amount, provider, description, accepting}>>}
 */
export async function matchProgram(guess, { limit = 4, now = new Date() } = {}) {
  const query = [guess?.name, guess?.acronym].filter(Boolean).join(' ').trim();
  if (!query) return [];
  try {
    const { searchGetGranted } = await import('../tools/getgranted-search.js');
    const res = await searchGetGranted({ query: query.slice(0, 120), limit: Math.max(limit, 6), include_inactive: true });
    if (!res?.success) return [];
    return (res.grants || [])
      .map(grant => ({
        name: grant.grant_name || null,
        key: programKey(grant.grant_name),
        url: grant.url || null,
        deadline: grant.deadline || null,
        amount: grant.grant_amount ?? null,
        provider: grant.program_provider || null,
        industries: Array.isArray(grant.industries) ? grant.industries.slice(0, 3) : [],
        regions: Array.isArray(grant.regions) ? grant.regions.slice(0, 3) : [],
        description: null,
        accepting: grant.currently_accepting !== false,
        score: Math.max(scoreOf(guess?.name, grant.grant_name), scoreOf(guess?.acronym, grant.grant_name))
      }))
      .filter(p => p.name)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (err) {
    console.warn(`⚠️  Watch program match failed — code: ${err?.code || err?.name || 'unknown'}`);
    return [];
  }
}

/** Does this post look like it is about the program on a watch card? */
export function postMatchesProgram(text, program) {
  if (!program?.name) return false;
  const t = String(text || '');
  if (!t.trim()) return false;
  if (new RegExp(`\\b${escapeRe(program.name)}\\b`, 'i').test(t)) return true;
  // An acronym in the name ("RTRI") is how people usually refer to it.
  const acronym = /\b([A-Z][A-Z0-9]{2,9})\b/.exec(program.name)?.[1];
  if (acronym && new RegExp(`\\b${escapeRe(acronym)}\\b`).test(t)) return true;
  if (program.url) {
    const slug = String(program.url).replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (slug && t.includes(slug)) return true;
  }
  return scoreOf(program.name, t) >= 50;
}

const escapeRe = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ============================================================================
// WHEN TO SAY SOMETHING
// ============================================================================

const daysBetween = (from, to) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY);

/**
 * Which reminders are due for a watch right now, and which of them ends it.
 *
 * @param {Object} p
 * @param {Object} p.program - {name, opensAt, deadline}
 * @param {Object} [p.sent] - kind → the date it was sent on
 * @param {Date} [p.now]
 * @param {string} [p.createdAt] - the card's own start, for the 6-month check
 * @returns {{due: Array<{kind: string, text: string}>, ends: boolean}}
 */
export function dueNotices({ program = {}, sent = {}, now = new Date(), createdAt = null } = {}) {
  const due = [];
  let ends = false;
  const say = (kind, text) => {
    if (!sent[kind]) due.push({ kind, text });
  };

  if (program.opensAt) {
    const days = daysBetween(now, program.opensAt);
    if (days === 1 || days === 0) say('opens', `${program.name} opens ${days === 0 ? 'today' : 'tomorrow'}.`);
  }

  if (program.deadline) {
    const days = daysBetween(now, program.deadline);
    // Nearest mark first, so two days out is "deadline_2" and not "deadline_14".
    for (const mark of [...DEADLINE_NOTICES].sort((a, b) => a - b)) {
      if (days <= mark && days > 0) {
        say(`deadline_${mark}`, `${program.name} closes in ${days === 1 ? '1 day' : `${days} days`}.`);
        break;
      }
    }
    if (days < 0) {
      say('deadline_passed', `${program.name}'s deadline has passed — this is the last note about it.`);
      ends = true;
    }
  } else if (createdAt && daysBetween(createdAt, now) >= CHECK_AFTER_DAYS) {
    say('still_watching', `Nobody has heard anything about ${program.name} for six months — still watching it?`);
  }

  return { due, ends };
}
