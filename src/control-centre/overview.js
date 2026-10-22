/**
 * Control Centre Overview (step 6): one read-only payload behind
 * GET /api/control-centre/overview?range=day|week|month|year|YYYY-MM-DD..YYYY-MM-DD.
 *
 * Windows are whole America/Vancouver days, the same boundaries as the
 * roll-ups. A named range is the N days ending today (today counts so far),
 * N = 1 / 7 / 30 / 365; a custom range is its own from..to. The previous
 * window is always the same number of days just before (windowsFor).
 *
 * Where each number comes from:
 *   matches, opens, ratings   the cc_daily_* roll-ups for every day the job wrote
 *                             after that day had ended; every later day (today,
 *                             a day rolled while still in progress, a day the
 *                             job missed) is read live with the roll-up's own readDay() and
 *                             aggregators, so the exclusion rule is identical
 *                             (ops rows: real Clerk users only; staff and
 *                             clients blended, never split).
 *   sign-ups                  app companies created that have a real Clerk user
 *   watchlist adds            app watchlist_grants created (later removals kept)
 *   chats                     ops conversations by real Clerk users with ≥1 message
 *   active companies          any company with a match computed, a grant opened,
 *                             a rating or a chat in the window
 *
 * Distinct counts (matches shown = company × grant pairs; active companies)
 * are distinct over the whole window, not a sum of the daily values.
 *
 * Reads only: the Hub (roll-ups, review items), the app and ops DBs through
 * db.js. Cached per range for CACHE_TTL_MS. Logs carry codes and counts only.
 */

import { query as hubQueryDefault } from '../database/connection.js';
import { appQuery as appQueryDefault, opsQuery as opsQueryDefault } from './db.js';
import { TIME_ZONE, vancouverDay, addDays, dayRange, readDay, aggregateMatches, aggregateViews, aggregateRatings } from './rollup.js';
import { liveGrants as liveGrantsDefault, splitProvinces } from './live-sources.js';
import { identitiesForClerkIds, companyNamesForIds } from './identity.js';
import { INTERNAL_COMPANY_IDS, internalCompanySet, isInternalCompany } from './internal-accounts.js';
import { askedForWindow } from './chat-themes.js';

export const RANGE_DAYS = Object.freeze({ day: 1, week: 7, month: 30, year: 365 });
export const DEFAULT_RANGE = 'week';
export const CACHE_TTL_MS = 5 * 60 * 1000;
/** At most this many un-rolled days are read live; older gaps mark the roll-up stale. */
export const MAX_LIVE_DAYS = 14;
export const TOP_N = 10;
export const MOVERS_N = 8;
export const TREND_N = 8;

export class OverviewError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'OverviewError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Range maths
// ---------------------------------------------------------------------------

/** The longest custom range, the same as Year. */
export const MAX_CUSTOM_DAYS = 365;
const CUSTOM_RANGE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;
const MONTH_WORDS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const realDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && addDays(d, 0) === d;

/** A custom range token for from..to (Vancouver days): '2026-09-01..2026-10-15'. */
export const customRange = (from, to) => `${from}..${to}`;

/** 'YYYY-MM-DD..YYYY-MM-DD' → {from, to}, or null when it isn't a custom token. */
export function parseCustomRange(range) {
  const m = CUSTOM_RANGE.exec(String(range ?? ''));
  return m ? { from: m[1], to: m[2] } : null;
}

/** 'Sep 1 – Oct 15' (the year only when the two days' years differ or it isn't `year`). */
export function spanLabel(from, to, year = null) {
  const one = (d, withYear) => {
    const [y, m, dd] = d.split('-').map(Number);
    return `${MONTH_WORDS[m - 1]} ${dd}${withYear ? `, ${y}` : ''}`;
  };
  const showYear = from.slice(0, 4) !== to.slice(0, 4) || (year != null && from.slice(0, 4) !== String(year));
  return from === to ? one(from, showYear) : `${one(from, showYear)} – ${one(to, showYear)}`;
}

/**
 * Null when `range` is usable, else why not: a named range (day / week /
 * month / year) or a custom 'YYYY-MM-DD..YYYY-MM-DD' of real Vancouver days,
 * start ≤ end ≤ today, at most MAX_CUSTOM_DAYS days.
 */
export function rangeError(range, now = new Date()) {
  if (RANGE_DAYS[range]) return null;
  const c = parseCustomRange(range);
  if (!c) return `range must be one of ${Object.keys(RANGE_DAYS).join(', ')}, or from..to as YYYY-MM-DD..YYYY-MM-DD`;
  if (!realDay(c.from) || !realDay(c.to)) return 'from and to must be real dates (YYYY-MM-DD)';
  if (c.from > c.to) return 'from must be on or before to';
  if (c.to > vancouverDay(now)) return 'to can\'t be after today (Vancouver)';
  if (dayRange(c.from, c.to).length > MAX_CUSTOM_DAYS) return `a custom range can be at most ${MAX_CUSTOM_DAYS} days`;
  return null;
}

/**
 * The current window and the previous window of the same length just before
 * it. Named ranges end today (today counts so far); a custom range is its own
 * from..to. Labels are the windows' dates, for "vs …" wording.
 * @returns {{range, days, custom, today, ends_today, current: {from, to, days: string[], label}, previous: {from, to, days: string[], label}}}
 */
export function windowsFor(range, now = new Date()) {
  const err = rangeError(range, now);
  if (err) throw new OverviewError(400, err);
  const today = vancouverDay(now);
  const custom = parseCustomRange(range);
  const curFrom = custom ? custom.from : addDays(today, -(RANGE_DAYS[range] - 1));
  const curTo = custom ? custom.to : today;
  const n = dayRange(curFrom, curTo).length;
  const prevTo = addDays(curFrom, -1);
  const prevFrom = addDays(prevTo, -(n - 1));
  const year = today.slice(0, 4);
  return {
    range,
    days: n,
    custom: Boolean(custom),
    today,
    ends_today: curTo === today,
    current: { from: curFrom, to: curTo, days: dayRange(curFrom, curTo), label: spanLabel(curFrom, curTo, year) },
    previous: { from: prevFrom, to: prevTo, days: dayRange(prevFrom, prevTo), label: spanLabel(prevFrom, prevTo, year) }
  };
}

/** Keep a per-range cache from growing without bound now that custom ranges exist. */
export const CACHE_MAX_KEYS = 20;
export function trimCache(cache, max = CACHE_MAX_KEYS) {
  while (cache.size > max) cache.delete(cache.keys().next().value);
}

/** Days of [from, to] that the roll-up hasn't written, newest MAX_LIVE_DAYS of them. */
export function liveTail(from, to, lastRolled) {
  const start = lastRolled && lastRolled >= from ? addDays(lastRolled, 1) : from;
  if (start > to) return { days: [], stale: false };
  const all = dayRange(start, to);
  return { days: all.slice(-MAX_LIVE_DAYS), stale: all.length > MAX_LIVE_DAYS };
}

export function compare(current, previous) {
  const delta = current - previous;
  return { current, previous, delta, delta_pct: previous > 0 ? Math.round((delta / previous) * 1000) / 10 : null };
}

// ---------------------------------------------------------------------------
// SQL (all reads)
// ---------------------------------------------------------------------------

// `day::text` so the DATE never passes through a JS Date in the server's zone.
// section / best_position / eligibility / ai_review_action are for the Grants
// tab (grants.js); the Overview itself doesn't read them.
export const ROLLED_MATCHES_SQL = `
  SELECT day::text AS day, company_id, grant_id, section, times_computed, times_shown,
         best_position, eligibility, ai_review_action
    FROM cc_daily_matches WHERE day BETWEEN $1::date AND $2::date`;
export const ROLLED_VIEWS_SQL = `
  SELECT day::text AS day, company_id, grant_root_id, source, sessions
    FROM cc_daily_views WHERE day BETWEEN $1::date AND $2::date`;

/**
 * Where a grant card was opened from: grant_view_sessions
 * presentation_context->>'source', kept per row by the roll-up. Every open has
 * one (none missing in the 60 days to 2026-10-15). `suggested` always carries
 * a goal-track list ("track-0-hire-or-train-people"); `direct` is a direct
 * link and goes to Other with anything unknown.
 */
export const OPEN_SOURCES = Object.freeze([
  { key: 'goal_tracks', label: 'Goal tracks', from: ['suggested'] },
  { key: 'browse', label: 'Browse', from: ['browse'] },
  { key: 'chat', label: 'Chat', from: ['advisor'] },
  { key: 'watchlist', label: 'Watchlist', from: ['watchlist'] },
  { key: 'other', label: 'Other (direct links)', from: [] }
]);
const SOURCE_KEY = new Map(OPEN_SOURCES.flatMap((s) => s.from.map((f) => [f, s.key])));
export const openSourceKey = (source) => SOURCE_KEY.get(String(source ?? '').toLowerCase()) ?? 'other';
export const ROLLED_RATINGS_SQL = `
  SELECT day::text AS day, company_id, grant_root_id, ups, downs
    FROM cc_daily_ratings WHERE day BETWEEN $1::date AND $2::date`;
// The latest day the roll-up wrote AFTER the day had ended (Vancouver). A day
// rolled while still in progress — a by-hand run at 06:00, or a nightly run
// that then stopped — holds only part of its rows, so it is read live instead.
// Upserts set updated_at = NOW(), so a later complete run makes it count.
export const LAST_ROLLED_SQL = `
  SELECT max(day)::text AS day FROM (
    SELECT day, max(updated_at) AS written FROM cc_daily_matches GROUP BY day
    UNION ALL SELECT day, max(updated_at) FROM cc_daily_views GROUP BY day
    UNION ALL SELECT day, max(updated_at) FROM cc_daily_ratings GROUP BY day) x
   WHERE written >= (day + 1)::timestamp AT TIME ZONE '${TIME_ZONE}'`;
export const NEED_ACTION_SQL = "SELECT count(*)::int AS n FROM cc_review_items WHERE status <> 'closed'";

// [from 00:00, to+1 00:00) Vancouver; the row's day computed by the same cast
// the comparison uses, so a row and its window always agree.
const between = (col) =>
  `${col} >= ($1::date)::timestamp AT TIME ZONE '${TIME_ZONE}'
     AND ${col} < ($2::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}'`;
const dayOf = (col) => `to_char(${col}::timestamptz AT TIME ZONE '${TIME_ZONE}', 'YYYY-MM-DD')`;

// A sign-up is a company with at least one real Clerk user (legacy imports and
// test companies have none).
export const SIGNUPS_SQL = `
  SELECT ${dayOf('c.created_at')} AS day, c.id AS company_id
    FROM companies c
   WHERE c.deleted_at IS NULL
     AND ${between('c.created_at')}
     AND EXISTS (
       SELECT 1 FROM company_users cu
         JOIN users_clerk uc ON uc.user_id = cu.user_id AND uc.deleted_at IS NULL
        WHERE cu.company_id = c.id AND cu.deleted_at IS NULL
          AND uc.clerk_id LIKE 'user\\_%')`;

export const WATCHLIST_ADDS_SQL = `
  SELECT ${dayOf('wg.created_at')} AS day, wg.grant_id AS grant_root_id, w.company_id
    FROM watchlist_grants wg
    LEFT JOIN watchlists w ON w.id = wg.watchlist_id
   WHERE ${between('wg.created_at')}`;

// questions = the client's own messages in the chat (string-content user
// messages; tool results are user messages with array content and don't count).
export const CHATS_SQL = `
  SELECT ${dayOf('created_at')} AS day, user_id AS clerk_id, id AS conversation_id,
         (SELECT count(*) FROM jsonb_array_elements(messages) m
           WHERE m->>'role' = 'user' AND jsonb_typeof(m->'content') = 'string')::int AS questions
    FROM conversations
   WHERE ${between('created_at')}
     AND user_id LIKE 'user\\_%'
     AND jsonb_array_length(messages) > 0`;

// Where each number's history starts: the earliest day in its own data. A
// comparison window that begins before this has nothing to compare with, so
// the page shows "—" instead of a change (trackingFor).
export const HUB_TRACKING_SQL = `
  SELECT (SELECT min(day) FROM cc_daily_matches)::text AS matches,
         (SELECT min(day) FROM cc_daily_views)::text AS views,
         (SELECT min(day) FROM cc_daily_ratings)::text AS ratings`;
export const APP_TRACKING_SQL = `
  SELECT (SELECT ${dayOf('min(c.created_at)')} FROM companies c
           WHERE c.deleted_at IS NULL
             AND EXISTS (
               SELECT 1 FROM company_users cu
                 JOIN users_clerk uc ON uc.user_id = cu.user_id AND uc.deleted_at IS NULL
                WHERE cu.company_id = c.id AND cu.deleted_at IS NULL
                  AND uc.clerk_id LIKE 'user\\_%')) AS signups,
         (SELECT ${dayOf('min(created_at)')} FROM watchlist_grants) AS watchlist`;
export const OPS_TRACKING_SQL = `
  SELECT ${dayOf('min(created_at)')} AS chats
    FROM conversations
   WHERE user_id LIKE 'user\\_%' AND jsonb_array_length(messages) > 0`;

// Size and revenue as the engine reads them (live-sources.js shapeCompanyProfile):
// the range text first, the number as a fallback. Mostly ranges ("5-10 employees").
export const COMPANY_METADATA_SQL = `
  SELECT DISTINCT ON (company_id) company_id, primary_industries, provinces,
         employee_range, num_employees, recurring_revenue_range, annual_revenue
    FROM company_metadata
   WHERE company_id = ANY($1::int[])
   ORDER BY company_id, id DESC`;

// ---------------------------------------------------------------------------
// Assembly (pure)
// ---------------------------------------------------------------------------

const zeroSeries = (days) => new Map(days.map((d) => [d, 0]));
const seriesOut = (map) => [...map.entries()].map(([day, value]) => ({ day, value }));

/** Sum of `pick(row)` per day, over the window's days (empty days stay 0). */
function sumMetric(rows, days, pick) {
  const set = new Set(days);
  const series = zeroSeries(days);
  let total = 0;
  for (const r of rows) {
    if (!set.has(r.day)) continue;
    const v = Number(pick(r)) || 0;
    series.set(r.day, series.get(r.day) + v);
    total += v;
  }
  return { total, series };
}

/** Distinct `keyOf(row)` per day and over the whole window. */
function distinctMetric(rows, days, keyOf) {
  const set = new Set(days);
  const perDay = new Map(days.map((d) => [d, new Set()]));
  const all = new Set();
  for (const r of rows) {
    if (!set.has(r.day)) continue;
    const k = keyOf(r);
    if (k == null) continue;
    perDay.get(r.day).add(k);
    all.add(k);
  }
  return { total: all.size, series: new Map([...perDay].map(([d, s]) => [d, s.size])), keys: all };
}

function metric(cur, prev) {
  return { ...compare(cur.total, prev.total), series: seriesOut(cur.series), previous_series: seriesOut(prev.series) };
}

const pairKey = (r) => (r.company_id == null ? null : `${r.company_id}:${r.grant_id}`);

/** grant → Set(company) shown, in a window. */
function companiesShownByGrant(matches, days) {
  const set = new Set(days);
  const out = new Map();
  for (const r of matches) {
    if (!set.has(r.day) || !(r.times_shown > 0) || r.company_id == null) continue;
    if (!out.has(r.grant_id)) out.set(r.grant_id, new Set());
    out.get(r.grant_id).add(r.company_id);
  }
  return out;
}

function countBy(rows, days, keyField, pick = () => 1) {
  const set = new Set(days);
  const out = new Map();
  for (const r of rows) {
    if (!set.has(r.day)) continue;
    out.set(r[keyField], (out.get(r[keyField]) ?? 0) + (Number(pick(r)) || 0));
  }
  return out;
}

const titleOf = (titles, id) => titles.get(id) ?? `Grant #${id}`;

/** Industries / provinces gaining or losing matches and sign-ups. */
export function shiftingTrends({ curPairs, prevPairs, curSignups, prevSignups, metadata }) {
  const dims = { industries: (m) => m?.industries ?? [], provinces: (m) => m?.provinces ?? [] };
  const out = {};
  for (const [dim, labelsOf] of Object.entries(dims)) {
    const acc = new Map();
    const bump = (company, field) => {
      for (const label of labelsOf(metadata.get(company))) {
        if (!acc.has(label)) acc.set(label, { name: label, matches: 0, previous_matches: 0, signups: 0, previous_signups: 0 });
        acc.get(label)[field] += 1;
      }
    };
    for (const k of curPairs) bump(Number(k.split(':')[0]), 'matches');
    for (const k of prevPairs) bump(Number(k.split(':')[0]), 'previous_matches');
    for (const c of curSignups) bump(c, 'signups');
    for (const c of prevSignups) bump(c, 'previous_signups');
    out[dim] = [...acc.values()]
      .map((x) => ({ ...x, matches_change: x.matches - x.previous_matches, signups_change: x.signups - x.previous_signups }))
      .filter((x) => x.matches_change !== 0 || x.signups_change !== 0)
      .sort((a, b) => Math.abs(b.matches_change) - Math.abs(a.matches_change)
        || Math.abs(b.signups_change) - Math.abs(a.signups_change) || a.name.localeCompare(b.name))
      .slice(0, TREND_N);
  }
  return out;
}

/**
 * Pure: everything read → the Overview payload.
 *
 * Internal accounts (`internalCompanies`, a Set of companies.id — see
 * internal-accounts.js) are counted everywhere; nothing is thrown away.
 *   - Every tile counts them, and `metrics.*.internal` says how much of the
 *     number came from them.
 *   - The grant rankings and trends are built twice: `rankings.clients`
 *     without internal accounts (the page default) and `rankings.all` with
 *     them, so the "Include internal accounts" toggle switches with no refetch.
 */
export function buildOverview(w, data) {
  const { matches, views, ratings, signups, watchlist, chats, chatCompany, titles, metadata, needAction,
    internalCompanies = new Set() } = data;
  const C = w.current.days;
  const P = w.previous.days;
  const chatRows = chats.map((r) => ({ ...r, company_id: chatCompany.get(r.clerk_id) ?? null }));
  const isInternal = (r) => internalCompanies.has(r.company_id);

  const all = { matches, views, ratings, signups, watchlist, chats: chatRows };
  const only = (keep) => Object.fromEntries(Object.entries(all).map(([k, rows]) => [k, rows.filter(keep)]));

  const metrics = tileMetrics(all, C, P);
  const internal = tileMetrics(only(isInternal), C, P);
  for (const [key, m] of Object.entries(metrics)) {
    m.internal = { current: internal[key].current, previous: internal[key].previous };
  }

  return {
    range: w.range,
    time_zone: TIME_ZONE,
    days: w.days,
    custom: Boolean(w.custom),
    current: { from: w.current.from, to: w.current.to, label: w.current.label ?? null },
    previous: { from: w.previous.from, to: w.previous.to, label: w.previous.label ?? null },
    // A custom range that ends before today is complete; otherwise today counts so far.
    today_partial: w.ends_today !== false,
    metrics,
    need_action: needAction,
    rankings: {
      clients: rankings(only((r) => !isInternal(r)), C, P, titles, metadata),
      all: rankings(all, C, P, titles, metadata)
    }
  };
}

/** The usage tiles over a set of rows (current vs previous window). */
function tileMetrics({ matches, views, ratings, signups, watchlist, chats }, C, P) {
  const activityRows = [
    ...matches.filter((r) => r.times_computed > 0),
    ...views, ...ratings, ...chats
  ].map((r) => ({ day: r.day, company_id: r.company_id }));
  const shown = matches.filter((r) => r.times_shown > 0);
  const both = (fn) => metric(fn(C), fn(P));
  return {
    signups: both((d) => distinctMetric(signups, d, (r) => r.company_id)),
    active_companies: both((d) => distinctMetric(activityRows, d, (r) => r.company_id)),
    matches_shown: both((d) => distinctMetric(shown, d, pairKey)),
    grants_opened: both((d) => sumMetric(views, d, (r) => r.sessions)),
    ratings_up: both((d) => sumMetric(ratings, d, (r) => r.ups)),
    ratings_down: both((d) => sumMetric(ratings, d, (r) => r.downs)),
    watchlist_adds: both((d) => sumMetric(watchlist, d, () => 1)),
    chats: both((d) => sumMetric(chats, d, () => 1))
  };
}

/**
 * The Chat section's numbers over a set of rows, current vs previous window.
 * A chat is a conversation started in the window; its questions are the
 * client's messages in it. Clients are companies, linked through the Clerk
 * identity exactly as for active clients (chats with no company aren't counted
 * as a client but are still chats).
 */
export function chatStats(chats, views, C, P) {
  const one = (days) => {
    const set = new Set(days);
    const rows = chats.filter((r) => set.has(r.day));
    const questions = rows.reduce((a, r) => a + (Number(r.questions) || 0), 0);
    return {
      chats: rows.length,
      clients: new Set(rows.map((r) => r.company_id).filter((id) => id != null)).size,
      questions,
      avg: rows.length ? Math.round((questions / rows.length) * 10) / 10 : 0,
      fromChat: views.filter((r) => set.has(r.day) && openSourceKey(r.source) === 'chat')
        .reduce((a, r) => a + (Number(r.sessions) || 0), 0)
    };
  };
  const cur = one(C);
  const prev = one(P);
  const avg = compare(cur.avg, prev.avg);
  return {
    chats_started: compare(cur.chats, prev.chats),
    clients_chatted: compare(cur.clients, prev.clients),
    questions_asked: compare(cur.questions, prev.questions),
    avg_questions_per_chat: { ...avg, delta: Math.round(avg.delta * 10) / 10 },
    cards_opened_from_chat: compare(cur.fromChat, prev.fromChat)
  };
}

/** Most matched, popular, movers, shifting trends, card sources and chat over a set of rows. */
function rankings({ matches, views, signups, watchlist, chats }, C, P, titles, metadata) {
  const shown = matches.filter((r) => r.times_shown > 0);
  const pairsCur = distinctMetric(shown, C, pairKey);
  const pairsPrev = distinctMetric(shown, P, pairKey);
  const signupsCur = distinctMetric(signups, C, (r) => r.company_id);
  const signupsPrev = distinctMetric(signups, P, (r) => r.company_id);

  // Per grant
  const shownCur = companiesShownByGrant(matches, C);
  const shownPrev = companiesShownByGrant(matches, P);
  const opensCur = countBy(views, C, 'grant_root_id', (r) => r.sessions);
  const opensPrev = countBy(views, P, 'grant_root_id', (r) => r.sessions);
  const savesCur = countBy(watchlist, C, 'grant_root_id');
  const grantIds = new Set([...shownCur.keys(), ...shownPrev.keys(), ...opensCur.keys(), ...savesCur.keys()]);
  const grants = [...grantIds].map((id) => ({
    grant_id: id,
    title: titleOf(titles, id),
    companies: shownCur.get(id)?.size ?? 0,
    previous: shownPrev.get(id)?.size ?? 0,
    opens: opensCur.get(id) ?? 0,
    previous_opens: opensPrev.get(id) ?? 0,
    saves: savesCur.get(id) ?? 0
  })).map((g) => ({ ...g, change: g.companies - g.previous }));

  const byId = (a, b) => a.grant_id - b.grant_id;
  const most_matched = grants.filter((g) => g.companies > 0)
    .sort((a, b) => b.companies - a.companies || b.opens - a.opens || byId(a, b)).slice(0, TOP_N);
  const popular = grants.filter((g) => g.opens + g.saves > 0)
    .sort((a, b) => b.opens - a.opens || b.saves - a.saves || byId(a, b)).slice(0, TOP_N);
  const movers = {
    risers: grants.filter((g) => g.change > 0).sort((a, b) => b.change - a.change || b.companies - a.companies || byId(a, b)).slice(0, MOVERS_N),
    drops: grants.filter((g) => g.change < 0).sort((a, b) => a.change - b.change || b.previous - a.previous || byId(a, b)).slice(0, MOVERS_N),
    up_count: grants.filter((g) => g.change > 0).length,
    down_count: grants.filter((g) => g.change < 0).length
  };

  const trends = shiftingTrends({
    curPairs: pairsCur.keys, prevPairs: pairsPrev.keys,
    curSignups: signupsCur.keys, prevSignups: signupsPrev.keys, metadata
  });

  return { most_matched, popular, movers, trends, open_sources: openSources(views, C, P), chat: chatStats(chats, views, C, P) };
}

/** Grant card opens per source, current vs previous window; every source listed. */
export function openSources(views, C, P) {
  const tally = (days) => {
    const set = new Set(days);
    const out = new Map(OPEN_SOURCES.map((s) => [s.key, 0]));
    for (const r of views) {
      if (!set.has(r.day)) continue;
      const k = openSourceKey(r.source);
      out.set(k, out.get(k) + (Number(r.sessions) || 0));
    }
    return out;
  };
  const cur = tally(C);
  const prev = tally(P);
  return OPEN_SOURCES.map(({ key, label }) => ({ key, label, ...compare(cur.get(key), prev.get(key)) }));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function defaultDeps() {
  return {
    hubQuery: hubQueryDefault,
    appQuery: appQueryDefault,
    opsQuery: opsQueryDefault,
    readDay,
    liveGrants: liveGrantsDefault,
    now: () => new Date()
  };
}

async function readLiveDays(days, deps) {
  const out = { matches: [], views: [], ratings: [] };
  for (const day of days) {
    const raw = await deps.readDay(day, { ops: deps.opsQuery, app: deps.appQuery });
    out.matches.push(...aggregateMatches(raw.matches, raw.reviews));
    out.views.push(...aggregateViews(raw.views));
    out.ratings.push(...aggregateRatings(raw.ratings));
  }
  return out;
}

const textOrNull = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
export const shapeMetadata = (rows) => new Map(rows.map((r) => [r.company_id, {
  industries: [...new Set((Array.isArray(r.primary_industries) ? r.primary_industries : [])
    .filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))],
  provinces: splitProvinces(r.provinces),
  size: textOrNull(r.employee_range) ?? textOrNull(r.num_employees),
  revenue: textOrNull(r.recurring_revenue_range) ?? textOrNull(r.annual_revenue)
}]));

/** Read everything for one range and build the payload. Uncached. */
/**
 * The activity rows behind a range — both windows (current and previous) —
 * exactly as the Overview counts them: roll-ups for every day rolled after it
 * ended, the rest read live with the roll-up's own readDay(). Shared with the
 * Companies tab (companies.js), so a company's counts and the Overview's
 * totals come from the same rows.
 *
 * @returns {Promise<{w, lastRolled, tail, matches, views, ratings, signups, watchlist, chats, chatCompany: Map<string, number|null>}>}
 */
export async function loadWindowRows(range, deps) {
  const w = windowsFor(range, deps.now());
  const from = w.previous.from;
  const to = w.current.to;

  const lastRolled = (await deps.hubQuery(LAST_ROLLED_SQL)).rows[0]?.day ?? null;
  const tail = liveTail(from, to, lastRolled);
  const tailSet = new Set(tail.days);
  const notTail = (r) => !tailSet.has(r.day);

  const [rm, rv, rr, live, signups, watchlist, chats] = await Promise.all([
    deps.hubQuery(ROLLED_MATCHES_SQL, [from, to]),
    deps.hubQuery(ROLLED_VIEWS_SQL, [from, to]),
    deps.hubQuery(ROLLED_RATINGS_SQL, [from, to]),
    readLiveDays(tail.days, deps),
    deps.appQuery(SIGNUPS_SQL, [from, to]),
    deps.appQuery(WATCHLIST_ADDS_SQL, [from, to]),
    deps.opsQuery(CHATS_SQL, [from, to])
  ]);

  const num = (r) => ({ ...r, times_computed: Number(r.times_computed), times_shown: Number(r.times_shown) });
  const matches = [...rm.rows.filter(notTail).map(num), ...live.matches];
  const views = [...rv.rows.filter(notTail), ...live.views];
  const ratings = [...rr.rows.filter(notTail), ...live.ratings];

  const identities = await identitiesForClerkIds(chats.rows.map((r) => r.clerk_id), { query: deps.appQuery });
  const chatCompany = new Map([...identities].map(([clerk, v]) => [clerk, v.company_id]));
  return { w, lastRolled, tail, matches, views, ratings, signups: signups.rows, watchlist: watchlist.rows, chats: chats.rows, chatCompany };
}

export async function computeOverview(range = DEFAULT_RANGE, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const [rows, grants, need] = await Promise.all([
    loadWindowRows(range, deps),
    deps.liveGrants({ query: deps.appQuery }),
    deps.hubQuery(NEED_ACTION_SQL)
  ]);
  const { w, lastRolled, tail, matches, views, ratings, chatCompany } = rows;
  const signups = { rows: rows.signups };
  const watchlist = { rows: rows.watchlist };
  const chats = { rows: rows.chats };

  const companyIds = new Set([
    ...matches.filter((r) => r.times_shown > 0).map((r) => r.company_id),
    ...signups.rows.map((r) => r.company_id)
  ].filter((id) => Number.isInteger(id)));
  const metadata = companyIds.size
    ? shapeMetadata((await deps.appQuery(COMPANY_METADATA_SQL, [[...companyIds]])).rows)
    : new Map();

  const internalIds = deps.internalCompanyIds ?? INTERNAL_COMPANY_IDS;
  const payload = buildOverview(w, {
    matches, views, ratings,
    signups: signups.rows, watchlist: watchlist.rows, chats: chats.rows, chatCompany,
    titles: new Map(grants.map((g) => [g.root_id, g.title])),
    metadata,
    needAction: need.rows[0]?.n ?? 0,
    internalCompanies: internalCompanySet(internalIds)
  });
  // Names first, id second, wherever a company is shown. A names failure
  // never fails the overview.
  const names = await companyNamesForIds([...internalIds], { query: deps.appQuery }).catch(() => new Map());
  // What clients asked: the daily chat review's themes and rewritten questions
  // (cc_chat_questions, migration 049) for this window — the Chat tab's own
  // grouping, no model call. A missing table or a read error never fails the
  // overview.
  let asked = null;
  let askedError = null;
  try {
    asked = await (deps.askedForWindow ?? askedForWindow)(w, { hubQuery: deps.hubQuery, appQuery: deps.appQuery, storeQuery: deps.storeQuery });
  } catch (err) {
    askedError = String(err?.code ?? err?.name ?? 'unknown');
  }
  const tracking = trackingFor(await trackingStarts(deps), w.previous.from);
  return {
    ...payload,
    tracking,
    asked,
    ...(askedError ? { asked_error: askedError } : {}),
    internal_accounts: internalIds.map((id) => ({ id, name: names.get(id) ?? null, internal: true })),
    sources: {
      last_rolled_day: lastRolled,
      live_days: tail.days,
      stale_rollup: tail.stale
    }
  };
}

// ---------------------------------------------------------------------------
// Tracking starts
// ---------------------------------------------------------------------------

/** Each payload metric and the data its history comes from ("active" needs all four sources). */
export const TRACKED_BY = Object.freeze({
  signups: ['signups'], active_companies: ['matches', 'views', 'ratings', 'chats'], matches_shown: ['matches'],
  grants_opened: ['views'], ratings_up: ['ratings'], ratings_down: ['ratings'], watchlist_adds: ['watchlist'], chats: ['chats']
});
export const TRACKING_TTL_MS = 60 * 60 * 1000;
const trackingCache = { value: null, at: 0 };

/**
 * The first day of each source's data (Vancouver), cached for an hour. A
 * source that can't be read is left out (its changes keep showing); one with
 * no rows at all is null (nothing to compare with).
 */
export async function trackingStarts(deps) {
  const now = deps.now().getTime();
  if (trackingCache.value && now - trackingCache.at < TRACKING_TTL_MS) return trackingCache.value;
  const read = (q, sql) => q(sql).then((r) => r.rows[0] ?? {}).catch(() => ({}));
  const [hub, app, ops] = await Promise.all([
    read(deps.hubQuery, HUB_TRACKING_SQL), read(deps.appQuery, APP_TRACKING_SQL), read(deps.opsQuery, OPS_TRACKING_SQL)
  ]);
  const value = { ...hub, ...app, ...ops };
  if (Object.keys(value).length === 6) { trackingCache.value = value; trackingCache.at = now; }
  return value;
}

/**
 * Pure: per source and per metric, whether the previous window lies wholly
 * after tracking began. `from[source]` undefined = unknown (comparable),
 * null = no data yet (not comparable).
 */
export function trackingFor(from, previousFrom) {
  const ok = (src) => !(src in from) || (from[src] != null && from[src] <= previousFrom);
  const sources = Object.fromEntries(['matches', 'views', 'ratings', 'chats', 'signups', 'watchlist'].map((k) => [k, ok(k)]));
  const metrics = Object.fromEntries(Object.entries(TRACKED_BY).map(([m, srcs]) => [m, srcs.every((k) => sources[k])]));
  // The metric whose data starts latest names the date in the tooltip.
  const startOf = Object.fromEntries(Object.entries(TRACKED_BY).map(([m, srcs]) => [m,
    srcs.map((k) => from[k]).filter((d) => d != null).sort().pop() ?? null]));
  return { from, previous_from: previousFrom, sources, metrics, metric_from: startOf };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map();

/** The payload for a range, from cache when it is under CACHE_TTL_MS old. */
export async function getOverview(range = DEFAULT_RANGE, overrides = {}) {
  const now = (overrides.now ?? (() => new Date()))();
  const err = rangeError(range, now);
  if (err) throw new OverviewError(400, err);
  const hit = cache.get(range);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return { ...(await hit.promise), cached: true };

  const promise = computeOverview(range, overrides).then((p) => ({ ...p, generated_at: now.toISOString() }));
  cache.set(range, { at: now.getTime(), promise });
  trimCache(cache);
  try {
    return { ...(await promise), cached: false };
  } catch (err) {
    cache.delete(range); // never cache a failure
    throw err;
  }
}

export function _clearCacheForTests() {
  cache.clear();
  trackingCache.value = null;
  grantCache.value = null;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const SEARCH_LIMIT = 8;
export const COMPANY_SEARCH_SQL = `
  SELECT id, name FROM companies
   WHERE deleted_at IS NULL AND (id = $1 OR name ILIKE $2 ESCAPE '\\')
   ORDER BY (id = $1) DESC, name
   LIMIT ${SEARCH_LIMIT}`;

const grantCache = { value: null, at: 0 };

/** Companies by name or id, live grants by title or root id. */
export async function search(q, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const text = String(q ?? '').trim().slice(0, 100);
  if (text.length < 1) return { companies: [], grants: [] };
  const asId = /^\d{1,9}$/.test(text) ? Number(text) : -1;
  const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const now = deps.now().getTime();
  if (!grantCache.value || now - grantCache.at > CACHE_TTL_MS) {
    grantCache.value = await deps.liveGrants({ query: deps.appQuery });
    grantCache.at = now;
  }
  const needle = text.toLowerCase();
  const grants = grantCache.value
    .filter((g) => g.root_id === asId || String(g.title ?? '').toLowerCase().includes(needle))
    .sort((a, b) => (b.root_id === asId) - (a.root_id === asId) || String(a.title).localeCompare(String(b.title)))
    .slice(0, SEARCH_LIMIT)
    .map((g) => ({ type: 'grant', id: g.root_id, name: g.title }));

  const { rows } = await deps.appQuery(COMPANY_SEARCH_SQL, [asId, like]);
  return {
    companies: rows.map((r) => ({ type: 'company', id: r.id, name: r.name || `Company #${r.id}`, internal: isInternalCompany(r.id) })),
    grants
  };
}
