/**
 * Control Centre — Companies tab (step 7): the client list and one company's
 * page. Reads only, except the transcript view log (Hub, migration 048).
 *
 *   companyList(range)        every client (a company with a real Clerk user):
 *                             province, industry, last active, and in the range
 *                             grant matches / cards opened / chats; open cards
 *   companyCore(id)           first, fast: the company, profile as the engine sees
 *                             it + gaps, goals, goal tracks from the latest
 *                             recorded run with the AI review's overlay and, for a
 *                             track that showed nothing, where its grants went
 *   companyFeed(id)           after: tiles, timeline (newest first, ≤300; the page
 *                             shows 30 at a time), chats, review cards — the
 *                             company's own and grant patterns involving it
 *   companyDetail(id)         both, merged
 *   fileEmptyTrack(...)       "Flag empty track": a staff empty_track card with the
 *                             track's evidence (migration 048)
 *   whyMatched(id, grant)     match-explain mode=bad_match (deterministic, no
 *                             LLM), trimmed to the eligibility checks
 *   transcript(id, conv, by)  one conversation, verbatim, after checking it is
 *                             this company's — every view is logged
 *
 * Where things live (verified 2026-10-15):
 *   selected goals  app goals (deleted_at IS NULL, status 'active'); names are
 *                   business_goal_definitions names
 *   goal tracks     ops match_results.section — two names differ from the goal
 *                   (TRACK_ALIASES); funding_matches is every goal together
 *   AI review       ops ai_review_log by result_set_id + grant + track
 *
 * The range counts come from overview.js loadWindowRows, the Overview's own
 * rows. App and ops reads go through db.js (read-only). Logs carry codes only.
 * Docs: docs/control-centre.md.
 */

import { query as hubQueryDefault } from '../database/connection.js';
import { appQuery as appQueryDefault, opsQuery as opsQueryDefault } from './db.js';
import { readDay } from './rollup.js';
import { loadWindowRows, COMPANY_METADATA_SQL, shapeMetadata, OverviewError, openSourceKey, rangeError, trimCache } from './overview.js';
import { companyProfile as companyProfileDefault } from './live-sources.js';
import { companyNamesForIds } from './identity.js';
import { isInternalCompany } from './internal-accounts.js';
import { cardTitle, categoryWords } from './card-summary.js';
import { cardLink } from './links.js';

export const LIST_CACHE_MS = 5 * 60 * 1000;
export const TIMELINE_MAX = 300;
export const FIRST_QUESTION_CHARS = 200;

export class CompaniesError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CompaniesError';
    this.status = status;
  }
}

/** Goal name (app) → goal-track section name (ops match_results), where they differ. */
export const TRACK_ALIASES = Object.freeze({
  'Hire and Train People': 'Hire or Train People',
  'Improved Productivity': 'Improve Productivity'
});
export const ALL_GOALS_SECTION = 'funding_matches';
export const sectionFor = (goalName) => TRACK_ALIASES[goalName] ?? goalName;

/** Grant card open sources in platform words (the Overview's grouping). */
const SOURCE_WORDS = { goal_tracks: 'Goal tracks', browse: 'Browse', chat: 'Chat', watchlist: 'Watchlist', other: 'Direct link' };

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const CLERK_USER = `EXISTS (
       SELECT 1 FROM company_users cu
         JOIN users_clerk uc ON uc.user_id = cu.user_id AND uc.deleted_at IS NULL
        WHERE cu.company_id = c.id AND cu.deleted_at IS NULL
          AND uc.clerk_id LIKE 'user\\_%')`;

// App DB (read-only)
export const CLIENTS_SQL = `
  SELECT c.id, c.name, c.created_at
    FROM companies c
   WHERE c.deleted_at IS NULL AND ${CLERK_USER}
   ORDER BY c.id`;

// Plan tier (read-only): the latest subscription row per company. Plans are
// starter / lite / plus / pro; stripe_status is active, canceled, trialing or
// null. The Control Centre never writes to the app DB.
export const SUBSCRIPTIONS_SQL = `
  SELECT DISTINCT ON (company_id) company_id, plan_slug, stripe_status
    FROM company_subscriptions
   ORDER BY company_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST`;

// The company with its latest metadata extras in one round trip.
export const COMPANY_SQL = `
  SELECT c.id, c.name, c.created_at, c.deleted_at, ${CLERK_USER} AS is_client,
         md.business_type, md.incorporation_date,
         (SELECT count(*) FROM company_goal_field_values v WHERE v.company_id = c.id)::int AS goal_answers
    FROM companies c
    LEFT JOIN LATERAL (
      SELECT business_type, incorporation_date FROM company_metadata
       WHERE company_id = c.id ORDER BY id DESC LIMIT 1
    ) md ON TRUE
   WHERE c.id = $1`;

// $1 company ids, or NULL for every company
export const COMPANY_CLERKS_SQL = `
  SELECT uc.clerk_id, cu.company_id
    FROM company_users cu
    JOIN users_clerk uc ON uc.user_id = cu.user_id AND uc.deleted_at IS NULL
   WHERE cu.deleted_at IS NULL
     AND uc.clerk_id LIKE 'user\\_%'
     AND ($1::int[] IS NULL OR cu.company_id = ANY($1::int[]))`;

export const GOALS_SQL = `
  SELECT g.id, g.name, g.status, g.created_at, g.deleted_at, b.display_order
    FROM goals g
    LEFT JOIN business_goal_definitions b ON b.name = g.name
   WHERE g.company_id = $1
   ORDER BY b.display_order NULLS LAST, g.created_at`;


export const OPENS_SQL = `
  SELECT id::text AS id, started_at, grant_root_id, presentation_context->>'source' AS source, visible_ms
    FROM grant_view_sessions
   WHERE company_id = $1
   ORDER BY started_at DESC
   LIMIT ${TIMELINE_MAX}`;

export const OPEN_TOTALS_SQL = `
  SELECT count(*)::int AS views, count(DISTINCT grant_root_id)::int AS grants,
         coalesce(sum(visible_ms), 0)::bigint AS visible_ms
    FROM grant_view_sessions
   WHERE company_id = $1`;

export const RATINGS_SQL = `
  SELECT id::text AS id, created_at, grant_root_id, rating, previous_rating
    FROM grant_recommendation_feedback_events
   WHERE company_id = $1
   ORDER BY created_at DESC
   LIMIT ${TIMELINE_MAX}`;

export const WATCHLIST_EVENTS_SQL = `
  SELECT wg.id, wg.grant_id AS grant_root_id, wg.created_at, wg.deleted_at
    FROM watchlist_grants wg
    JOIN watchlists w ON w.id = wg.watchlist_id
   WHERE w.company_id = $1
   ORDER BY wg.created_at DESC
   LIMIT ${TIMELINE_MAX}`;

// Ops DB (read-only)
export const LATEST_RUN_SQL = `
  SELECT result_set_id, min(occurred_at) AS at
    FROM match_results
   WHERE company_id = $1
   GROUP BY result_set_id
   ORDER BY at DESC
   LIMIT 1`;

// Shown rows, plus any row the AI review touched (a cut can be a grant the engine didn't show).
export const RUN_ROWS_SQL = `
  SELECT m.section, m.grant_id, m.shown, m.position, m.eligibility, m.deleted_at_stage
    FROM match_results m
   WHERE m.result_set_id = $1
     AND (m.shown OR EXISTS (
       SELECT 1 FROM ai_review_log a
        WHERE a.result_set_id = m.result_set_id AND a.grant_id = m.grant_id AND a.track = m.section))`;

// Every track the run covered, with how many grants it considered and showed —
// a track can be in the run with nothing shown.
export const RUN_SECTIONS_SQL = `
  SELECT section, count(*)::int AS considered, count(*) FILTER (WHERE shown)::int AS shown
    FROM match_results
   WHERE result_set_id = $1
   GROUP BY section`;

// Where every considered grant went, per track: shown, or the step that removed it.
export const RUN_STAGES_SQL = `
  SELECT section, coalesce(deleted_at_stage, 'shown') AS stage, count(*)::int AS n
    FROM match_results
   WHERE result_set_id = $1
   GROUP BY 1, 2`;

export const RUN_REVIEW_SQL = `
  SELECT track, grant_id, action, category, reason, engine_rank, final_rank
    FROM ai_review_log
   WHERE result_set_id = $1
   ORDER BY track, engine_rank NULLS LAST`;

export const RUNS_SQL = `
  SELECT result_set_id, min(occurred_at) AS at,
         count(*) FILTER (WHERE shown)::int AS shown,
         count(DISTINCT section) FILTER (WHERE shown)::int AS sections
    FROM match_results
   WHERE company_id = $1
   GROUP BY result_set_id
   ORDER BY at DESC
   LIMIT 100`;

export const CONVERSATIONS_SQL = `
  SELECT id, user_id, created_at, updated_at,
         (SELECT m->>'content' FROM jsonb_array_elements(messages) WITH ORDINALITY x(m, i)
           WHERE m->>'role' = 'user' AND jsonb_typeof(m->'content') = 'string' ORDER BY i LIMIT 1) AS first_question,
         (SELECT count(*) FROM jsonb_array_elements(messages) m
           WHERE m->>'role' = 'user' AND jsonb_typeof(m->'content') = 'string')::int AS questions
    FROM conversations
   WHERE user_id = ANY($1::text[])
     AND jsonb_array_length(messages) > 0
   ORDER BY created_at DESC
   LIMIT 100`;

export const LAST_CHATS_SQL = `
  SELECT user_id, max(updated_at) AS at
    FROM conversations
   WHERE user_id LIKE 'user\\_%' AND jsonb_array_length(messages) > 0
   GROUP BY user_id`;

export const CONVERSATION_SQL = 'SELECT id, user_id, messages FROM conversations WHERE id = $1';

// Hub DB. Last active is client actions only: card opens and ratings here,
// chats from ops. Match runs are ours (a refresh, a backfill), so they don't count.
export const LAST_ROLLED_ACTIVITY_SQL = `
  SELECT company_id, max(day)::text AS day FROM (
    SELECT company_id, day FROM cc_daily_views
    UNION ALL SELECT company_id, day FROM cc_daily_ratings) x
   WHERE company_id IS NOT NULL
   GROUP BY company_id`;

export const OPEN_CARDS_SQL = `
  SELECT company_id, count(*)::int AS n
    FROM cc_review_items
   WHERE status <> 'closed' AND company_id IS NOT NULL
   GROUP BY company_id`;

export const COMPANY_CARDS_SQL = `
  SELECT i.id, i.kind, i.status, i.owner, i.company_id, i.grant_root_id, i.chat_turn_ref, i.pattern_category, i.goal_track,
         i.flag_count, i.created_at, i.closed_at, i.diagnosis->>'verdict' AS verdict, left(i.narrative, 240) AS narrative,
         g.grant_name
    FROM cc_review_items i
    LEFT JOIN gg3_grants g ON g.id = i.grant_root_id
   WHERE i.company_id = $1
   ORDER BY i.updated_at DESC, i.id DESC`;

// Grant-pattern cards whose evidence (an AI review cut, actor = the client's
// Clerk id) includes one of this company's users.
export const PATTERN_CARDS_FOR_CLERKS_SQL = `
  SELECT i.id, i.kind, i.status, i.owner, i.grant_root_id, i.pattern_category, i.flag_count, i.created_at, i.closed_at,
         i.diagnosis->>'verdict' AS verdict, left(i.narrative, 240) AS narrative, g.grant_name,
         count(f.id)::int AS cuts_for_client
    FROM cc_review_items i
    JOIN cc_review_flags f ON f.item_id = i.id AND f.source = 'ai_review_cut' AND f.actor = ANY($1::text[])
    LEFT JOIN gg3_grants g ON g.id = i.grant_root_id
   WHERE i.kind = 'grant_pattern'
   GROUP BY i.id, g.grant_name
   ORDER BY i.updated_at DESC, i.id DESC`;

// Empty-track cards already filed for this company (open or closed), by track.
export const EMPTY_TRACK_CARDS_SQL = `
  SELECT id, goal_track, status FROM cc_review_items
   WHERE kind = 'empty_track' AND company_id = $1`;

export const GRANT_NAMES_SQL = 'SELECT id, grant_name FROM gg3_grants WHERE id = ANY($1::int[])';

export const INSERT_VIEW_SQL = `
  INSERT INTO cc_transcript_views (conversation_id, company_id, viewer)
  VALUES ($1, $2, $3)`;

export const VIEWS_SQL = `
  SELECT conversation_id, viewer, max(viewed_at) AS last_viewed_at, count(*)::int AS views
    FROM cc_transcript_views
   WHERE conversation_id = ANY($1::int[])
   GROUP BY conversation_id, viewer
   ORDER BY max(viewed_at) DESC`;

export const STAFF_NAMES_SQL = 'SELECT lower(email) AS email, name FROM users WHERE lower(email) = ANY($1::text[])';

// ---------------------------------------------------------------------------
// Pure shaping
// ---------------------------------------------------------------------------

const clip = (s, n) => {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const laterDay = (a, b) => (a == null ? b : b == null ? a : (a > b ? a : b));

/**
 * Pure: the window's rows → per company: distinct grants shown, card opens,
 * chats started, and the latest day with a client action (an open, a rating,
 * a chat — not a match run).
 */
export function companyActivity({ matches, views, ratings, chats, chatCompany }, days) {
  const inWindow = new Set(days);
  const out = new Map();
  const get = (id) => {
    if (!out.has(id)) out.set(id, { grants: new Set(), cards_opened: 0, chats: 0, last_day: null });
    return out.get(id);
  };
  for (const r of matches) {
    if (r.company_id == null || !inWindow.has(r.day)) continue;
    const a = get(r.company_id);
    if (r.times_shown > 0) a.grants.add(r.grant_id);
  }
  for (const r of views) {
    if (r.company_id == null || !inWindow.has(r.day)) continue;
    const a = get(r.company_id);
    a.cards_opened += Number(r.sessions) || 0;
    a.last_day = laterDay(a.last_day, r.day);
  }
  for (const r of ratings) {
    if (r.company_id == null || !inWindow.has(r.day)) continue;
    get(r.company_id).last_day = laterDay(get(r.company_id).last_day, r.day);
  }
  for (const r of chats) {
    const id = chatCompany.get(r.clerk_id);
    if (id == null || !inWindow.has(r.day)) continue;
    const a = get(id);
    a.chats += 1;
    a.last_day = laterDay(a.last_day, r.day);
  }
  return new Map([...out].map(([id, a]) => [id, { grant_matches: a.grants.size, cards_opened: a.cards_opened, chats: a.chats, last_day: a.last_day }]));
}

/**
 * Pure: one list row per client, names first, internal tagged. last_active is
 * the latest client action (a card open, a rating, a chat) and null when there
 * has been none — a sign-up isn't activity, so it never stands in for it.
 * size / revenue are the profile as matching reads it; plan is the latest
 * subscription's plan_slug (null when the company has none).
 */
export function buildCompanyList({ clients, metadata, activity, rolledLast, chatLast, openCards, plans = new Map(), isInternal = isInternalCompany }) {
  return clients.map((c) => {
    const m = metadata.get(c.id);
    const a = activity.get(c.id) ?? { grant_matches: 0, cards_opened: 0, chats: 0, last_day: null };
    const p = plans.get(c.id);
    const signup = iso(c.created_at)?.slice(0, 10) ?? null;
    const last = [rolledLast.get(c.id), a.last_day, chatLast.get(c.id)].reduce(laterDay, null);
    return {
      id: c.id,
      name: c.name || `Company #${c.id}`,
      internal: isInternal(c.id),
      provinces: m?.provinces ?? [],
      industries: m?.industries ?? [],
      size: m?.size ?? null,
      revenue: m?.revenue ?? null,
      plan: p?.plan_slug ?? null,
      plan_status: p?.stripe_status ?? null,
      signed_up: signup,
      last_active: last ?? null,
      grant_matches: a.grant_matches,
      cards_opened: a.cards_opened,
      chats: a.chats,
      open_cards: openCards.get(c.id) ?? 0
    };
  });
}

/** A company size the engine can read: "2-10", "11-50", "10-50 employees", "1,001+ employees", a number. */
export function readableSize(v) {
  if (v == null) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  return /^\s*\d[\d,]*\s*(-\s*\d[\d,]*|\+)?(\s*employees)?\s*$/i.test(String(v));
}

/** Pure: profile gaps in plain words — what the engine can't use and what that means. */
export function profileGaps(profile) {
  if (!profile?.found) return [{ field: 'profile', text: 'No company profile on record — matching has nothing to check against.' }];
  const e = profile.engine;
  const gaps = [];
  if (!e.industries.length) gaps.push({ field: 'industries', text: 'No industry — grants limited to an industry are not ruled out for this company.' });
  if (!e.provinces.length) gaps.push({ field: 'provinces', text: 'No province — grants limited to a region are not ruled out for this company.' });
  const size = e.employee_count;
  if (size == null || String(size).trim() === '') gaps.push({ field: 'employee_count', text: 'No company size — size limits are skipped.' });
  else if (!readableSize(size)) gaps.push({ field: 'employee_count', text: `Company size "${size}" can't be read by matching — size limits are skipped.` });
  if (e.annual_revenue == null || String(e.annual_revenue).trim() === '') gaps.push({ field: 'annual_revenue', text: 'No revenue — revenue limits are skipped.' });
  return gaps;
}

/** Pure: goals → { active (definition order), earlier }. */
export function shapeGoals(rows) {
  const active = rows.filter((g) => g.deleted_at == null && g.status === 'active');
  const earlier = rows.filter((g) => !(g.deleted_at == null && g.status === 'active'));
  const one = (g) => ({ id: g.id, name: g.name, status: g.status, added: iso(g.created_at), removed: iso(g.deleted_at), track: sectionFor(g.name) });
  return { active: active.map(one), earlier: earlier.map(one) };
}

const REVIEW_ACTION_WORDS = { moved_up: 'moved up', moved_down: 'moved down', flag: 'flagged it' };

/**
 * Pure: the latest run's rows + the AI review's rows → one block per active
 * goal (and "All goals"): the grants shown, in order, with eligibility and the
 * review's mark. Cut grants the engine didn't show are listed after.
 */
export function buildGoalTracks({ goals, runRows, reviewRows, grantNames, run, sections = [] }) {
  const covered = new Map(sections.map((s) => [s.section, s]));
  const byTrack = new Map();
  for (const r of runRows) {
    if (!byTrack.has(r.section)) byTrack.set(r.section, new Map());
    byTrack.get(r.section).set(r.grant_id, r);
  }
  const reviews = new Map();
  for (const r of reviewRows) {
    const key = `${r.track}|${r.grant_id}`;
    if (!reviews.has(key)) reviews.set(key, []);
    reviews.get(key).push(r);
  }
  const block = (name, section) => {
    const rows = [...(byTrack.get(section)?.values() ?? [])];
    const grants = rows.map((r) => {
      const rv = reviews.get(`${section}|${r.grant_id}`) ?? [];
      const cut = rv.find((x) => x.action === 'cut');
      const moved = rv.find((x) => x.action === 'moved_up' || x.action === 'moved_down');
      return {
        grant_id: r.grant_id,
        grant_name: grantNames.get(r.grant_id) ?? null,
        shown: Boolean(r.shown),
        position: r.position == null ? null : r.position + 1,
        eligibility: r.eligibility ?? null,
        removed_at: r.deleted_at_stage ?? null,
        review: cut
          ? { action: 'cut', label: `AI review cut: ${categoryWords(cut.category)}`, reason: cut.reason ?? null }
          : moved && moved.final_rank != null
            ? { action: moved.action, label: `AI review ${REVIEW_ACTION_WORDS[moved.action]} to #${moved.final_rank}`, reason: moved.reason ?? null }
            : rv.find((x) => x.action === 'flag') ? { action: 'flag', label: 'AI review flagged it', reason: rv.find((x) => x.action === 'flag').reason ?? null } : null
      };
    }).sort((a, b) => (a.shown === b.shown ? (a.position ?? 999) - (b.position ?? 999) : a.shown ? -1 : 1));
    const cov = covered.get(section);
    return { goal: name, section, in_run: Boolean(cov) || byTrack.has(section),
      considered: cov?.considered ?? null, shown: cov?.shown ?? grants.filter((g) => g.shown).length, grants };
  };
  const tracks = goals.map((g) => block(g.name, g.track));
  if (byTrack.has(ALL_GOALS_SECTION) || covered.has(ALL_GOALS_SECTION)) tracks.push(block('All goals', ALL_GOALS_SECTION));
  return { as_of: iso(run?.at), result_set_id: run?.result_set_id ?? null, tracks };
}

/** Pure: every event, newest first, capped. */
export function buildTimeline(groups, max = TIMELINE_MAX) {
  return groups.flat().filter((e) => e.at).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, max);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function defaultDeps() {
  return { hubQuery: hubQueryDefault, appQuery: appQueryDefault, opsQuery: opsQueryDefault, readDay, now: () => new Date(),
    companyProfile: companyProfileDefault };
}

const listCache = new Map();

/** The client list for a range (cached LIST_CACHE_MS per range). */
export async function companyList(range = 'week', overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const rangeProblem = rangeError(range, deps.now());
  if (rangeProblem) throw new CompaniesError(400, rangeProblem);
  const now = deps.now().getTime();
  const hit = listCache.get(range);
  if (hit && now - hit.at < LIST_CACHE_MS && !overrides.noCache) return hit.value;

  const [rows, clients, clerks, rolled, openCards, lastChats, subscriptions] = await Promise.all([
    loadWindowRows(range, deps),
    deps.appQuery(CLIENTS_SQL),
    deps.appQuery(COMPANY_CLERKS_SQL, [null]),
    deps.hubQuery(LAST_ROLLED_ACTIVITY_SQL),
    deps.hubQuery(OPEN_CARDS_SQL),
    deps.opsQuery(LAST_CHATS_SQL),
    // Plan tiers are a nicety: a failed read leaves plan null, never fails the list.
    deps.appQuery(SUBSCRIPTIONS_SQL).catch((err) => {
      console.error(`Control Centre companies: subscriptions unreadable (code: ${err?.code || err?.name || 'unknown'})`);
      return { rows: [] };
    })
  ]);
  const ids = clients.rows.map((c) => c.id);
  const metadata = ids.length ? shapeMetadata((await deps.appQuery(COMPANY_METADATA_SQL, [ids])).rows) : new Map();
  const companyOfClerk = new Map(clerks.rows.map((r) => [r.clerk_id, r.company_id]));
  const chatLast = new Map();
  for (const r of lastChats.rows) {
    const id = companyOfClerk.get(r.user_id);
    if (id == null) continue;
    const day = new Date(r.at).toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' });
    chatLast.set(id, laterDay(chatLast.get(id), day));
  }
  const value = {
    range,
    current: { from: rows.w.current.from, to: rows.w.current.to },
    companies: buildCompanyList({
      clients: clients.rows,
      metadata,
      activity: companyActivity(rows, rows.w.current.days),
      rolledLast: new Map(rolled.rows.map((r) => [r.company_id, r.day])),
      chatLast,
      openCards: new Map(openCards.rows.map((r) => [r.company_id, r.n])),
      plans: new Map(subscriptions.rows.map((r) => [r.company_id, r]))
    }),
    generated_at: new Date(now).toISOString()
  };
  if (!overrides.noCache) { listCache.set(range, { at: now, value }); trimCache(listCache); }
  return value;
}

async function grantNamesFor(ids, deps) {
  const list = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  if (!list.length) return new Map();
  return new Map((await deps.hubQuery(GRANT_NAMES_SQL, [list])).rows.map((r) => [r.id, r.grant_name]));
}

async function staffNamesFor(emails, deps) {
  const list = [...new Set(emails.filter((e) => typeof e === 'string' && e.includes('@')).map((e) => e.toLowerCase()))];
  if (!list.length) return new Map();
  try {
    return new Map((await deps.hubQuery(STAFF_NAMES_SQL, [list])).rows.map((r) => [r.email, r.name]));
  } catch {
    return new Map();
  }
}

/** Views of these conversations → Map<conversation_id, [{viewer, name, last_viewed_at, views}]>. */
async function viewsFor(conversationIds, deps) {
  if (!conversationIds.length) return new Map();
  let rows = [];
  try {
    rows = (await deps.hubQuery(VIEWS_SQL, [conversationIds])).rows;
  } catch (err) {
    if (err?.code !== '42P01') throw err; // 048 not applied: no views yet
  }
  const names = await staffNamesFor(rows.map((r) => r.viewer), deps);
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.conversation_id)) out.set(r.conversation_id, []);
    out.get(r.conversation_id).push({ viewer: r.viewer, name: names.get(String(r.viewer).toLowerCase()) ?? null,
      last_viewed_at: iso(r.last_viewed_at), views: r.views });
  }
  return out;
}

const parseCompanyId = (v) => {
  const n = Number.parseInt(v, 10);
  if (!(Number.isInteger(n) && n > 0 && String(n) === String(v).trim())) throw new CompaniesError(400, 'company id must be a positive integer');
  return n;
};

/** Where the grants a run considered went, in words (match_results.deleted_at_stage). */
export const STAGE_WORDS = Object.freeze({
  shown: 'shown',
  eligibility: 'failed eligibility',
  genre_floor: 'below the topic match floor',
  badge: 'removed by the badge filter',
  truncation: 'cut to the list length',
  cap: 'over the per-track cap',
  dedup: 'duplicates of another grant'
});

/** Pure: stage rows → Map<section, [{stage, words, n}]>, most first. */
export function stagesBySection(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.section)) out.set(r.section, []);
    out.get(r.section).push({ stage: r.stage, words: STAGE_WORDS[r.stage] ?? String(r.stage).replace(/_/g, ' '), n: r.n });
  }
  for (const list of out.values()) list.sort((a, b) => b.n - a.n);
  return out;
}

/**
 * The first half of a company's page — what's needed to read it: the company,
 * its profile and gaps, goals, and goal tracks. App reads start together
 * (the company row, the profile's three, goals, answers) and the ops run chain
 * runs alongside them.
 */
export async function companyCore(idInput, overrides = {}) {
  const id = parseCompanyId(idInput);
  const deps = { ...defaultDeps(), ...overrides };

  const runChain = (async () => {
    const run = (await deps.opsQuery(LATEST_RUN_SQL, [id])).rows[0] ?? null;
    if (!run) return { run: null, rows: [], reviews: [], sections: [], stages: [] };
    const [rows, reviews, sections, stages] = await Promise.all([
      deps.opsQuery(RUN_ROWS_SQL, [run.result_set_id]), deps.opsQuery(RUN_REVIEW_SQL, [run.result_set_id]),
      deps.opsQuery(RUN_SECTIONS_SQL, [run.result_set_id]), deps.opsQuery(RUN_STAGES_SQL, [run.result_set_id])
    ]);
    return { run, rows: rows.rows, reviews: reviews.rows, sections: sections.rows, stages: stages.rows };
  })();

  const [companyRes, profile, goalsRows, chain, emptyCards] = await Promise.all([
    deps.appQuery(COMPANY_SQL, [id]),
    deps.companyProfile(id, { query: deps.appQuery }),
    deps.appQuery(GOALS_SQL, [id]),
    runChain,
    // Before 048 there are none; a missing column must not fail the page.
    deps.hubQuery(EMPTY_TRACK_CARDS_SQL, [id]).catch(() => ({ rows: [] }))
  ]);
  const company = companyRes.rows[0];
  if (!company) throw new CompaniesError(404, 'company not found');

  const goals = shapeGoals(goalsRows.rows);
  const grantNames = await grantNamesFor(chain.rows.map((r) => r.grant_id), deps);
  const tracks = buildGoalTracks({ goals: goals.active, runRows: chain.rows, reviewRows: chain.reviews, grantNames, run: chain.run, sections: chain.sections });
  const stages = stagesBySection(chain.stages);
  const flagged = new Map(emptyCards.rows.map((r) => [r.goal_track, { id: Number(r.id), status: r.status }]));
  for (const t of tracks.tracks) {
    t.empty = t.in_run && t.shown === 0;
    if (t.empty) {
      t.removed = stages.get(t.section) ?? [];
      t.card = flagged.get(t.section) ?? null;
    }
  }

  return {
    company: { id, name: company.name || `Company #${id}`, internal: isInternalCompany(id), signed_up: iso(company.created_at),
      deleted: company.deleted_at != null, is_client: company.is_client },
    profile: {
      ...profile,
      business_type: company.business_type ?? null,
      incorporation_date: company.incorporation_date ? iso(company.incorporation_date).slice(0, 10) : null,
      gaps: profileGaps(profile)
    },
    goals: { ...goals, module_answers: company.goal_answers ?? 0 },
    goal_tracks: tracks
  };
}

/**
 * The second half — loaded after the page is showing: tiles, the timeline,
 * chats with who viewed them, and review cards (the company's own, then grant
 * patterns whose AI-review cuts include one of its users).
 */
export async function companyFeed(idInput, overrides = {}) {
  const id = parseCompanyId(idInput);
  const deps = { ...defaultDeps(), ...overrides };
  const [companyRes, clerks, opens, openTotals, ratings, watch, cards, runs] = await Promise.all([
    deps.appQuery(COMPANY_SQL, [id]),
    deps.appQuery(COMPANY_CLERKS_SQL, [[id]]),
    deps.appQuery(OPENS_SQL, [id]),
    deps.appQuery(OPEN_TOTALS_SQL, [id]),
    deps.appQuery(RATINGS_SQL, [id]),
    deps.appQuery(WATCHLIST_EVENTS_SQL, [id]),
    deps.hubQuery(COMPANY_CARDS_SQL, [id]),
    deps.opsQuery(RUNS_SQL, [id])
  ]);
  const company = companyRes.rows[0];
  if (!company) throw new CompaniesError(404, 'company not found');
  const clerkIds = clerks.rows.map((r) => r.clerk_id);
  const [convs, patterns] = await Promise.all([
    clerkIds.length ? deps.opsQuery(CONVERSATIONS_SQL, [clerkIds]) : Promise.resolve({ rows: [] }),
    clerkIds.length ? deps.hubQuery(PATTERN_CARDS_FOR_CLERKS_SQL, [clerkIds]) : Promise.resolve({ rows: [] })
  ]);

  const grantNames = await grantNamesFor([
    ...opens.rows.map((r) => r.grant_root_id), ...ratings.rows.map((r) => r.grant_root_id), ...watch.rows.map((r) => r.grant_root_id)
  ], deps);
  const views = await viewsFor(convs.rows.map((c) => c.id), deps);
  const env = deps.env ?? process.env;

  const ratingCount = (v) => ratings.rows.filter((r) => r.rating === v).length;
  const ot = openTotals.rows[0] ?? { views: 0, grants: 0, visible_ms: 0 };
  const gname = (gid) => grantNames.get(gid) ?? `Grant #${gid}`;

  const chats = convs.rows.map((c) => ({
    conversation_id: c.id, started: iso(c.created_at), last_active: iso(c.updated_at), questions: c.questions,
    first_question: clip(c.first_question, FIRST_QUESTION_CHARS), viewed_by: views.get(c.id) ?? []
  }));

  const card = (r, extra = {}) => ({
    id: Number(r.id), kind: r.kind, status: r.status, owner: r.owner, verdict: r.verdict, flag_count: r.flag_count,
    title: cardTitle({ ...r, company_name: company.name }), narrative: r.narrative, created_at: iso(r.created_at),
    closed_at: iso(r.closed_at), link: cardLink(r.id, env), ...extra
  });
  const own = cards.rows.map((r) => card(r));
  const ownIds = new Set(own.map((c) => c.id));
  const involving = patterns.rows.filter((r) => !ownIds.has(Number(r.id)))
    .map((r) => card(r, { involves_client: true, cuts_for_client: r.cuts_for_client }));

  const timeline = buildTimeline([
    [{ type: 'signed_up', at: iso(company.created_at), text: 'Signed up' }],
    runs.rows.map((r) => ({ type: 'matches', at: iso(r.at), text: `Matches refreshed — ${r.shown} shown across ${r.sections} goal ${r.sections === 1 ? 'track' : 'tracks'}`, result_set_id: r.result_set_id })),
    opens.rows.map((r) => ({ type: 'opened', at: iso(r.started_at), grant_id: r.grant_root_id, grant_name: gname(r.grant_root_id),
      text: `Opened ${gname(r.grant_root_id)}`, source: SOURCE_WORDS[openSourceKey(r.source)], seconds: r.visible_ms == null ? null : Math.round(r.visible_ms / 1000) })),
    ratings.rows.map((r) => ({ type: 'rated', at: iso(r.created_at), grant_id: r.grant_root_id, grant_name: gname(r.grant_root_id), rating: r.rating,
      text: `${r.rating === 'down' ? '👎' : '👍'} ${gname(r.grant_root_id)}${r.previous_rating && r.previous_rating !== r.rating ? ` (changed from ${r.previous_rating === 'down' ? '👎' : '👍'})` : ''}` })),
    watch.rows.flatMap((r) => [
      { type: 'saved', at: iso(r.created_at), grant_id: r.grant_root_id, grant_name: gname(r.grant_root_id), text: `Saved ${gname(r.grant_root_id)} to a watchlist` },
      ...(r.deleted_at ? [{ type: 'unsaved', at: iso(r.deleted_at), grant_id: r.grant_root_id, grant_name: gname(r.grant_root_id), text: `Removed ${gname(r.grant_root_id)} from a watchlist` }] : [])
    ]),
    chats.map((c) => ({ type: 'chat', at: c.started, conversation_id: c.conversation_id, text: `Started a chat: “${clip(c.first_question, 120) ?? '…'}”` })),
    own.flatMap((c) => [
      { type: 'card_filed', at: c.created_at, card_id: c.id, link: c.link, text: `Review card filed: ${c.title}` },
      ...(c.closed_at ? [{ type: 'card_closed', at: c.closed_at, card_id: c.id, link: c.link, text: `Review card closed: ${c.title}` }] : [])
    ])
  ]);

  return {
    company_id: id,
    users: clerkIds.length,
    // Client actions only: not our match runs or review cards.
    // Client actions only: not our match runs, not review cards, and not the sign-up itself.
    last_active: timeline.find((e) => !['matches', 'card_filed', 'card_closed', 'signed_up'].includes(e.type))?.at ?? null,
    tiles: { grant_views: ot.views, grants_opened: ot.grants, minutes_on_grants: Math.round(Number(ot.visible_ms) / 6000) / 10,
      thumbs_up: ratingCount('up'), thumbs_down: ratingCount('down'), chats: chats.length },
    timeline,
    chats,
    review_cards: [...own, ...involving]
  };
}

/** Everything on one company's page (both halves). */
export async function companyDetail(idInput, overrides = {}) {
  const [core, feed] = await Promise.all([companyCore(idInput, overrides), companyFeed(idInput, overrides)]);
  return {
    ...core,
    company: { ...core.company, users: feed.users, last_active: feed.last_active },
    tiles: feed.tiles, timeline: feed.timeline, chats: feed.chats, review_cards: feed.review_cards
  };
}

/**
 * "Flag empty track": a staff empty_track card for a goal track that showed
 * this company nothing in its latest recorded run. The evidence is built here,
 * from the run and the profile — never taken from the request.
 */
export async function fileEmptyTrack(idInput, section, note, actor, overrides = {}) {
  if (!actor) throw new CompaniesError(400, 'a signed-in staff member is required');
  if (typeof section !== 'string' || !section.trim()) throw new CompaniesError(400, 'track is required');
  const core = await companyCore(idInput, overrides);
  const track = core.goal_tracks.tracks.find((t) => t.section === section.trim());
  if (!track) throw new CompaniesError(404, "that goal track isn't on this company's page");
  if (!track.empty) throw new CompaniesError(409, 'that goal track showed grants in the latest run');
  const deps = { ...defaultDeps(), ...overrides };
  const addFlag = deps.addFlag ?? (await import('./review-queue.js')).addFlag;
  const p = core.profile;
  const snapshot = {
    source: 'empty_track',
    company: { id: core.company.id, name: core.company.name },
    goal: track.goal, goal_track: track.section,
    run: { result_set_id: core.goal_tracks.result_set_id, at: core.goal_tracks.as_of },
    considered: track.considered, removed: track.removed,
    profile: p.found ? { industries: p.engine.industries, provinces: p.engine.provinces, company_size: p.engine.employee_count,
      revenue: p.engine.annual_revenue, business_type: p.business_type } : null,
    profile_gaps: p.gaps.map((g) => g.text),
    other_goals: core.goal_tracks.tracks.filter((t) => t.section !== track.section).map((t) => ({ goal: t.goal, shown: t.shown }))
  };
  const text = typeof note === 'string' && note.trim() ? note.trim() : null;
  const r = await addFlag({
    kind: 'empty_track', company_id: core.company.id, goal_track: track.section, source: 'staff_flag', actor,
    comment: text ?? `${track.goal}: ${track.considered ?? 'all'} grants considered, none shown.`, snapshot
  });
  return { id: Number(r.item.id), created: r.created, reopened: r.reopened, link: cardLink(r.item.id, deps.env ?? process.env) };
}

/**
 * "Why matched?": match-explain's bad_match (deterministic — no LLM) for this
 * company and grant, trimmed to what the panel shows. No profile dump, no card text.
 */
export async function whyMatched(idInput, grantInput, { fetchBadMatch, env } = {}) {
  const id = parseCompanyId(idInput);
  const grantId = Number.parseInt(grantInput, 10);
  if (!(Number.isInteger(grantId) && grantId > 0)) throw new CompaniesError(400, 'grant must be a positive integer');
  const fetchFn = fetchBadMatch ?? (await import('./diagnosis.js')).fetchBadMatch;
  const r = await fetchFn({ grantId, companyId: id }, { env: env ?? process.env });
  if (!r.ok) {
    if (r.code === 'not_configured') throw Object.assign(new Error('match-explain not configured'), { code: 'not_configured' });
    throw Object.assign(new CompaniesError(502, `match explanation unavailable (${r.code})`), { upstream: r.code });
  }
  const b = r.body ?? {};
  return {
    grant_id: grantId, company_id: id, grant_name: b.grant_name ?? null,
    passes_eligibility_now: b.passes_eligibility_now ?? null,
    candidate_cause: b.candidate_cause ?? null,
    axes: b.axes ?? [],
    lenient_axes: b.lenient_axes ?? [],
    review_log: (b.review_log ?? []).slice(0, 8),
    recorded: { shown_history: b.recorded?.shown_history ?? null }
  };
}

/**
 * One conversation, verbatim, for this company only — and the view logged
 * (who, which conversation, when). Returns the turns and who has viewed it.
 */
export async function transcript(idInput, conversationInput, viewer, overrides = {}) {
  const id = parseCompanyId(idInput);
  const conversationId = Number.parseInt(conversationInput, 10);
  if (!(Number.isInteger(conversationId) && conversationId > 0)) throw new CompaniesError(400, 'conversation must be a positive integer');
  if (!viewer) throw new CompaniesError(400, 'a signed-in viewer is required');
  const deps = { ...defaultDeps(), ...overrides };
  const clerks = new Set((await deps.appQuery(COMPANY_CLERKS_SQL, [[id]])).rows.map((r) => r.clerk_id));
  const conv = (await deps.opsQuery(CONVERSATION_SQL, [conversationId])).rows[0];
  if (!conv || !clerks.has(conv.user_id)) throw new CompaniesError(404, "that conversation isn't one of this company's");
  const { splitTurns } = await import('./diagnosis.js');
  await deps.hubQuery(INSERT_VIEW_SQL, [conversationId, id, viewer]);
  const views = await viewsFor([conversationId], deps);
  return { conversation_id: conversationId, company_id: id, turns: splitTurns(conv.messages, { clipChars: Infinity }), viewed_by: views.get(conversationId) ?? [] };
}

/** Test-only. */
export function _clearCacheForTests() { listCache.clear(); }

export { OverviewError };
