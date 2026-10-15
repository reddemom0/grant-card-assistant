/**
 * Control Centre nightly roll-up (migration 043)
 *
 * Reads match, view and rating history from the two source DBs (read-only,
 * through db.js) and upserts one row per key per Vancouver day into the Hub's
 * cc_daily_matches, cc_daily_views and cc_daily_ratings. Ranges then survive
 * the ops DB's 180-day match_results retention.
 *
 *   ops  match_results + ai_review_log   → cc_daily_matches
 *   app  grant_view_sessions             → cc_daily_views
 *   app  grant_recommendation_feedback_events → cc_daily_ratings
 *
 * One day at a time, each in its own Hub transaction: a failed day is logged
 * and the run moves on. Upsert only, never delete, so re-running a day that
 * has aged out of the source leaves stored history alone.
 *
 * Excluded before aggregation: ops rows whose user isn't a Clerk id (smoke,
 * probe, profile, stability harnesses). GetGranted staff are deliberately
 * kept — staff and client usage are blended during beta; the Overview splits
 * internal accounts out by company when it reads.
 *
 * Logs carry the day and counts only — never ids, names or SQL params.
 *
 * Nightly: 03:00 America/Vancouver over the last 3 days, only when
 * CC_ROLLUP_ENABLED=true. CLI: scripts/cc-rollup.mjs. Docs: docs/control-centre.md.
 */

import { appQuery, opsQuery, isAppDbConfigured } from './db.js';
import { isGg3OpsConfigured } from '../services/gg3-ops-db.js';
import { transaction } from '../database/connection.js';

export const TIME_ZONE = 'America/Vancouver';
export const VIEW_CAP_SECONDS = 600;
export const BACKFILL_FROM = '2026-08-26';
export const NIGHTLY_DAYS = 3;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});

/** Calendar date (YYYY-MM-DD) of a timestamp in America/Vancouver. */
export function vancouverDay(ts) {
  return dayFormat.format(ts instanceof Date ? ts : new Date(ts));
}

/** YYYY-MM-DD shifted by n calendar days. */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every day from..to inclusive. */
export function dayRange(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const num = (v) => (v === null || v === undefined ? null : Number(v));
const time = (v) => (v instanceof Date ? v : new Date(v)).getTime();

/**
 * match_results rows (+ ai_review_log rows already keyed to their match row)
 * → one record per (day, company_id, grant_id, section).
 *
 * times_computed / times_shown count distinct result sets. best_position is
 * the lowest 0-based position among shown rows. best_score is the highest
 * match_score over all computed rows. eligibility and ai_review_action take
 * the latest occurred_at.
 */
export function aggregateMatches(matchRows, reviewRows = []) {
  const groups = new Map();
  const keyOf = (r) => JSON.stringify([vancouverDay(r.match_occurred_at ?? r.occurred_at), r.company_id ?? null, r.grant_id, r.section]);

  for (const r of matchRows) {
    const key = keyOf(r);
    let g = groups.get(key);
    if (!g) {
      const [day, company_id, grant_id, section] = JSON.parse(key);
      g = { day, company_id, grant_id, section, computed: new Set(), shown: new Set(),
        best_position: null, best_score: null, eligibility: null, eligibility_at: -Infinity,
        ai_review_action: null, review_at: -Infinity };
      groups.set(key, g);
    }
    g.computed.add(r.result_set_id);
    if (r.shown) {
      g.shown.add(r.result_set_id);
      if (r.position !== null && r.position !== undefined && (g.best_position === null || r.position < g.best_position)) {
        g.best_position = r.position;
      }
    }
    const score = num(r.match_score);
    if (score !== null && (g.best_score === null || score > g.best_score)) g.best_score = score;
    const at = time(r.occurred_at);
    if (at >= g.eligibility_at) { g.eligibility_at = at; g.eligibility = r.eligibility ?? null; }
  }

  for (const r of reviewRows) {
    const g = groups.get(keyOf(r));
    if (!g) continue; // its match row was excluded (test traffic)
    const at = time(r.occurred_at);
    if (at >= g.review_at) { g.review_at = at; g.ai_review_action = r.action ?? null; }
  }

  return [...groups.values()].map((g) => ({
    day: g.day, company_id: g.company_id, grant_id: g.grant_id, section: g.section,
    times_computed: g.computed.size, times_shown: g.shown.size,
    best_position: g.best_position, best_score: g.best_score,
    eligibility: g.eligibility, ai_review_action: g.ai_review_action
  }));
}

/**
 * grant_view_sessions rows → one record per (day, company_id, grant_root_id,
 * source). Each session counts at most VIEW_CAP_SECONDS; the median is over
 * the capped values.
 */
export function aggregateViews(rows) {
  const groups = new Map();
  for (const r of rows) {
    const source = r.source ?? null;
    const key = JSON.stringify([vancouverDay(r.started_at), r.company_id ?? null, r.grant_root_id, source]);
    let g = groups.get(key);
    if (!g) {
      const [day, company_id, grant_root_id] = JSON.parse(key);
      g = { day, company_id, grant_root_id, source, seconds: [], users: new Set() };
      groups.set(key, g);
    }
    g.seconds.push(Math.min(Math.max(num(r.visible_ms) ?? 0, 0) / 1000, VIEW_CAP_SECONDS));
    if (r.user_id !== null && r.user_id !== undefined) g.users.add(r.user_id);
  }
  return [...groups.values()].map((g) => ({
    day: g.day, company_id: g.company_id, grant_root_id: g.grant_root_id, source: g.source,
    sessions: g.seconds.length,
    visible_seconds_capped: Math.round(g.seconds.reduce((a, b) => a + b, 0) * 1000) / 1000,
    median_visible_seconds: median(g.seconds),
    users: g.users.size
  }));
}

/**
 * grant_recommendation_feedback_events rows → one record per (day,
 * company_id, grant_root_id). Counts events, not net state: changed is an
 * event that replaced an earlier rating.
 */
export function aggregateRatings(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = JSON.stringify([vancouverDay(r.created_at), r.company_id ?? null, r.grant_root_id]);
    let g = groups.get(key);
    if (!g) {
      const [day, company_id, grant_root_id] = JSON.parse(key);
      g = { day, company_id, grant_root_id, ups: 0, downs: 0, changed: 0 };
      groups.set(key, g);
    }
    if (r.rating === 'up') g.ups += 1;
    else if (r.rating === 'down') g.downs += 1;
    if (r.previous_rating !== null && r.previous_rating !== undefined) g.changed += 1;
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Reads (one Vancouver day, read-only)
// ---------------------------------------------------------------------------

// [day 00:00, next day 00:00) in Vancouver, DST-correct. $1 is the day.
const inDay = (col) =>
  `${col} >= ($1::date)::timestamp AT TIME ZONE '${TIME_ZONE}'
     AND ${col} < ($1::date + 1)::timestamp AT TIME ZONE '${TIME_ZONE}'`;

export const MATCH_SQL = `
  SELECT occurred_at, company_id, grant_id, section, result_set_id, shown, position, match_score, eligibility
    FROM match_results
   WHERE ${inDay('occurred_at')}
     AND user_id LIKE 'user\\_%'`;

// Reviews are keyed to the match row they act on (same result set, grant and
// section), so they land on the match's day and company.
export const REVIEW_SQL = `SELECT a.occurred_at, a.action, m.occurred_at AS match_occurred_at,
                  m.company_id, a.grant_id, a.track AS section
             FROM ai_review_log a
             JOIN LATERAL (
               SELECT occurred_at, company_id, user_id
                 FROM match_results m
                WHERE m.result_set_id = a.result_set_id
                  AND m.grant_id = a.grant_id
                  AND m.section = a.track
                ORDER BY occurred_at
                LIMIT 1
             ) m ON TRUE
            WHERE ${inDay('m.occurred_at')}
              AND m.user_id LIKE 'user\\_%'`;

export const VIEWS_SQL = `
  SELECT started_at, company_id, grant_root_id, user_id,
         presentation_context->>'source' AS source, visible_ms
    FROM grant_view_sessions
   WHERE ${inDay('started_at')}`;

export const RATINGS_SQL = `
  SELECT created_at, company_id, grant_root_id, rating, previous_rating
    FROM grant_recommendation_feedback_events
   WHERE ${inDay('created_at')}`;

export async function readDay(day, { ops = opsQuery, app = appQuery } = {}) {
  const [matches, reviews, views, ratings] = await Promise.all([
    ops(MATCH_SQL, [day]),
    ops(REVIEW_SQL, [day]),
    app(VIEWS_SQL, [day]),
    app(RATINGS_SQL, [day])
  ]);
  return {
    matches: matches.rows, reviews: reviews.rows, views: views.rows, ratings: ratings.rows,
    sourceRows: {
      match_results: matches.rows.length, ai_review_log: reviews.rows.length,
      grant_view_sessions: views.rows.length, rating_events: ratings.rows.length
    }
  };
}

// ---------------------------------------------------------------------------
// Writes (Hub DB, upsert only)
// ---------------------------------------------------------------------------

export const UPSERT_MATCHES_SQL = `
  INSERT INTO cc_daily_matches
    (day, company_id, grant_id, section, times_computed, times_shown,
     best_position, best_score, eligibility, ai_review_action)
  SELECT * FROM unnest($1::date[], $2::int[], $3::int[], $4::text[], $5::int[], $6::int[],
                       $7::int[], $8::numeric[], $9::text[], $10::text[])
  ON CONFLICT ON CONSTRAINT cc_daily_matches_key DO UPDATE SET
    times_computed = EXCLUDED.times_computed, times_shown = EXCLUDED.times_shown,
    best_position = EXCLUDED.best_position, best_score = EXCLUDED.best_score,
    eligibility = EXCLUDED.eligibility, ai_review_action = EXCLUDED.ai_review_action,
    updated_at = NOW()`;

export const UPSERT_VIEWS_SQL = `
  INSERT INTO cc_daily_views
    (day, company_id, grant_root_id, source, sessions, visible_seconds_capped,
     median_visible_seconds, users)
  SELECT * FROM unnest($1::date[], $2::int[], $3::int[], $4::text[], $5::int[],
                       $6::numeric[], $7::numeric[], $8::int[])
  ON CONFLICT ON CONSTRAINT cc_daily_views_key DO UPDATE SET
    sessions = EXCLUDED.sessions, visible_seconds_capped = EXCLUDED.visible_seconds_capped,
    median_visible_seconds = EXCLUDED.median_visible_seconds, users = EXCLUDED.users,
    updated_at = NOW()`;

export const UPSERT_RATINGS_SQL = `
  INSERT INTO cc_daily_ratings (day, company_id, grant_root_id, ups, downs, changed)
  SELECT * FROM unnest($1::date[], $2::int[], $3::int[], $4::int[], $5::int[], $6::int[])
  ON CONFLICT ON CONSTRAINT cc_daily_ratings_key DO UPDATE SET
    ups = EXCLUDED.ups, downs = EXCLUDED.downs, changed = EXCLUDED.changed,
    updated_at = NOW()`;

const columns = (rows, names) => names.map((n) => rows.map((r) => r[n]));

/** One Hub transaction for the day. Empty tables are skipped (no-op upsert). */
export async function upsertDay(agg, { hubTransaction = transaction } = {}) {
  await hubTransaction(async (client) => {
    if (agg.matches.length) {
      await client.query(UPSERT_MATCHES_SQL, columns(agg.matches,
        ['day', 'company_id', 'grant_id', 'section', 'times_computed', 'times_shown',
          'best_position', 'best_score', 'eligibility', 'ai_review_action']));
    }
    if (agg.views.length) {
      await client.query(UPSERT_VIEWS_SQL, columns(agg.views,
        ['day', 'company_id', 'grant_root_id', 'source', 'sessions', 'visible_seconds_capped',
          'median_visible_seconds', 'users']));
    }
    if (agg.ratings.length) {
      await client.query(UPSERT_RATINGS_SQL, columns(agg.ratings,
        ['day', 'company_id', 'grant_root_id', 'ups', 'downs', 'changed']));
    }
  }, 'cc rollup upsert');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * Roll up every day from..to (inclusive, Vancouver dates). Dry run unless
 * write is true. Each day stands alone: a failure is recorded and logged by
 * error code, and later days still run.
 *
 * @returns {Promise<{days: Array, failed: number, sourceRows: object, rows: object}>}
 */
export async function runRollup({ from, to, write = false, deps = {}, log = console.log } = {}) {
  const read = deps.readDay ?? readDay;
  const upsert = deps.upsertDay ?? upsertDay;

  const days = [];
  const sourceRows = { match_results: 0, ai_review_log: 0, grant_view_sessions: 0, rating_events: 0 };
  const rows = { cc_daily_matches: 0, cc_daily_views: 0, cc_daily_ratings: 0 };
  let failed = 0;

  for (const day of dayRange(from, to)) {
    try {
      const src = await read(day);
      const agg = {
        matches: aggregateMatches(src.matches, src.reviews).filter((r) => r.day === day),
        views: aggregateViews(src.views).filter((r) => r.day === day),
        ratings: aggregateRatings(src.ratings).filter((r) => r.day === day)
      };
      if (write) await upsert(agg);

      const counts = { cc_daily_matches: agg.matches.length, cc_daily_views: agg.views.length, cc_daily_ratings: agg.ratings.length };
      for (const k of Object.keys(sourceRows)) sourceRows[k] += src.sourceRows[k];
      for (const k of Object.keys(rows)) rows[k] += counts[k];
      days.push({ day, ok: true, sourceRows: src.sourceRows, rows: counts, written: write });
      log(`CC rollup ${day}: read ${Object.values(src.sourceRows).reduce((a, b) => a + b, 0)} source rows → `
        + `matches ${counts.cc_daily_matches}, views ${counts.cc_daily_views}, ratings ${counts.cc_daily_ratings} `
        + `(${write ? 'written' : 'dry-run'})`);
    } catch (err) {
      failed += 1;
      const code = err?.code ?? err?.name ?? 'unknown';
      days.push({ day, ok: false, error: code });
      console.error(`❌ CC rollup ${day} failed — code: ${code}`);
    }
  }

  return { days, failed, sourceRows, rows };
}

/** Today in Vancouver, and the window ending today. */
export function lastNDays(n, now = new Date()) {
  const to = vancouverDay(now);
  return { from: addDays(to, -(n - 1)), to };
}

/** @param {Object} cron - node-cron */
export function startControlCentreRollup(cron) {
  if (process.env.CC_ROLLUP_ENABLED !== 'true') {
    console.log('⏸️  Control Centre roll-up off (set CC_ROLLUP_ENABLED=true to enable)');
    return false;
  }
  if (!isAppDbConfigured() || !isGg3OpsConfigured()) {
    console.warn('⚠️  Control Centre roll-up NOT scheduled — APP_DB_READONLY_URL / GG3_OPS_DB_READONLY_URL not set.');
    return false;
  }
  const run = async () => {
    try {
      const summary = await runRollup({ ...lastNDays(NIGHTLY_DAYS), write: true });
      if (summary.failed) console.error(`❌ CC rollup: ${summary.failed} of ${summary.days.length} days failed`);
    } catch (err) {
      console.error(`❌ CC rollup run failed — code: ${err?.code ?? err?.name ?? 'unknown'}`);
    }
  };
  cron.schedule('0 3 * * *', run, { name: 'cc-rollup', timezone: TIME_ZONE, noOverlap: true });
  console.log(`⏰ Cron job scheduled: Control Centre roll-up nightly 03:00 ${TIME_ZONE}, last ${NIGHTLY_DAYS} days`);
  return true;
}
