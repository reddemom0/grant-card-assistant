/**
 * Control Centre — Coverage & changes tab. Reads only.
 *
 *   coverage(range)   where the grant catalogue is thin: one row per main
 *                     industry (with its specific industries), plus smaller
 *                     breakdowns by province, goal track / grant type and grant
 *                     vs loan — client-only and with internal accounts
 *   changes(range)    what changed in the catalogue in the range: grants that
 *                     went live, closed, were removed or republished, edits,
 *                     and today's deadlines: passed (a live grant whose
 *                     deadline text is a past date), due in the next 30 days,
 *                     blank, unreadable (parseDeadline — one parser, src/tools/deadline.js)
 *
 * Coverage counts are today's catalogue (live grants and their tags). Matches,
 * AI-review cuts, goal-track gaps and changes follow the range.
 *
 * Definitions (docs/control-centre.md, Coverage & changes tab):
 *   restricted to an industry   tag level umbrella or specific, and one of the
 *                               grant's tokens maps to that main industry
 *                               (specific rows: tagged with that exact token)
 *   open to every industry      tag level agnostic
 *   clients                     companies with a real Clerk user whose profile
 *                               industry maps to it (today); "ran matching" =
 *                               any match row in the range
 *   average grant matches       distinct grants shown in the range ÷ clients who
 *                               ran matching
 *   thin                        ≥ THIN_MIN_CLIENTS clients who ran matching and
 *                               an average under THIN_MAX_AVG
 *   wrong-industry cuts         distinct (company, grant) pairs the AI review
 *                               cut for wrong industry in the range
 *   not matching                (a) ran matching, got zero grant matches (a
 *                               coverage gap); (a2) clients, none ran matching
 *                               yet (not a gap); (b) no restricted grants at all
 *   goal-track gap              a client's latest run in the range showed 0
 *                               (empty) or fewer than FEW_GRANTS (few) on a track
 *
 * Sources: the Overview's window rows (overview.js loadWindowRows), app live
 * grants / companies / company_metadata / grant_audit_logs, Hub gg3_grants
 * (tags) and cc_review_items (empty-track cards), ops ai_review_log and
 * match_results. App and ops reads go through db.js (read-only). The industry
 * vocabulary is the engine's, copied in industry-vocabulary.js.
 */

import { query as hubQueryDefault } from '../database/connection.js';
import { appQuery as appQueryDefault, opsQuery as opsQueryDefault } from './db.js';
import { readDay, TIME_ZONE, vancouverDay, addDays } from './rollup.js';
import { loadWindowRows, OverviewError, COMPANY_METADATA_SQL, shapeMetadata, rangeError, windowsFor, trimCache } from './overview.js';
import { liveGrants as liveGrantsDefault } from './live-sources.js';
import { companyNamesForIds } from './identity.js';
import { isInternalCompany } from './internal-accounts.js';
import { grantLink, cardLink } from './links.js';
import { CLIENTS_SQL, ALL_GOALS_SECTION } from './companies.js';
import { shapeEdits } from './grants.js';
import { splitGrantTypes } from '../tools/grant-data-modes.js';
import { parseDeadline as readDeadline } from '../tools/deadline.js';
import { MAIN_INDUSTRIES, tokenMains, profileMains, canonicalToken, specificsByMain } from './industry-vocabulary.js';

export const THIN_MIN_CLIENTS = 2;
export const THIN_MAX_AVG = 3;
export const FEW_GRANTS = 3;
export const DUE_SOON_DAYS = 30;
/** ops ai_review_log starts here: cut counts before it are zero, not missing. */
export const CUTS_FROM = '2026-09-22';
export const VIEWS = Object.freeze(['all', 'not_matching']);
export const CACHE_MS = 5 * 60 * 1000;
export const TAGGING_NOTE = 'Some sector-specific grants are currently tagged as open to every industry (tagger fix pending), so some industries may look better covered than they are.';
export const NOT_MAPPED = 'Not mapped';

export const PROVINCES = Object.freeze([
  'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Northwest Territories',
  'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Yukon'
]);
const NATIONAL_PHRASES = new Set(['all of canada', 'canada', 'canada-wide', 'nationwide', 'national']);

export class CoverageError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'CoverageError';
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

// Hub DB
export const GRANT_TAG_ROWS_SQL = `
  SELECT id, grant_name, grant_type, regions, eligibility_criteria->'industry' AS industry
    FROM gg3_grants
   WHERE id = ANY($1::int[])`;

export const EMPTY_TRACK_CARDS_SQL = `
  SELECT id, company_id, goal_track, status FROM cc_review_items WHERE kind = 'empty_track'`;

// Ops DB (read-only): wrong-industry cuts, keyed to the company through the
// match row the review acted on (grants.js GRANT_REVIEW_SQL's join).
export const WRONG_INDUSTRY_CUTS_SQL = `
  SELECT DISTINCT m.company_id, a.grant_id
    FROM ai_review_log a
    JOIN LATERAL (
      SELECT occurred_at, company_id, user_id FROM match_results m
       WHERE m.result_set_id = a.result_set_id AND m.grant_id = a.grant_id AND m.section = a.track
       ORDER BY occurred_at LIMIT 1
    ) m ON TRUE
   WHERE a.action = 'cut' AND a.category = 'wrong_industry'
     AND ${between('m.occurred_at')}
     AND m.user_id LIKE 'user\\_%' AND m.company_id IS NOT NULL`;

// Each company's latest match run in the range, with what each goal track showed.
export const LATEST_TRACKS_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (company_id) company_id, result_set_id, occurred_at
      FROM match_results
     WHERE company_id IS NOT NULL AND user_id LIKE 'user\\_%' AND ${between('occurred_at')}
     ORDER BY company_id, occurred_at DESC
  )
  SELECT l.company_id, l.occurred_at AS run_at, m.section, count(*) FILTER (WHERE m.shown)::int AS shown
    FROM latest l
    JOIN match_results m ON m.result_set_id = l.result_set_id
   GROUP BY 1, 2, 3`;

// App DB (read-only). version.publish holds grants.id values (previous → new
// live version), so going live or closing is the two versions' statuses.
const versionJoin = (alias, col) => `${alias}.id = CASE WHEN a.${col} ~ '^\\d{1,9}$' THEN a.${col}::int END`;
export const TRANSITIONS_SQL = `
  SELECT a.id, a.action, a.grant_id, a.created_at, a.previous_value, a.new_value, a.user_id,
         ps.label AS prev_status, ns.label AS new_status
    FROM grant_audit_logs a
    LEFT JOIN grants pg ON a.action = 'version.publish' AND ${versionJoin('pg', 'previous_value')}
    LEFT JOIN statuses ps ON ps.id = pg.status_id
    LEFT JOIN grants ng ON a.action = 'version.publish' AND ${versionJoin('ng', 'new_value')}
    LEFT JOIN statuses ns ON ns.id = ng.status_id
   WHERE a.deleted_at IS NULL
     AND a.action IN ('version.publish', 'status.amend', 'grant.delete')
     AND ${between('a.created_at')}
   ORDER BY a.created_at, a.id`;

// A root whose live version was soft-deleted in the range.
export const DELETED_LIVE_SQL = `
  SELECT gr.id AS grant_id, g.deleted_at
    FROM grant_roots gr
    JOIN grants g ON g.id = gr.live_version
   WHERE g.deleted_at IS NOT NULL AND ${between('g.deleted_at')}`;

// Edits in the range, drafts (version.fork*) left out. Editor as on the Grants
// tab: app user id, role, and an email only when user_email_contacts has one.
export const RANGE_EDITS_SQL = `
  SELECT a.id, a.grant_id, a.action, a.created_at, a.user_id, NULL::text AS previous_value, NULL::text AS new_value,
         r.name AS role, e.email
    FROM grant_audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN LATERAL (SELECT c.email FROM user_email_contacts c WHERE c.user_id = a.user_id ORDER BY c.id LIMIT 1) e ON TRUE
   WHERE a.deleted_at IS NULL AND a.action NOT LIKE 'version.fork%'
     AND ${between('a.created_at')}
   ORDER BY a.created_at DESC, a.id DESC`;

export const ROOT_TITLES_SQL = `
  SELECT DISTINCT ON (root_id) root_id, title, grantor
    FROM grants
   WHERE root_id = ANY($1::int[])
   ORDER BY root_id, version_number DESC NULLS LAST, id DESC`;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const arr = (v) => (Array.isArray(v) ? v : []);
const round1 = (n) => Math.round(n * 10) / 10;
const iso = (v) => (v == null ? null : new Date(v).toISOString());

/** The Grants tab's variant rule: `clients` drops internal accounts, `all` keeps everyone. */
const VARIANTS = Object.freeze({
  clients: (isInternal) => (companyId) => !isInternal(companyId),
  all: () => () => true
});

/** A raw region value → a province name, 'national', or null. Sub-regions roll up by prefix. */
export function provinceOf(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (NATIONAL_PHRASES.has(lower)) return 'national';
  if (/^bc\b/.test(lower)) return 'British Columbia';
  return PROVINCES.find((p) => lower === p.toLowerCase() || lower.startsWith(`${p.toLowerCase()} `)
    || lower.startsWith(`${p.toLowerCase()}-`)) ?? null;
}

/** A grant's regions → { national, provinces: Set }. All 13 listed counts as national. */
export function grantProvinces(regions) {
  const provinces = new Set();
  let national = false;
  for (const r of arr(regions)) {
    const p = provinceOf(r);
    if (p === 'national') national = true;
    else if (p) provinces.add(p);
  }
  if (provinces.size === PROVINCES.length) national = true;
  return { national, provinces };
}

/** grant_type → 'grant' | 'loan' | 'both' | 'untagged'. */
export function fundingOf(grantType) {
  const types = splitGrantTypes(grantType);
  if (!types.length) return 'untagged';
  const loan = types.some((t) => /^loan$/i.test(t));
  if (!loan) return 'grant';
  return types.every((t) => /^loan$/i.test(t)) ? 'loan' : 'both';
}

/**
 * A free-text deadline → 'YYYY-MM-DD', or null when it isn't one date: blank,
 * rolling ("Open Until Filled", "Ouvert jusqu'à épuisement des fonds") or
 * unreadable (an ambiguous 04/09/2026, a month with no day, two dates). One
 * parser for the whole Hub — src/tools/deadline.js — which also reads French
 * months and ordinals and never guesses. The app DB has no structured due
 * date (checked 2026-10-22: grants.deadline is the only deadline column), so
 * this text is the source for every deadline the Control Centre shows.
 */
export function parseDeadline(text) {
  const d = readDeadline(text);
  return d.kind === 'date' ? d.date : null;
}

/** Pure: a gg3_grants row → the tags coverage reads. */
export function grantTagsOf(row) {
  const ind = row?.industry && typeof row.industry === 'object' ? row.industry : null;
  const level = ind?.restriction_level ?? null;
  const tokens = arr(ind?.industries).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
  const mains = new Set(tokens.flatMap(tokenMains));
  return {
    level,
    tokens,
    mains,
    restricted: level === 'umbrella' || level === 'specific',
    ...grantProvinces(row?.regions),
    grant_types: splitGrantTypes(row?.grant_type),
    funding: fundingOf(row?.grant_type)
  };
}

/** Pure: a client's profile industries → mains, specific tokens, "general" mains, unmapped values. */
export function clientIndustries(values) {
  const mains = new Set();
  const tokens = new Set();
  const general = new Set();
  const unmapped = [];
  for (const v of arr(values)) {
    const ms = profileMains(v);
    if (!ms.length) { unmapped.push(v); continue; }
    for (const m of ms) mains.add(m);
    const token = canonicalToken(v);
    if (token) tokens.add(token);
    else for (const m of ms) general.add(m);
  }
  return { mains, tokens, general, unmapped };
}

/** Pure: a row's activity numbers from its clients. */
function activity(clientIds, ctx) {
  let ran = 0; let total = 0; let pairs = 0;
  const cutGrants = new Map();
  for (const id of clientIds) {
    const shown = ctx.shownBy.get(id);
    if (ctx.ranMatching.has(id)) { ran += 1; total += shown?.size ?? 0; }
    for (const g of ctx.cutsBy.get(id) ?? []) { pairs += 1; cutGrants.set(g, (cutGrants.get(g) ?? 0) + 1); }
  }
  const avg = ran ? round1(total / ran) : null;
  return {
    clients: clientIds.length,
    ran_matching: ran,
    grant_matches: total,
    avg_matches: avg,
    thin: ran >= THIN_MIN_CLIENTS && total / ran < THIN_MAX_AVG,
    wrong_industry_cuts: pairs,
    cut_grants: [...cutGrants].map(([grant_id, clients]) => ({ grant_id, clients }))
      .sort((a, b) => b.clients - a.clients || a.grant_id - b.grant_id),
    client_ids: [...clientIds].sort((a, b) => a - b)
  };
}

/**
 * Pure: every main industry with its specific industries, for one variant.
 * `ctx`: clients [{id, industries}], grants [{root_id, tags}], shownBy
 * Map<company, Set<grant>>, ranMatching Set<company>, cutsBy Map<company, Set<grant>>.
 */
export function industryRows(ctx) {
  const specifics = specificsByMain();
  const tagged = ctx.grants.filter((g) => g.tags);
  const openToAll = tagged.filter((g) => g.tags.level === 'agnostic').length;
  const byMain = new Map(MAIN_INDUSTRIES.map((m) => [m, []]));
  const byToken = new Map();
  const generalBy = new Map(MAIN_INDUSTRIES.map((m) => [m, []]));
  const unmapped = [];
  for (const c of ctx.clients) {
    const ci = clientIndustries(c.industries);
    for (const m of ci.mains) byMain.get(m).push(c.id);
    for (const t of ci.tokens) { if (!byToken.has(t)) byToken.set(t, []); byToken.get(t).push(c.id); }
    for (const m of ci.general) generalBy.get(m).push(c.id);
    if (ci.unmapped.length && !ci.mains.size) unmapped.push(c.id);
  }
  const restrictedTo = (pred) => tagged.filter((g) => g.tags.restricted && pred(g.tags)).map((g) => g.root_id);

  const rows = MAIN_INDUSTRIES.map((main) => {
    const restricted = restrictedTo((t) => t.mains.has(main));
    const tokenRows = (specifics.get(main) ?? []).map((token) => {
      const ids = restrictedTo((t) => t.tokens.includes(token));
      return { industry: token, main, level: 'specific', restricted: ids.length, restricted_ids: ids,
        open_to_all: openToAll, ...activity(byToken.get(token) ?? [], ctx) };
    });
    // The main name itself as a tag (e.g. "Agriculture") is a token row too.
    if (tokenMains(main).includes(main)) {
      const ids = restrictedTo((t) => t.tokens.includes(main));
      tokenRows.unshift({ industry: `${main}, general`, main, level: 'specific', general: true, restricted: ids.length,
        restricted_ids: ids, open_to_all: openToAll, ...activity([...new Set([...(byToken.get(main) ?? []), ...generalBy.get(main)])], ctx) });
    } else if (generalBy.get(main).length) {
      tokenRows.unshift({ industry: `${main}, general`, main, level: 'specific', general: true, restricted: null,
        restricted_ids: [], open_to_all: openToAll, ...activity(generalBy.get(main), ctx) });
    }
    return { industry: main, level: 'main', restricted: restricted.length, restricted_ids: restricted,
      open_to_all: openToAll, ...activity(byMain.get(main), ctx), specifics: tokenRows };
  });
  return {
    rows,
    not_mapped: { industry: NOT_MAPPED, level: 'main', restricted: null, restricted_ids: [], open_to_all: openToAll,
      ...activity(unmapped, ctx), specifics: [] }
  };
}

const byRan = (a, b) => b.ran_matching - a.ran_matching || b.clients - a.clients || a.industry.localeCompare(b.industry);
const byClients = (a, b) => b.clients - a.clients || a.industry.localeCompare(b.industry);

/**
 * Pure: one view of the industry rows. `all` → the rows; `not_matching` →
 * { ran_zero: clients ran matching in the range and got zero grant matches —
 *     a real coverage gap; most clients who ran matching first;
 *   not_run: clients, but none ran matching in the range — not a coverage
 *     gap; most clients first;
 *   no_restricted: main industries (and specifics, under their main) with no
 *     restricted grants at all, shown with or without clients }.
 */
export function applyCoverageView(rows, view = 'all') {
  if (view === 'all') return rows;
  const flat = rows.flatMap((r) => [r, ...r.specifics]);
  return {
    ran_zero: flat.filter((r) => r.ran_matching > 0 && r.grant_matches === 0).sort(byRan),
    not_run: flat.filter((r) => r.clients > 0 && r.ran_matching === 0).sort(byClients),
    no_restricted: rows.map((r) => ({
      industry: r.industry,
      main_has_none: r.restricted === 0,
      row: r,
      specifics: r.specifics.filter((s) => s.restricted === 0)
    })).filter((x) => x.main_has_none || x.specifics.length)
  };
}

/** Pure: per company, the latest run's tracks → gaps (empty / few). */
export function trackGaps(trackRows) {
  const out = new Map();
  for (const r of trackRows) {
    if (!out.has(r.company_id)) out.set(r.company_id, { run_at: iso(r.run_at), tracks: [] });
    out.get(r.company_id).tracks.push({ section: r.section, shown: Number(r.shown) || 0 });
  }
  return out;
}

const gapOf = (shown) => (shown === 0 ? 'empty' : shown < FEW_GRANTS ? 'few' : null);

/** Pure: the smaller breakdowns for one variant. */
export function breakdowns(ctx) {
  const tagged = ctx.grants.filter((g) => g.tags);
  const cardFor = (company, section) => ctx.emptyCards.get(`${company}|${section}`) ?? null;
  const gapsFor = (clientIds, sectionFilter = null) => {
    const list = [];
    for (const id of clientIds) {
      for (const t of ctx.gaps.get(id)?.tracks ?? []) {
        if (sectionFilter && t.section !== sectionFilter) continue;
        const gap = gapOf(t.shown);
        if (!gap) continue;
        const card = cardFor(id, t.section);
        list.push({ company_id: id, section: t.section, shown: t.shown, gap,
          card: card ? { id: card.id, status: card.status, link: cardLink(card.id) } : null });
      }
    }
    return list;
  };
  const summarise = (list) => ({
    empty_tracks: list.filter((g) => g.gap === 'empty').length,
    few_tracks: list.filter((g) => g.gap === 'few').length,
    gaps: list.sort((a, b) => (a.gap === b.gap ? a.shown - b.shown : a.gap === 'empty' ? -1 : 1) || a.company_id - b.company_id)
  });

  const national = tagged.filter((g) => g.tags.national).length;
  const province = PROVINCES.map((p) => {
    const clientIds = ctx.clients.filter((c) => c.provinces.some((x) => provinceOf(x) === p || provinceOf(x) === 'national')).map((c) => c.id);
    const act = activity(clientIds, ctx);
    return { province: p, restricted: tagged.filter((g) => !g.tags.national && g.tags.provinces.has(p)).length, national,
      clients: act.clients, ran_matching: act.ran_matching, grant_matches: act.grant_matches, avg_matches: act.avg_matches, thin: act.thin,
      ...summarise(gapsFor(clientIds)) };
  });

  const sections = new Map();
  for (const c of ctx.clients) {
    for (const t of ctx.gaps.get(c.id)?.tracks ?? []) {
      if (!sections.has(t.section)) sections.set(t.section, []);
      sections.get(t.section).push(c.id);
    }
  }
  const shownOnTrack = new Map();
  for (const r of ctx.windowMatches) {
    if (!(Number(r.times_shown) > 0) || !ctx.keep(r.company_id)) continue;
    if (!shownOnTrack.has(r.section)) shownOnTrack.set(r.section, new Set());
    shownOnTrack.get(r.section).add(r.grant_id);
  }
  const goalTracks = [...sections].map(([section, ids]) => {
    const shownCounts = ids.map((id) => ctx.gaps.get(id).tracks.find((t) => t.section === section).shown);
    return {
      section,
      label: section === ALL_GOALS_SECTION ? 'All goals' : section,
      grants_shown_on_track: shownOnTrack.get(section)?.size ?? 0,
      clients: ids.length,
      avg_shown_latest_run: round1(shownCounts.reduce((n, x) => n + x, 0) / ids.length),
      ...summarise(gapsFor(ids, section))
    };
  }).sort((a, b) => (a.section === ALL_GOALS_SECTION ? 1 : b.section === ALL_GOALS_SECTION ? -1
    : b.empty_tracks - a.empty_tracks || b.few_tracks - a.few_tracks || a.label.localeCompare(b.label)));

  const typeCounts = new Map();
  let untyped = 0;
  for (const g of tagged) {
    if (!g.tags.grant_types.length) untyped += 1;
    for (const t of g.tags.grant_types) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const grantTypes = [...typeCounts].map(([type, n]) => ({ type, live_grants: n })).sort((a, b) => b.live_grants - a.live_grants || a.type.localeCompare(b.type));
  if (untyped) grantTypes.push({ type: 'Not tagged', live_grants: untyped, untagged: true });

  const funding = { grant: 0, loan: 0, both: 0, untagged: 0 };
  for (const g of tagged) funding[g.tags.funding] += 1;

  return { province, goal_tracks: goalTracks, grant_types: grantTypes, funding };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function defaultDeps() {
  return { hubQuery: hubQueryDefault, appQuery: appQueryDefault, opsQuery: opsQueryDefault, readDay,
    now: () => new Date(), liveGrants: liveGrantsDefault };
}

const coverageCache = new Map();
const changesCache = new Map();

const parseRange = (range, now = new Date()) => {
  const err = rangeError(range, now);
  if (err) throw new CoverageError(400, err);
  return range;
};

async function cached(cache, key, overrides, deps, build) {
  const now = deps.now().getTime();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS && !overrides.noCache) return hit.value;
  const value = await build(now);
  if (!overrides.noCache) { cache.set(key, { at: now, value }); trimCache(cache); }
  return value;
}

/** Coverage for a range: both variants, the page picks by its toggle. */
export async function coverage(range = 'month', overrides = {}) {
  parseRange(range, overrides.now?.());
  const deps = { ...defaultDeps(), ...overrides };
  return cached(coverageCache, range, overrides, deps, async (now) => {
    const rows = await loadWindowRows(range, deps);
    const { from, to, days } = rows.w.current;
    const [grants, clientsRes, cuts, tracks, cards] = await Promise.all([
      deps.liveGrants({ query: deps.appQuery }),
      deps.appQuery(CLIENTS_SQL),
      deps.opsQuery(WRONG_INDUSTRY_CUTS_SQL, [from, to]),
      deps.opsQuery(LATEST_TRACKS_SQL, [from, to]),
      deps.hubQuery(EMPTY_TRACK_CARDS_SQL)
    ]);
    const ids = grants.map((g) => g.root_id);
    const clientIds = clientsRes.rows.map((c) => c.id);
    const [tagRows, metaRows, names] = await Promise.all([
      ids.length ? deps.hubQuery(GRANT_TAG_ROWS_SQL, [ids]) : { rows: [] },
      clientIds.length ? deps.appQuery(COMPANY_METADATA_SQL, [clientIds]) : { rows: [] },
      companyNamesForIds(clientIds, { query: deps.appQuery })
    ]);
    return buildCoverage({
      range, from, to, days, grants, tagRows: tagRows.rows, clients: clientsRes.rows, metadata: shapeMetadata(metaRows.rows),
      names, matches: rows.matches, cuts: cuts.rows, tracks: tracks.rows, cards: cards.rows,
      data: { last_rolled_day: rows.lastRolled ?? null, live_days: rows.tail?.days?.length ?? 0 }, now
    });
  });
}

/** Pure: everything coverage() read → the payload. Exported for tests. */
export function buildCoverage(input, { isInternal = isInternalCompany } = {}) {
  const tagById = new Map(input.tagRows.map((r) => [Number(r.id), r]));
  const grants = input.grants.map((g) => ({ ...g, tags: tagById.has(g.root_id) ? grantTagsOf(tagById.get(g.root_id)) : null }));
  const inWindow = new Set(input.days);
  const windowMatches = input.matches.filter((r) => inWindow.has(r.day));
  const gaps = trackGaps(input.tracks);
  const emptyCards = new Map(input.cards.map((c) => [`${c.company_id}|${c.goal_track}`, { id: Number(c.id), status: c.status }]));
  const internal = new Set();

  const variants = {};
  for (const [name, make] of Object.entries(VARIANTS)) {
    const keep = make(isInternal);
    const shownBy = new Map();
    const ranMatching = new Set();
    for (const r of windowMatches) {
      if (r.company_id == null || !keep(r.company_id)) continue;
      ranMatching.add(r.company_id);
      if (Number(r.times_shown) > 0) {
        if (!shownBy.has(r.company_id)) shownBy.set(r.company_id, new Set());
        shownBy.get(r.company_id).add(r.grant_id);
      }
    }
    const cutsBy = new Map();
    for (const r of input.cuts) {
      if (!keep(r.company_id)) continue;
      if (!cutsBy.has(r.company_id)) cutsBy.set(r.company_id, new Set());
      cutsBy.get(r.company_id).add(Number(r.grant_id));
    }
    const clients = input.clients.filter((c) => keep(c.id)).map((c) => {
      if (isInternal(c.id)) internal.add(c.id);
      const md = input.metadata.get(c.id);
      return { id: c.id, industries: md?.industries ?? [], provinces: md?.provinces ?? [] };
    });
    const ctx = { clients, grants, shownBy, ranMatching, cutsBy, gaps, emptyCards, windowMatches, keep };
    const { rows, not_mapped } = industryRows(ctx);
    variants[name] = { industries: rows, not_mapped, breakdowns: breakdowns(ctx) };
  }

  const tagged = grants.filter((g) => g.tags);
  const clientsOut = {};
  for (const c of input.clients) {
    const md = input.metadata.get(c.id);
    clientsOut[c.id] = { name: input.names.get(c.id) ?? null, internal: isInternal(c.id),
      industries: md?.industries ?? [], provinces: md?.provinces ?? [] };
  }
  return {
    range: input.range,
    current: { from: input.from, to: input.to },
    definitions: { thin_min_clients: THIN_MIN_CLIENTS, thin_max_avg: THIN_MAX_AVG, few_grants: FEW_GRANTS, cuts_from: CUTS_FROM },
    note: TAGGING_NOTE,
    catalogue: {
      live_grants: grants.length,
      in_hub_copy: tagged.length,
      not_in_hub_copy: grants.filter((g) => !g.tags).map((g) => g.root_id),
      open_to_all: tagged.filter((g) => g.tags.level === 'agnostic').length,
      restricted: tagged.filter((g) => g.tags.restricted).length,
      untagged_industry: tagged.filter((g) => !g.tags.level).length,
      // Restricted, but no token maps to a main industry: the engine passes everyone.
      restricted_unmapped: tagged.filter((g) => g.tags.restricted && !g.tags.mains.size).map((g) => g.root_id)
    },
    grants: Object.fromEntries(grants.map((g) => [g.root_id, {
      title: g.title, grantor: g.grantor ?? null, level: g.tags?.level ?? null, tokens: g.tags?.tokens ?? [],
      deadline: g.deadline ?? null
    }])),
    open_to_all_ids: tagged.filter((g) => g.tags.level === 'agnostic').map((g) => g.root_id),
    clients: clientsOut,
    clients_variant: variants.clients,
    all_variant: variants.all,
    data: { ...input.data, cuts_from: CUTS_FROM },
    generated_at: new Date(input.now ?? Date.now()).toISOString()
  };
}

/**
 * Pure: audit transitions in the range → added / closed / removed / republished
 * per root. Republished = a version.publish of a grant that was live before and
 * after (active → active): the live card changed. A grant that went live in
 * the range is `added` only, never also `republished`.
 */
export function catalogueTransitions(rows, deletedLive, liveIds) {
  const per = new Map();
  const at = (id) => { if (!per.has(id)) per.set(id, { grant_id: id, went_live: null, closed: null, removed: null, to_status: null, republished: null }); return per.get(id); };
  for (const r of rows) {
    const e = at(Number(r.grant_id));
    const when = iso(r.created_at);
    if (r.action === 'grant.delete') { e.removed = when; continue; }
    const prev = r.action === 'version.publish' ? r.prev_status : String(r.previous_value ?? '').trim() || null;
    const next = r.action === 'version.publish' ? r.new_status : String(r.new_value ?? '').trim() || null;
    // status.amend sometimes holds an id, not a label: not a status change we can read.
    if (r.action === 'status.amend' && next && /^\d+$/.test(next)) continue;
    if (next === 'active' && prev !== 'active') { e.went_live = when; e.to_status = 'active'; }
    else if (prev === 'active' && next && next !== 'active') { e.closed = when; e.to_status = next; }
    else if (r.action === 'version.publish' && prev === 'active' && next === 'active') e.republished = when;
  }
  for (const r of deletedLive) at(Number(r.grant_id)).removed = iso(r.deleted_at);
  const added = []; const closed = []; const removed = []; const republished = [];
  for (const e of per.values()) {
    const live = liveIds.has(e.grant_id);
    if (e.removed && !live) removed.push({ grant_id: e.grant_id, at: e.removed });
    else if (e.went_live && live && !(e.closed && e.closed > e.went_live)) added.push({ grant_id: e.grant_id, at: e.went_live });
    else if (e.closed && !live) closed.push({ grant_id: e.grant_id, at: e.closed, status: e.to_status });
    else if (e.republished && live) republished.push({ grant_id: e.grant_id, at: e.republished });
  }
  const newest = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.grant_id - b.grant_id);
  return { added: added.sort(newest), closed: closed.sort(newest), removed: removed.sort(newest), republished: republished.sort(newest) };
}

/** Pure: edit rows (newest first) → one entry per grant. */
export function editsByGrant(rows) {
  const words = new Map(shapeEdits(rows).map((e) => [e.id, e]));
  const out = new Map();
  for (const r of rows) {
    const id = Number(r.grant_id);
    const e = words.get(r.id);
    if (!out.has(id)) out.set(id, { grant_id: id, edits: 0, kinds: new Map(), last_at: e.at, last_by: e.who });
    const g = out.get(id);
    g.edits += 1;
    g.kinds.set(e.what, (g.kinds.get(e.what) ?? 0) + 1);
  }
  return [...out.values()].map((g) => ({ ...g, kinds: [...g.kinds].map(([what, n]) => ({ what, n })).sort((a, b) => b.n - a.n) }))
    .sort((a, b) => (a.last_at < b.last_at ? 1 : a.last_at > b.last_at ? -1 : 0));
}

/** Signed whole days from `today` to `day` (both 'YYYY-MM-DD'): −12 = twelve days ago. */
export const daysFrom = (today, day) =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

/**
 * Pure: today's live grants by what their deadline text says, one parse each
 * (parseDeadline). A date before today is `passed` — the grant is still
 * active, so its status and its deadline disagree; a date up to DUE_SOON_DAYS
 * ahead is `due_soon`; no text is `blank`; a rolling phrase ("Open Until
 * Filled") is `rolling` and fine; anything else is `unreadable`. Each row:
 * {grant_id, title, grantor, deadline (ISO or null), deadline_text, days}
 * with `days` signed from today. `no_date` counts blank, rolling and
 * unreadable together, as the Changes list and Oracle's tool always have.
 */
export function deadlineFlags(grants, today) {
  const soon = addDays(today, DUE_SOON_DAYS);
  const out = { passed: [], due_soon: [], blank: [], rolling: [], unreadable: [], no_date: 0 };
  for (const g of grants) {
    const text = g.deadline == null ? null : (String(g.deadline).trim() || null);
    const d = readDeadline(text);
    const row = { grant_id: g.root_id, title: g.title ?? null, grantor: g.grantor ?? null,
      deadline: d.kind === 'date' ? d.date : null, deadline_text: text,
      days: d.kind === 'date' ? daysFrom(today, d.date) : null };
    if (d.kind === 'date') {
      if (d.date < today) out.passed.push(row);
      else if (d.date <= soon) out.due_soon.push(row);
      continue;
    }
    out.no_date += 1;
    out[d.kind].push(row);
  }
  const byDate = (a, b) => a.deadline.localeCompare(b.deadline) || a.grant_id - b.grant_id;
  out.passed.sort(byDate);
  out.due_soon.sort(byDate);
  return out;
}

/** What changed in the catalogue in the range. */
export async function changes(range = 'month', overrides = {}) {
  parseRange(range, overrides.now?.());
  const deps = { ...defaultDeps(), ...overrides };
  return cached(changesCache, range, overrides, deps, async (now) => {
    const today = vancouverDay(new Date(now));
    // The range's own window: a named range ends today, a custom one at its end.
    const w = windowsFor(range, new Date(now));
    const { from, to } = w.current;
    const [grants, transitions, deletedLive, edits] = await Promise.all([
      deps.liveGrants({ query: deps.appQuery }),
      deps.appQuery(TRANSITIONS_SQL, [from, to]),
      deps.appQuery(DELETED_LIVE_SQL, [from, to]),
      deps.appQuery(RANGE_EDITS_SQL, [from, to])
    ]);
    const liveIds = new Set(grants.map((g) => g.root_id));
    const moves = catalogueTransitions(transitions.rows, deletedLive.rows, liveIds);
    const edited = editsByGrant(edits.rows);
    const deadlines = deadlineFlags(grants, today);
    const titles = new Map(grants.map((g) => [g.root_id, { title: g.title, grantor: g.grantor ?? null }]));
    const missing = [...new Set([...moves.closed, ...moves.removed, ...edited].map((x) => x.grant_id).filter((id) => !titles.has(id)))];
    if (missing.length) {
      for (const r of (await deps.appQuery(ROOT_TITLES_SQL, [missing])).rows) titles.set(Number(r.root_id), { title: r.title, grantor: r.grantor ?? null });
    }
    const named = (x) => ({ ...x, title: titles.get(x.grant_id)?.title ?? `Grant #${x.grant_id}`,
      grantor: titles.get(x.grant_id)?.grantor ?? null, live: liveIds.has(x.grant_id), link: grantLink(x.grant_id) });
    return {
      range,
      current: { from, to },
      // Deadline flags are about today's catalogue, whatever the range.
      added: moves.added.map(named),
      closed: moves.closed.map(named),
      removed: moves.removed.map(named),
      republished: moves.republished.map(named),
      edited: edited.map(named),
      deadline_passed: deadlines.passed.map(named),
      due_soon: deadlines.due_soon.map(named),
      deadline_blank: deadlines.blank.map(named),
      deadline_unreadable: deadlines.unreadable.map(named),
      definitions: { due_soon_days: DUE_SOON_DAYS, deadlines_without_a_date: deadlines.no_date,
        deadlines_rolling: deadlines.rolling.length, audit_from: '2026-03-05', publishes_from: '2026-07-02' },
      generated_at: new Date(now).toISOString()
    };
  });
}

export function _clearCacheForTests() { coverageCache.clear(); changesCache.clear(); }

export { OverviewError };
