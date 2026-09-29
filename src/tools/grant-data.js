/**
 * grant_data — Oracle's grant-data tool over its GG3 copy
 *
 * One tool with a required `mode`, so later modes (counts, card checks, bulk
 * search, tag audit, compare) arrive as enum values, not new tools. Only
 * "search" exists today.
 *
 * search reads gg3_grants (the hourly copy, migration 038), never GG3 itself:
 *   - ID lookup: GG3 grant links anywhere in the query, or a query that is only
 *     grant ids, return exactly those grants — any status, hide included — and
 *     name the ids that are not in the copy
 *   - otherwise keywords: grant names and card text (field_content values, HTML
 *     stripped, accents folded), matched at the start of a word. Filler words
 *     (grant, program, fund, stream…) and bare numbers never match or score on
 *     their own. Ranking (rankCandidates): exact name, then the whole query as a
 *     phrase in the name, then keyword hits (name 2, card text 1), then query
 *     numbers in the name ("Stream 2" over "Stream 1"), then recency
 *   - filters: regions (codes expanded; All-of-Canada grants always included),
 *     industries, grant types, funders — OR inside a filter, AND across
 *   - status defaults to active; GG3 "hide" grants only with include_hidden,
 *     and when they are left out their match count comes back as hidden_matches
 *   - matches at the visible statuses the search left out come back as
 *     other_status_matches (count, by status, best three), so a grant that
 *     exists but isn't active never looks absent
 *   - at most 20 results plus total_matches
 *   - GG1 status for grants linked by exact name (gg1_gg3_links, migration 039)
 *   - data_as_of from the latest successful gg3_refresh_runs row
 *
 * searchGrantData is also called directly by the watch and lead Chat cards.
 */

import { query } from '../database/connection.js';

export const MAX_RESULTS = 20;
const DEFAULT_RESULTS = 10;
const MAX_TOKENS = 12;
const MAX_IDS = 20;
const MAX_FILTER_VALUES = 10;
const SUMMARY_CHARS = 240;
const LIST_CAP = 12;
const OTHER_STATUS_TOP = 3;
export const GG3_VISIBLE_STATUSES = ['active', 'inactive', 'archived', 'draft'];
const APP_URL = 'https://app.getgranted.ai/grants/';
const ADMIN_URL = 'https://admin.getgranted.ai/grants/';

/** Words that never match or score on their own; they still count inside a phrase. */
const FILLER = new Set([
  'the', 'and', 'for', 'of', 'in', 'to', 'an', 'or', 'with',
  'grant', 'grants', 'program', 'programs', 'programme', 'programmes',
  'fund', 'funds', 'stream', 'streams'
]);
/** Bare numbers and stream labels ("2", "1b"): phrase and tie-break only. */
const NUMBERISH = /^\d+[a-z]?$/;

const PROVINCES = {
  bc: 'British Columbia', ab: 'Alberta', sk: 'Saskatchewan', mb: 'Manitoba',
  on: 'Ontario', qc: 'Quebec', nb: 'New Brunswick', ns: 'Nova Scotia',
  pe: 'Prince Edward Island', pei: 'Prince Edward Island',
  nl: 'Newfoundland and Labrador', yt: 'Yukon', nt: 'Northwest Territories', nu: 'Nunavut'
};

// Accents folded on the database side, so French names and card text match the
// unaccented words the tool sends. Both strings are the same length.
const ACCENTED = 'àâäáãéèêëíìîïóòôöõúùûüçñ';
const PLAIN = 'aaaaaeeeeiiiiooooouuuucn';
/** SQL: fold, lowercase, non-alphanumerics to single spaces — the same as normalize() below. */
const normalizedSql = (expr) => `trim(regexp_replace(translate(lower(${expr}), '${ACCENTED}', '${PLAIN}'), '[^a-z0-9]+', ' ', 'g'))`;

const fold = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '');

/** Accents folded, lowercase, non-alphanumerics to single spaces, trimmed. */
export function normalize(text) {
  return fold(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const LINK_ID = /(?:https?:\/\/)?(?:www\.)?(?:app|admin)\.getgranted\.ai\/grants\/(\d+)/gi;
const ONLY_IDS = /^\s*#?\d+(?:\s*[,;\s]\s*#?\d+)*\s*$/;

/**
 * Grant ids asked for by the query: GG3 grant links anywhere in it, or a query
 * that is nothing but ids ("1856", "#1856", "1856, 1425"). Anything else — "Stream 2",
 * "2026 hiring" — is a keyword search. null when it is not a lookup.
 */
export function idsFromQuery(text) {
  const s = String(text ?? '');
  const fromLinks = [...s.matchAll(LINK_ID)].map(m => Number(m[1]));
  const ids = fromLinks.length ? fromLinks : ONLY_IDS.test(s) ? s.match(/\d+/g).map(Number) : [];
  return ids.length ? [...new Set(ids)].slice(0, MAX_IDS) : null;
}

/**
 * What a keyword query matches and ranks on.
 * @returns {{phrase: string, tokens: string[], numbers: string[]}}
 */
export function queryTerms(text) {
  const phrase = normalize(text);
  const words = phrase ? phrase.split(' ') : [];
  const tokens = [...new Set(words.filter(w => w.length >= 2 && !FILLER.has(w) && !NUMBERISH.test(w)))].slice(0, MAX_TOKENS);
  const numbers = [...new Set(words.filter(w => NUMBERISH.test(w)))];
  return { phrase, tokens, numbers };
}

/** Kept for callers and tests: the words that match and score. */
export const keywordTokens = (text) => queryTerms(text).tokens;

const padded = (s) => ` ${s} `;

/**
 * Rank candidate rows ({id, name_n, last_updated, name_hits, body_hits}).
 * Exact name, then the query as a whole-word phrase in the name, then keyword
 * score, then query numbers present in the name, then newest, then id.
 */
export function rankCandidates(rows, { phrase, numbers }) {
  const tier = (name) => (!phrase ? 0 : name === phrase ? 2 : padded(name).includes(padded(phrase)) ? 1 : 0);
  const numberHits = (name) => numbers.filter(n => padded(name).includes(padded(n))).length;
  return rows
    .map(r => ({
      row: r,
      tier: tier(r.name_n ?? ''),
      score: 2 * Number(r.name_hits ?? 0) + Number(r.body_hits ?? 0),
      nums: numberHits(r.name_n ?? ''),
      updated: r.last_updated ?? ''
    }))
    .sort((a, b) =>
      b.tier - a.tier ||
      b.score - a.score ||
      b.nums - a.nums ||
      (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0) ||
      Number(a.row.id) - Number(b.row.id))
    .map(x => x.row);
}

const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
  .map(x => fold(x).trim())
  .filter(Boolean)
  .slice(0, MAX_FILTER_VALUES);

/** ILIKE patterns: user text is literal (%, _ and \ escaped), wrapped in %…%. */
const patterns = (values) => values.map(v => `%${v.replace(/[\\%_]/g, '\\$&')}%`);

export function expandRegions(values) {
  return list(values).map(v => PROVINCES[v.toLowerCase().replace(/\./g, '')] ?? v);
}

function statusesFor({ status, include_hidden }) {
  const asked = list(status).map(s => s.toLowerCase());
  const includeHidden = include_hidden === true || asked.includes('hide');
  const visible = asked.filter(s => GG3_VISIBLE_STATUSES.includes(s));
  const statuses = visible.length ? visible : ['active'];
  return { statuses: includeHidden ? [...statuses, 'hide'] : statuses, includeHidden };
}

function clampLimit(limit) {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RESULTS;
  return Math.min(n, MAX_RESULTS);
}

/**
 * The candidate query's FROM and match condition, shared by the page and the
 * hidden count. Status and the cheap filters sit inside the subquery, so the
 * card text — the expensive part — is only built for rows that pass them, and
 * only once each (OFFSET 0 keeps the planner from inlining the subquery). Words
 * match at the start of a word: " text" LIKE "% word%".
 */
function buildCandidates(opts, terms) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const inner = [];

  const regions = expandRegions(opts.regions);
  if (regions.length) {
    inner.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE jsonb_typeof(gg.regions) WHEN 'array' THEN gg.regions ELSE '[]'::jsonb END) r
      WHERE r = 'All of Canada' OR r ILIKE ANY(${p(patterns(regions))}::text[]))`);
  }
  const industries = list(opts.industries);
  if (industries.length) {
    inner.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE jsonb_typeof(gg.industries) WHEN 'array' THEN gg.industries ELSE '[]'::jsonb END) i
      WHERE i ILIKE ANY(${p(patterns(industries))}::text[]))`);
  }
  const types = list(opts.grant_types);
  if (types.length) inner.push(`gg.grant_type ILIKE ANY(${p(patterns(types))}::text[])`);
  const funders = list(opts.funders);
  if (funders.length) inner.push(`gg.program_provider ILIKE ANY(${p(patterns(funders))}::text[])`);

  let bodyExpr = `''`;
  let nameHits = '0';
  let bodyHits = '0';
  const matches = [];
  if (terms.tokens.length) {
    bodyExpr = `' ' || ${normalizedSql(`regexp_replace(coalesce((
        SELECT string_agg(e.value, ' ')
          FROM jsonb_each_text(CASE jsonb_typeof(gg.field_content) WHEN 'object' THEN gg.field_content ELSE '{}'::jsonb END) AS e
      ), ''), '<[^>]*>', ' ', 'g')`)}`;
    const t = p(terms.tokens);
    const inName = `(' ' || g.name_n) LIKE '% ' || k || '%'`;
    const inBody = `g.body_n LIKE '% ' || k || '%'`;
    matches.push(`EXISTS (SELECT 1 FROM unnest(${t}::text[]) k WHERE ${inName} OR ${inBody})`);
    nameHits = `(SELECT count(*) FROM unnest(${t}::text[]) k WHERE ${inName})::int`;
    bodyHits = `(SELECT count(*) FROM unnest(${t}::text[]) k WHERE NOT ${inName} AND ${inBody})::int`;
  }
  if (terms.phrase) {
    matches.push(`(' ' || g.name_n || ' ') LIKE '% ' || ${p(terms.phrase)} || ' %'`);
  }

  /** @param {string} statusCondition - a condition on gg.status */
  const fromFor = (statusCondition) => `(
      SELECT gg.id, gg.grant_name, gg.status, gg.last_updated,
             ${normalizedSql(`coalesce(gg.grant_name, '')`)} AS name_n,
             ${bodyExpr} AS body_n
        FROM gg3_grants gg
       WHERE ${[statusCondition, ...inner].join('\n         AND ')}
      OFFSET 0
    ) g`;

  const where = matches.length ? `(${matches.join('\n         OR ')})` : 'TRUE';
  return { fromFor, where, params, nameHits, bodyHits };
}

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** First ~240 characters of card prose, tags stripped, cut at a word. */
export function summarize(html) {
  const text = decode(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (text.length <= SUMMARY_CHARS) return text || null;
  const cut = text.slice(0, SUMMARY_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : SUMMARY_CHARS).trim()}…`;
}

/**
 * Region and industry lists run to 80 entries on "any industry" grants; the
 * first 12 plus a count of the rest keep a 20-result answer readable.
 */
function capped(result, key, values) {
  const all = Array.isArray(values) ? values : [];
  result[key] = all.slice(0, LIST_CAP);
  if (all.length > LIST_CAP) result[`${key}_more`] = all.length - LIST_CAP;
}

function toResult(row) {
  const result = {
    id: row.id,
    name: row.grant_name,
    status: row.status,
    funder: row.program_provider ?? null,
    amount: row.grant_amount ?? null,
    deadline: row.deadline ?? null
  };
  capped(result, 'regions', row.regions);
  capped(result, 'industries', row.industries);
  result.summary = summarize(row.summary_src);
  result.links = { app: `${APP_URL}${row.id}`, admin: `${ADMIN_URL}${row.id}` };
  if (row.gg1_id != null) {
    const gg1Status = row.gg1_active === true ? 'active' : row.gg1_active === false ? 'inactive' : null;
    result.gg1 = { id: row.gg1_id, status: gg1Status };
    result.status_mismatch = gg1Status === null ? null : (gg1Status === 'active') !== (row.status === 'active');
  }
  return result;
}

/** Full rows (with GG1 status) for these ids, in the order given. */
async function details(ids) {
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT g.id, g.grant_name, g.status, g.program_provider, g.grant_amount, g.deadline,
            g.regions, g.industries,
            coalesce(nullif(g.field_content->>'grant_overview_2', ''),
                     nullif(g.field_content->>'program_details_2', ''),
                     nullif(g.field_content->>'grant_criteria_2', ''),
                     g.grant_criteria) AS summary_src,
            l.gg1_id, g1.is_active AS gg1_active
       FROM gg3_grants g
       LEFT JOIN gg1_gg3_links l ON l.gg3_id = g.id
       LEFT JOIN grants g1 ON g1.grant_id = l.gg1_id
      WHERE g.id = ANY($1::int[])`,
    [ids]
  );
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  return ids.map(id => byId.get(Number(id))).filter(Boolean);
}

async function dataAsOf() {
  const { rows } = await query(
    `SELECT finished_at FROM gg3_refresh_runs
      WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1`
  );
  return rows[0]?.finished_at ?? null;
}

const asOfNote = (asOf) => (asOf ? {} : { data_note: 'No successful GG3 refresh recorded yet; the copy may be empty.' });
const asOfText = (asOf) => (asOf ? new Date(asOf).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown');

/** Exactly these grants, any status, hide included. */
async function lookupIds(ids, opts) {
  const [rows, asOf] = [await details(ids), await dataAsOf()];
  const found = new Set(rows.map(r => Number(r.id)));
  const notFound = ids.filter(id => !found.has(id));
  const notes = notFound.map(id => `Grant ${id} is not in GG3 (Oracle's copy as of ${asOfText(asOf)}).`);
  const ignored = ['regions', 'industries', 'grant_types', 'funders', 'status', 'include_hidden']
    .filter(k => opts[k] != null && !(Array.isArray(opts[k]) && opts[k].length === 0));
  if (ignored.length) notes.push(`ID lookup returns the grants asked for at any status; ${ignored.join(', ')} ignored.`);
  const results = rows.map(toResult);
  return {
    success: true,
    mode: 'search',
    lookup: 'id',
    data_as_of: asOf,
    ...asOfNote(asOf),
    total_matches: results.length,
    returned: results.length,
    hidden_matches: null,
    not_found: notFound,
    ...(notes.length ? { note: notes.join(' ') } : {}),
    results
  };
}

/**
 * Matches at the visible statuses the search left out: how many, by status, and
 * the three best-ranked — enough to say "it's there, but inactive" and search again.
 */
function otherStatusMatches(rows, terms) {
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    count: rows.length,
    by_status: byStatus,
    top: rankCandidates(rows, terms).slice(0, OTHER_STATUS_TOP).map(r => ({ id: r.id, name: r.grant_name, status: r.status }))
  };
}

/**
 * Search the GG3 copy.
 * @param {Object} opts - query, regions, industries, grant_types, funders, status, include_hidden, limit
 */
export async function searchGrantData(opts = {}) {
  const ids = idsFromQuery(opts.query);
  if (ids) return lookupIds(ids, opts);

  const { statuses, includeHidden } = statusesFor(opts);
  const limit = clampLimit(opts.limit);
  const terms = queryTerms(opts.query);
  const c = buildCandidates(opts, terms);

  // One scan covers the asked statuses and the visible ones left out, so a grant
  // that exists at another status is reported instead of looking absent. Hidden
  // grants stay out of it: they are counted only in hidden_matches.
  const otherStatuses = GG3_VISIBLE_STATUSES.filter(s => !statuses.includes(s));
  const candidateParams = [...c.params];
  const statusParam = `$${candidateParams.push([...statuses, ...otherStatuses])}`;
  const candidates = await query(
    `SELECT g.id, g.grant_name, g.status, g.name_n, g.last_updated,
            ${c.nameHits} AS name_hits,
            ${c.bodyHits} AS body_hits
       FROM ${c.fromFor(`gg.status = ANY(${statusParam}::text[])`)}
      WHERE ${c.where}`,
    candidateParams
  );
  const asked = candidates.rows.filter(r => statuses.includes(r.status));
  const others = candidates.rows.filter(r => otherStatuses.includes(r.status));

  const ranked = rankCandidates(asked, terms);
  const rows = await details(ranked.slice(0, limit).map(r => Number(r.id)));

  let hiddenMatches = null;
  if (!includeHidden) {
    const hidden = await query(
      `SELECT count(*)::int AS n FROM ${c.fromFor(`gg.status = 'hide'`)}
        WHERE ${c.where}`,
      c.params
    );
    hiddenMatches = Number(hidden.rows[0]?.n ?? 0);
  }

  const asOf = await dataAsOf();
  const results = rows.map(toResult);
  return {
    success: true,
    mode: 'search',
    data_as_of: asOf,
    ...asOfNote(asOf),
    statuses,
    total_matches: asked.length,
    returned: results.length,
    hidden_matches: hiddenMatches,
    ...(otherStatuses.length ? { other_status_matches: otherStatusMatches(others, terms) } : {}),
    results
  };
}

/** The tool entry point: dispatch on mode. */
export async function runGrantData(input = {}) {
  switch (input.mode) {
    case 'search':
      return searchGrantData(input);
    default:
      return { success: false, error: `Unknown grant_data mode "${input.mode ?? ''}". Available: search.` };
  }
}
