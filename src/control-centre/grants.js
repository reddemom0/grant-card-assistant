/**
 * Control Centre — Grants tab: every live grant with its match and engagement
 * numbers for a range (three views), and one grant's page. Reads only.
 *
 *   grantList(range, view)    every live grant: clients matched, grant card opens,
 *                             watchlist saves, AI-review cuts, shown but never
 *                             opened, bounced, removed from watchlists, open review
 *                             cards — client-only and with internal accounts
 *   grantPage(id, range)      companies matched by goal track (AI review marks),
 *                             tags vs card text, engagement with a daily trend,
 *                             recent edits, review cards
 *
 * Definitions (docs/control-centre.md, Grants tab):
 *   clients matched     distinct companies the engine showed it to in the range
 *                       (match_results.shown — the Overview's "matches shown")
 *   displayed           engine-shown and not cut by the AI review that day (the
 *                       roll-up keeps the day's last review action); a cut grant
 *                       was never on the client's screen
 *   shown, never opened distinct companies it was displayed to in the range, on or
 *                       after OPENS_TRACKED_FROM, that have never opened its card
 *   bounced             a grant card open with under BOUNCE_MS visible on screen
 *   most ignored        displayed to at least MIN_IGNORED_CLIENTS companies
 *   not matching        no client matched in the range; last match "Never" when
 *                       none since the data starts (2026-08-26)
 *
 * Sources: the Overview's own window rows (overview.js loadWindowRows: roll-ups
 * plus live days), app grant_view_sessions / watchlist_grants /
 * grant_audit_logs, ops ai_review_log (reasons, one grant), Hub gg3_grants (tags,
 * card text) and cc_review_items. App and ops reads go through db.js (read-only).
 */

import { query as hubQueryDefault } from '../database/connection.js';
import { appQuery as appQueryDefault, opsQuery as opsQueryDefault } from './db.js';
import { readDay, TIME_ZONE } from './rollup.js';
import { loadWindowRows, RANGE_DAYS, OverviewError } from './overview.js';
import { liveGrants as liveGrantsDefault } from './live-sources.js';
import { companyNamesForIds } from './identity.js';
import { isInternalCompany } from './internal-accounts.js';
import { cardTitle, categoryWords } from './card-summary.js';
import { cardLink, grantLink } from './links.js';
import { GRANT_ROW_SQL } from './grant-patterns.js';
import { grantTags as grantTagsDefault, cardSections as cardSectionsDefault } from '../tools/grant-data-modes.js';
import { ALL_GOALS_SECTION } from './companies.js';

export const BOUNCE_MS = 3000;
export const MIN_IGNORED_CLIENTS = 3;
/** grant_view_sessions starts here: a display before it can't be called "never opened". */
export const OPENS_TRACKED_FROM = '2026-09-09';
export const VIEWS = Object.freeze(['all', 'most_ignored', 'not_matching']);
export const LIST_CACHE_MS = 5 * 60 * 1000;
export const EDITS_MAX = 30;
const EDIT_VALUE_CHARS = 200;
const CARD_SECTION_CHARS = 1500;

export class GrantsError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GrantsError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

// [from 00:00, to+1 00:00) Vancouver, the Overview's window rule.
const between = (col) =>
  `${col} >= ($1::date)::timestamp AT TIME ZONE '${TIME_ZONE}'
     AND ${col} < ($2::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}'`;
const dayOf = (col) => `to_char(${col}::timestamptz AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM-DD')`;

// App DB (read-only)
export const SESSIONS_SQL = `
  SELECT ${dayOf('started_at')} AS day, company_id, grant_root_id, visible_ms
    FROM grant_view_sessions
   WHERE ${between('started_at')}`;

export const OPENED_PAIRS_SQL = 'SELECT DISTINCT company_id, grant_root_id FROM grant_view_sessions';

export const WATCHLIST_REMOVALS_SQL = `
  SELECT ${dayOf('wg.deleted_at')} AS day, wg.grant_id AS grant_root_id, w.company_id
    FROM watchlist_grants wg
    LEFT JOIN watchlists w ON w.id = wg.watchlist_id
   WHERE wg.deleted_at IS NOT NULL AND ${between('wg.deleted_at')}`;

// No names in the app DB: an editor is a user id with its role, and an email
// only when user_email_contacts has one.
export const EDITS_SQL = `
  SELECT a.id, a.created_at, a.action, a.user_id, left(a.previous_value, 4000) AS previous_value,
         left(a.new_value, 4000) AS new_value, r.name AS role,
         (SELECT c.email FROM user_email_contacts c WHERE c.user_id = a.user_id ORDER BY c.id LIMIT 1) AS email
    FROM grant_audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN roles r ON r.id = u.role_id
   WHERE a.grant_id = $1 AND a.deleted_at IS NULL
   ORDER BY a.created_at DESC, a.id DESC
   LIMIT ${EDITS_MAX}`;

// Ops DB (read-only): the AI review of one grant, keyed to the company through
// the match row it acted on (rollup.js REVIEW_SQL's join), window by that row.
export const GRANT_REVIEW_SQL = `
  SELECT a.occurred_at, a.action, a.category, a.reason, a.track AS section, m.company_id
    FROM ai_review_log a
    JOIN LATERAL (
      SELECT occurred_at, company_id, user_id FROM match_results m
       WHERE m.result_set_id = a.result_set_id AND m.grant_id = a.grant_id AND m.section = a.track
       ORDER BY occurred_at LIMIT 1
    ) m ON TRUE
   WHERE a.grant_id = $3
     AND ${between('m.occurred_at')}
     AND m.user_id LIKE 'user\\_%'
   ORDER BY a.occurred_at DESC`;

// Hub DB
export const LAST_SHOWN_SQL = `
  SELECT grant_id, company_id, max(day)::text AS day
    FROM cc_daily_matches
   WHERE times_shown > 0
   GROUP BY grant_id, company_id`;

export const OPEN_CARDS_BY_GRANT_SQL = `
  SELECT grant_root_id, count(*)::int AS n
    FROM cc_review_items
   WHERE status <> 'closed' AND grant_root_id IS NOT NULL
   GROUP BY grant_root_id`;

export const GRANT_CARDS_SQL = `
  SELECT i.id, i.kind, i.status, i.owner, i.company_id, i.grant_root_id, i.chat_turn_ref, i.pattern_category, i.goal_track,
         i.flag_count, i.created_at, i.closed_at, i.diagnosis->>'verdict' AS verdict, left(i.narrative, 240) AS narrative,
         g.grant_name
    FROM cc_review_items i
    LEFT JOIN gg3_grants g ON g.id = i.grant_root_id
   WHERE i.grant_root_id = $1
   ORDER BY (i.status = 'closed'), i.updated_at DESC, i.id DESC`;

// ---------------------------------------------------------------------------
// Pure shaping
// ---------------------------------------------------------------------------

const iso = (v) => (v == null ? null : new Date(v).toISOString());
const laterDay = (a, b) => (a == null ? b : b == null ? a : (a > b ? a : b));
const pairKey = (company, grant) => `${company ?? 'none'}|${grant}`;

/** The variant filters: `all` keeps everyone, `clients` drops internal accounts. */
const VARIANTS = Object.freeze({
  clients: (isInternal) => (companyId) => !isInternal(companyId),
  all: () => () => true
});

const blank = () => ({
  matched: new Set(), displayed: new Set(), ignored: new Set(), cuts: new Set(),
  opens: 0, saves: 0, bounced: 0, removed: 0, last: null
});

/**
 * Pure: the range's rows → per grant root id, for one variant, every count the
 * list shows. `days` is the current window; rows outside it only feed
 * last_matched. `firstDisplayed` maps "company|grant" → the first day it was
 * displayed in the window and never opened (for the page's trend).
 */
export function grantMetrics({ days, matches, views, sessions, openedPairs, adds, removals, lastShown }, keep) {
  const inWindow = new Set(days);
  const out = new Map();
  const at = (id) => { if (!out.has(id)) out.set(id, blank()); return out.get(id); };
  const firstDisplayed = new Map();

  for (const r of lastShown) {
    if (!keep(r.company_id)) continue;
    const g = at(r.grant_id);
    g.last = laterDay(g.last, r.day);
  }
  for (const r of matches) {
    if (!keep(r.company_id)) continue;
    const g = at(r.grant_id);
    const shown = Number(r.times_shown) > 0;
    if (shown) g.last = laterDay(g.last, r.day);
    if (!inWindow.has(r.day)) continue;
    if (r.ai_review_action === 'cut') g.cuts.add(r.company_id);
    if (!shown) continue;
    g.matched.add(r.company_id);
    if (r.ai_review_action === 'cut') continue;
    g.displayed.add(r.company_id);
    if (r.day >= OPENS_TRACKED_FROM && r.company_id != null && !openedPairs.has(pairKey(r.company_id, r.grant_id))) {
      g.ignored.add(r.company_id);
      const k = pairKey(r.company_id, r.grant_id);
      if (!firstDisplayed.has(k) || r.day < firstDisplayed.get(k)) firstDisplayed.set(k, r.day);
    }
  }
  for (const r of views) {
    if (!inWindow.has(r.day) || !keep(r.company_id)) continue;
    at(r.grant_root_id).opens += Number(r.sessions) || 0;
  }
  for (const r of sessions) {
    if (!inWindow.has(r.day) || !keep(r.company_id)) continue;
    if (Number(r.visible_ms) < BOUNCE_MS) at(r.grant_root_id).bounced += 1;
  }
  for (const r of adds) {
    if (!inWindow.has(r.day) || !keep(r.company_id)) continue;
    at(r.grant_root_id).saves += 1;
  }
  for (const r of removals) {
    if (!inWindow.has(r.day) || !keep(r.company_id)) continue;
    at(r.grant_root_id).removed += 1;
  }
  return { byGrant: out, firstDisplayed };
}

/** One list row from a grant and its metrics. */
function rowOf(grant, m, openCards) {
  const g = m ?? blank();
  return {
    grant_id: grant.root_id,
    title: grant.title,
    grantor: grant.grantor ?? null,
    clients_matched: g.matched.size,
    opens: g.opens,
    saves: g.saves,
    cuts: g.cuts.size,
    ignored: g.ignored.size,
    displayed_clients: g.displayed.size,
    bounced: g.bounced,
    removed: g.removed,
    open_cards: openCards.get(grant.root_id) ?? 0,
    last_matched: g.last
  };
}

const byTitle = (a, b) => String(a.title).localeCompare(String(b.title));

/** Pure: one view of the rows, filtered and in its default order. */
export function applyView(rows, view) {
  if (view === 'most_ignored') {
    return rows.filter((r) => r.displayed_clients >= MIN_IGNORED_CLIENTS)
      .sort((a, b) => b.ignored - a.ignored || b.displayed_clients - a.displayed_clients || byTitle(a, b));
  }
  if (view === 'not_matching') {
    // Longest since the last match first; never matched ("Never") before all.
    return rows.filter((r) => r.clients_matched === 0)
      .sort((a, b) => (a.last_matched === b.last_matched ? byTitle(a, b)
        : a.last_matched == null ? -1 : b.last_matched == null ? 1 : a.last_matched < b.last_matched ? -1 : 1));
  }
  return [...rows].sort((a, b) => b.clients_matched - a.clients_matched || b.opens - a.opens || byTitle(a, b));
}

/**
 * Pure: every live grant, both variants, one view.
 * @returns {{clients: Object[], all: Object[]}}
 */
export function buildGrantList(input, { view = 'all', isInternal = isInternalCompany } = {}) {
  const out = {};
  for (const [name, make] of Object.entries(VARIANTS)) {
    const { byGrant } = grantMetrics(input, make(isInternal));
    out[name] = applyView(input.grants.map((g) => rowOf(g, byGrant.get(g.root_id), input.openCards)), view);
  }
  return out;
}

/** "Never" for a grant with no match since the data starts; else the day. */
export const lastMatchedWords = (day) => day ?? 'Never';

/** Pure: the page's daily trend for one grant, both variants. */
export function engagementTrend(input, grantId, { isInternal = isInternalCompany } = {}) {
  const out = {};
  for (const [name, make] of Object.entries(VARIANTS)) {
    const keep = make(isInternal);
    const series = new Map(input.days.map((d) => [d, { day: d, opens: 0, saves: 0, bounces: 0, removals: 0, ignored: 0 }]));
    const add = (day, k, n = 1) => { const s = series.get(day); if (s) s[k] += n; };
    for (const r of input.views) if (r.grant_root_id === grantId && keep(r.company_id)) add(r.day, 'opens', Number(r.sessions) || 0);
    for (const r of input.sessions) if (r.grant_root_id === grantId && keep(r.company_id) && Number(r.visible_ms) < BOUNCE_MS) add(r.day, 'bounces');
    for (const r of input.adds) if (r.grant_root_id === grantId && keep(r.company_id)) add(r.day, 'saves');
    for (const r of input.removals) if (r.grant_root_id === grantId && keep(r.company_id)) add(r.day, 'removals');
    const { firstDisplayed } = grantMetrics({ ...input, matches: input.matches.filter((r) => r.grant_id === grantId) }, keep);
    for (const day of firstDisplayed.values()) add(day, 'ignored');
    out[name] = [...series.values()];
  }
  return out;
}

/**
 * Pure: the grant's window rows → goal tracks, each with the companies it was
 * shown to (latest day, best position, eligibility, AI review mark). Review
 * rows (newest first) add the reason for the company and track.
 */
export function buildTracks(matches, reviews, names, { isInternal = isInternalCompany } = {}) {
  const tracks = new Map();
  for (const r of matches) {
    if (!(Number(r.times_shown) > 0)) continue;
    if (!tracks.has(r.section)) tracks.set(r.section, new Map());
    const companies = tracks.get(r.section);
    const key = r.company_id ?? 'none';
    const c = companies.get(key) ?? { company_id: r.company_id ?? null, days: 0, last_day: null, best_position: null,
      eligibility: null, ai_review: null, displayed: false };
    c.days += 1;
    if (c.last_day == null || r.day >= c.last_day) {
      c.last_day = r.day;
      c.eligibility = r.eligibility ?? c.eligibility;
      c.ai_review = r.ai_review_action ?? null;
    }
    if (r.best_position != null && (c.best_position == null || Number(r.best_position) < c.best_position)) c.best_position = Number(r.best_position);
    if (r.ai_review_action !== 'cut') c.displayed = true;
    companies.set(key, c);
  }
  const reason = new Map();
  for (const r of reviews) {
    const k = `${r.company_id}|${r.section}`;
    if (!reason.has(k)) reason.set(k, r);
  }
  const order = (a, b) => (a === ALL_GOALS_SECTION ? 1 : b === ALL_GOALS_SECTION ? -1 : a.localeCompare(b));
  return [...tracks.keys()].sort(order).map((section) => ({
    section,
    label: section === ALL_GOALS_SECTION ? 'All goals' : section,
    companies: [...tracks.get(section).values()].map((c) => {
      const rv = reason.get(`${c.company_id}|${section}`);
      const action = c.ai_review ?? null;
      return {
        ...c,
        company_name: c.company_id != null ? names.get(c.company_id) ?? null : null,
        internal: isInternal(c.company_id),
        ai_review: action ? {
          action,
          category: rv?.action === action ? rv.category ?? null : null,
          words: action === 'cut'
            ? `AI review cut it${rv?.action === 'cut' && rv.category ? `: ${categoryWords(rv.category)}` : ''}`
            : action === 'moved_up' ? 'AI review moved it up' : action === 'moved_down' ? 'AI review moved it down'
              : action === 'flag' ? 'AI review kept it, with a flag' : `AI review: ${action.replace(/_/g, ' ')}`,
          reason: rv?.action === action ? rv.reason ?? null : null
        } : null
      };
    }).sort((a, b) => Number(a.internal) - Number(b.internal)
      || String(a.company_name ?? '~').localeCompare(String(b.company_name ?? '~')))
  }));
}

const ACTION_WORDS = Object.freeze({
  'field.save': 'Edited card text',
  'field.update': 'Changed a card field',
  'field.create': 'Added a card field',
  'field.delete': 'Removed a card field',
  'version.fork': 'Started a new draft',
  'version.publish': 'Published a version',
  'version.create': 'Created a version',
  'version.restore': 'Restored a version',
  'tags.sync': 'Synced tags',
  'tags.membership.patch': 'Changed tags',
  'tags.sync.undo': 'Undid a tag sync',
  'metadata.update': 'Changed grant details',
  'internal_deadline.update': 'Changed the internal deadline',
  'status.amend': 'Changed status',
  'tab.create': 'Added a card tab',
  'tab.update': 'Renamed a card tab',
  'tab.delete': 'Removed a card tab',
  'structure.reorder': 'Reordered the card',
  'grant.delete': 'Deleted the grant'
});

/** HTML / markdown-ish text → plain words, clipped. */
export function plainEdit(v, n = EDIT_VALUE_CHARS) {
  if (v == null || v === '') return null;
  let s = String(v);
  try {
    const j = JSON.parse(s);
    if (j && Array.isArray(j.tagIds)) return `${j.tagIds.length} tags`;
  } catch { /* not JSON */ }
  s = s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[*_#`]+/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Pure: audit rows → edits in words. */
export function shapeEdits(rows) {
  return rows.map((r) => {
    const version = /^version\./.test(r.action);
    return {
      id: r.id,
      at: iso(r.created_at),
      action: r.action,
      what: ACTION_WORDS[r.action] ?? String(r.action).replace(/[._]/g, ' '),
      before: version ? (r.previous_value ? `version ${r.previous_value}` : null) : plainEdit(r.previous_value),
      after: version ? (r.new_value ? `version ${r.new_value}` : null) : plainEdit(r.new_value),
      who: { user_id: r.user_id, role: r.role ?? null, email: r.email ?? null }
    };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function defaultDeps() {
  return { hubQuery: hubQueryDefault, appQuery: appQueryDefault, opsQuery: opsQueryDefault, readDay, now: () => new Date(),
    liveGrants: liveGrantsDefault, grantTags: grantTagsDefault, cardSections: cardSectionsDefault };
}

const windowCache = new Map();

const parseRange = (range) => {
  if (!RANGE_DAYS[range]) throw new GrantsError(400, `range must be one of ${Object.keys(RANGE_DAYS).join(', ')}`);
  return range;
};

/**
 * Everything the list and the page count, for one range: the Overview's window
 * rows plus the grant-only reads. Cached LIST_CACHE_MS per range.
 */
export async function loadGrantWindow(range, overrides = {}) {
  parseRange(range);
  const deps = { ...defaultDeps(), ...overrides };
  const now = deps.now().getTime();
  const hit = windowCache.get(range);
  if (hit && now - hit.at < LIST_CACHE_MS && !overrides.noCache) return hit.value;

  const rows = await loadWindowRows(range, deps);
  const { from, to, days } = rows.w.current;
  const [grants, sessions, opened, removals, lastShown, openCards] = await Promise.all([
    deps.liveGrants({ query: deps.appQuery }),
    deps.appQuery(SESSIONS_SQL, [from, to]),
    deps.appQuery(OPENED_PAIRS_SQL),
    deps.appQuery(WATCHLIST_REMOVALS_SQL, [from, to]),
    deps.hubQuery(LAST_SHOWN_SQL),
    deps.hubQuery(OPEN_CARDS_BY_GRANT_SQL)
  ]);
  const value = {
    range,
    current: { from, to },
    days,
    grants,
    matches: rows.matches,
    views: rows.views,
    adds: rows.watchlist,
    sessions: sessions.rows,
    removals: removals.rows,
    openedPairs: new Set(opened.rows.map((r) => pairKey(r.company_id, r.grant_root_id))),
    lastShown: lastShown.rows,
    openCards: new Map(openCards.rows.map((r) => [r.grant_root_id, r.n])),
    data: { last_rolled_day: rows.lastRolled ?? null, live_days: rows.tail?.days?.length ?? 0 },
    generated_at: new Date(now).toISOString()
  };
  if (!overrides.noCache) windowCache.set(range, { at: now, value });
  return value;
}

/** The list for a range and view: both variants, the page picks by its toggle. */
export async function grantList(range = 'week', view = 'all', overrides = {}) {
  parseRange(range);
  if (!VIEWS.includes(view)) throw new GrantsError(400, `view must be one of ${VIEWS.join(', ')}`);
  const win = await loadGrantWindow(range, overrides);
  return {
    range,
    view,
    current: win.current,
    definitions: { bounce_ms: BOUNCE_MS, min_ignored_clients: MIN_IGNORED_CLIENTS, opens_tracked_from: OPENS_TRACKED_FROM },
    live_grants: win.grants.length,
    ...buildGrantList(win, { view }),
    data: win.data,
    generated_at: win.generated_at
  };
}

const parseGrantId = (v) => {
  const n = Number.parseInt(v, 10);
  if (!(Number.isInteger(n) && n > 0 && String(n) === String(v).trim())) throw new GrantsError(400, 'grant id must be a positive integer');
  return n;
};

/** One grant's page for a range. */
export async function grantPage(idInput, range = 'week', overrides = {}) {
  const id = parseGrantId(idInput);
  parseRange(range);
  const deps = { ...defaultDeps(), ...overrides };
  const win = await loadGrantWindow(range, overrides);
  const grant = win.grants.find((g) => g.root_id === id);
  if (!grant) throw new GrantsError(404, `grant ${id} is not live`);

  const inWindow = new Set(win.days);
  const matches = win.matches.filter((r) => r.grant_id === id && inWindow.has(r.day));
  const [reviews, tagRow, edits, cards] = await Promise.all([
    deps.opsQuery(GRANT_REVIEW_SQL, [win.current.from, win.current.to, id]).then((r) => r.rows),
    deps.hubQuery(GRANT_ROW_SQL, [id]).then((r) => r.rows[0] ?? null),
    deps.appQuery(EDITS_SQL, [id]).then((r) => r.rows),
    deps.hubQuery(GRANT_CARDS_SQL, [id]).then((r) => r.rows)
  ]);
  const names = await companyNamesForIds([...matches.map((r) => r.company_id), ...cards.map((c) => c.company_id)], { query: deps.appQuery });

  const lists = buildGrantList({ ...win, grants: [grant] });
  let tags = null;
  if (tagRow) {
    const { links, ...t } = deps.grantTags(tagRow);
    tags = {
      ...t,
      card: deps.cardSections(tagRow.field_content).map((s) => ({
        section: s.label, text: s.text.length > CARD_SECTION_CHARS ? `${s.text.slice(0, CARD_SECTION_CHARS - 1)}…` : s.text
      }))
    };
  }
  return {
    range,
    current: win.current,
    grant: { ...grant, link: grantLink(id) },
    definitions: { bounce_ms: BOUNCE_MS, min_ignored_clients: MIN_IGNORED_CLIENTS, opens_tracked_from: OPENS_TRACKED_FROM },
    totals: { clients: lists.clients[0], all: lists.all[0] },
    tracks: buildTracks(matches, reviews, names),
    tags,
    trend: engagementTrend(win, id),
    edits: shapeEdits(edits),
    cards: cards.map((c) => {
      const company_name = c.company_id != null ? names.get(c.company_id) ?? null : null;
      return {
        id: Number(c.id), kind: c.kind, status: c.status, owner: c.owner ?? null,
        title: cardTitle({ ...c, company_name }), company_id: c.company_id ?? null, company_name,
        company_internal: isInternalCompany(c.company_id), verdict: c.verdict ?? null, flag_count: c.flag_count,
        created_at: iso(c.created_at), closed_at: iso(c.closed_at), link: cardLink(c.id)
      };
    }),
    data: win.data,
    generated_at: win.generated_at
  };
}

export function _clearCacheForTests() { windowCache.clear(); }

export { OverviewError };
