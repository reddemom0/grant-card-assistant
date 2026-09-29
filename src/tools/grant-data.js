/**
 * grant_data — Oracle's grant-data tool over its GG3 copy
 *
 * One tool with a required `mode`, so later modes (counts, card checks, bulk
 * search, tag audit, compare) arrive as enum values, not new tools. Only
 * "search" exists today.
 *
 * search reads gg3_grants (the hourly copy, migration 038), never GG3 itself:
 *   - keywords match grant names and card text (field_content values, HTML
 *     stripped, accents folded); any keyword matches, more matches and name
 *     matches rank first — the same OR-and-rank behaviour as the GG1 search
 *   - filters: regions (codes expanded; All-of-Canada grants always included),
 *     industries, grant types, funders — OR inside a filter, AND across
 *   - status defaults to active; GG3 "hide" grants only with include_hidden,
 *     and when they are left out their match count comes back as hidden_matches
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
const MAX_FILTER_VALUES = 10;
const SUMMARY_CHARS = 240;
const LIST_CAP = 12;
export const GG3_VISIBLE_STATUSES = ['active', 'inactive', 'archived', 'draft'];
const APP_URL = 'https://app.getgranted.ai/grants/';
const ADMIN_URL = 'https://admin.getgranted.ai/grants/';

const FILLER = new Set(['the', 'and', 'for', 'of', 'in', 'to', 'an', 'or', 'with', 'grant', 'grants', 'program', 'programs', 'programme', 'programmes']);

const PROVINCES = {
  bc: 'British Columbia', ab: 'Alberta', sk: 'Saskatchewan', mb: 'Manitoba',
  on: 'Ontario', qc: 'Quebec', nb: 'New Brunswick', ns: 'Nova Scotia',
  pe: 'Prince Edward Island', pei: 'Prince Edward Island',
  nl: 'Newfoundland and Labrador', yt: 'Yukon', nt: 'Northwest Territories', nu: 'Nunavut'
};

// Accents folded on the database side, so French card text matches the
// unaccented keywords the tool sends. Both strings are the same length.
const ACCENTED = 'àâäáãéèêëíìîïóòôöõúùûüçñ';
const PLAIN = 'aaaaaeeeeiiiiooooouuuucn';

const fold = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '');

/** Keyword tokens: folded, lowercase, [a-z0-9] only, ≥2 chars, filler dropped unless nothing else is left. */
export function keywordTokens(text) {
  const all = [...new Set(fold(text).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2))];
  const meaningful = all.filter(t => !FILLER.has(t));
  return (meaningful.length ? meaningful : all).slice(0, MAX_TOKENS);
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
 * The shared FROM/WHERE for the page and the hidden count. The status and the
 * cheap filters sit inside the subquery, so the card text — the expensive part —
 * is only built for rows that pass them, and only once each (OFFSET 0 keeps the
 * planner from inlining the subquery and rebuilding it per reference). Keywords
 * are matched outside, on the built text.
 */
function buildFilters(opts) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const inner = [];
  const outer = [];

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

  const tokens = keywordTokens(opts.query);
  let score = null;   // no keywords: order by recency alone (a bare "0" would be read as a column position)
  let bodyExpr = `''`;
  if (tokens.length) {
    bodyExpr = `translate(lower(regexp_replace(coalesce((
        SELECT string_agg(e.value, ' ')
          FROM jsonb_each_text(CASE jsonb_typeof(gg.field_content) WHEN 'object' THEN gg.field_content ELSE '{}'::jsonb END) AS e
      ), ''), '<[^>]*>', ' ', 'g')), '${ACCENTED}', '${PLAIN}')`;
    const t = p(tokens);
    outer.push(`EXISTS (SELECT 1 FROM unnest(${t}::text[]) k WHERE g.name_f LIKE '%' || k || '%' OR g.body_f LIKE '%' || k || '%')`);
    score = `(SELECT coalesce(sum(CASE WHEN g.name_f LIKE '%' || k || '%' THEN 2 WHEN g.body_f LIKE '%' || k || '%' THEN 1 ELSE 0 END), 0) FROM unnest(${t}::text[]) k)`;
  }

  /** @param {string} statusCondition - a condition on gg.status */
  const fromFor = (statusCondition) => `(
      SELECT gg.*,
             translate(lower(coalesce(gg.grant_name, '')), '${ACCENTED}', '${PLAIN}') AS name_f,
             ${bodyExpr} AS body_f
        FROM gg3_grants gg
       WHERE ${[statusCondition, ...inner].join('\n         AND ')}
      OFFSET 0
    ) g`;

  return { fromFor, outer, params, score, tokens };
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

async function dataAsOf() {
  const { rows } = await query(
    `SELECT finished_at FROM gg3_refresh_runs
      WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1`
  );
  return rows[0]?.finished_at ?? null;
}

/**
 * Search the GG3 copy.
 * @param {Object} opts - query, regions, industries, grant_types, funders, status, include_hidden, limit
 */
export async function searchGrantData(opts = {}) {
  const { statuses, includeHidden } = statusesFor(opts);
  const limit = clampLimit(opts.limit);
  const f = buildFilters(opts);

  const outerWhere = f.outer.length ? f.outer.join('\n        AND ') : 'TRUE';
  const pageParams = [...f.params];
  const pp = (v) => { pageParams.push(v); return `$${pageParams.length}`; };
  const page = await query(
    `SELECT g.id, g.grant_name, g.status, g.program_provider, g.grant_amount, g.deadline,
            g.regions, g.industries,
            coalesce(nullif(g.field_content->>'grant_overview_2', ''),
                     nullif(g.field_content->>'program_details_2', ''),
                     nullif(g.field_content->>'grant_criteria_2', ''),
                     g.grant_criteria) AS summary_src,
            l.gg1_id, g1.is_active AS gg1_active,
            count(*) OVER () AS total_matches
       FROM ${f.fromFor(`gg.status = ANY(${pp(statuses)}::text[])`)}
       LEFT JOIN gg1_gg3_links l ON l.gg3_id = g.id
       LEFT JOIN grants g1 ON g1.grant_id = l.gg1_id
      WHERE ${outerWhere}
      ORDER BY ${f.score ? `${f.score} DESC, ` : ''}g.last_updated DESC NULLS LAST, g.id
      LIMIT ${pp(limit)}`,
    pageParams
  );

  let hiddenMatches = null;
  if (!includeHidden) {
    const hidden = await query(
      `SELECT count(*)::int AS n FROM ${f.fromFor(`gg.status = 'hide'`)}
        WHERE ${outerWhere}`,
      f.params
    );
    hiddenMatches = Number(hidden.rows[0]?.n ?? 0);
  }

  const asOf = await dataAsOf();
  const results = page.rows.map(toResult);
  return {
    success: true,
    mode: 'search',
    data_as_of: asOf,
    ...(asOf ? {} : { data_note: 'No successful GG3 refresh recorded yet; the copy may be empty.' }),
    statuses,
    total_matches: Number(page.rows[0]?.total_matches ?? 0),
    returned: results.length,
    hidden_matches: hiddenMatches,
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
