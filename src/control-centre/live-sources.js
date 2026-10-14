/**
 * Control Centre live-source rules (app DB, ai-api-backend)
 *
 * One function per question, so pages never re-derive "which grant is live"
 * or "what does the engine see for this company". Each takes an injectable
 * `query` (default: the read-only appQuery) and shapes rows in an exported
 * pure function so tests run on fixtures.
 *
 * Docs: docs/control-centre.md
 */

import { appQuery } from './db.js';

/**
 * Where the matching engine reads a company's industries and regions from.
 *
 *   'company_metadata'  company_metadata.primary_industries / .provinces
 *                       (agreed rule; ai-api-backend main)
 *   'company_tables'    company_industries / company_regions first, falling
 *                       back to the metadata columns when empty
 *                       (ai-api-backend origin/release/1.2.2, toAiProfile)
 *
 * Switch to 'company_tables' once release/1.2.2 is confirmed live in
 * production. Whichever source is not the engine's is reported as
 * also_on_record, with a differs flag.
 */
export const ENGINE_PROFILE_SOURCE = 'company_metadata';

// ---------------------------------------------------------------------------
// companyProfile
// ---------------------------------------------------------------------------

const METADATA_SQL = `
  SELECT company_id, primary_industries, provinces, headquarters_province,
         employee_range, num_employees, recurring_revenue_range, annual_revenue
    FROM company_metadata
   WHERE company_id = $1
   ORDER BY id DESC
   LIMIT 1`;

const REGIONS_SQL = `
  SELECT r.name
    FROM company_regions cr
    JOIN regions r ON r.id = cr.region_id
   WHERE cr.company_id = $1
   ORDER BY r.name`;

const INDUSTRIES_SQL = `
  SELECT i.name
    FROM company_industries ci
    JOIN industries i ON i.id = ci.industry_id
   WHERE ci.company_id = $1
   ORDER BY i.name`;

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

function cleanList(values) {
  return [...new Set((values || [])
    .map((v) => (typeof v === 'string' ? v.trim() : v))
    .filter((v) => typeof v === 'string' && v.length > 0))];
}

/** company_metadata.provinces is a comma-separated varchar ("BC, Alberta"). */
export function splitProvinces(value) {
  if (Array.isArray(value)) return cleanList(value);
  if (typeof value !== 'string') return [];
  return cleanList(value.split(','));
}

function sameSet(a, b) {
  const norm = (xs) => new Set(xs.map((x) => x.toLowerCase()));
  const sa = norm(a);
  const sb = norm(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/**
 * Pure: metadata row + region/industry names → the profile as the engine
 * sees it, what else is on record, and which engine fields are empty.
 *
 * Size and revenue follow the engine's fallback order:
 * employee_range ?? num_employees, recurring_revenue_range ?? annual_revenue.
 */
export function shapeCompanyProfile(companyId, metadata, regionNames, industryNames, source = ENGINE_PROFILE_SOURCE) {
  if (!metadata) return { company_id: companyId, found: false, source };

  const metaIndustries = cleanList(Array.isArray(metadata.primary_industries) ? metadata.primary_industries : []);
  const metaProvinces = splitProvinces(metadata.provinces);
  const tableIndustries = cleanList(industryNames);
  const tableRegions = cleanList(regionNames);

  let industries, provinces, otherIndustries, otherRegions;
  if (source === 'company_tables') {
    industries = tableIndustries.length ? tableIndustries : metaIndustries;
    provinces = tableRegions.length ? tableRegions : metaProvinces;
    otherIndustries = metaIndustries;
    otherRegions = metaProvinces;
  } else {
    industries = metaIndustries;
    provinces = metaProvinces;
    otherIndustries = tableIndustries;
    otherRegions = tableRegions;
  }

  const employeeCount = !isBlank(metadata.employee_range) ? metadata.employee_range
    : (metadata.num_employees ?? null);
  const annualRevenue = !isBlank(metadata.recurring_revenue_range) ? metadata.recurring_revenue_range
    : (isBlank(metadata.annual_revenue) ? null : metadata.annual_revenue);

  const engine = {
    industries,
    provinces,
    employee_count: employeeCount,
    annual_revenue: annualRevenue,
    raw: {
      employee_range: metadata.employee_range ?? null,
      num_employees: metadata.num_employees ?? null,
      recurring_revenue_range: metadata.recurring_revenue_range ?? null,
      annual_revenue: metadata.annual_revenue ?? null
    }
  };

  const empty_for_engine = [];
  if (industries.length === 0) empty_for_engine.push('industries');
  if (provinces.length === 0) empty_for_engine.push('provinces');
  if (isBlank(employeeCount)) empty_for_engine.push('employee_count');
  if (isBlank(annualRevenue)) empty_for_engine.push('annual_revenue');

  return {
    company_id: companyId,
    found: true,
    source,
    engine,
    also_on_record: {
      industries: otherIndustries,
      regions: otherRegions,
      headquarters_province: isBlank(metadata.headquarters_province) ? null : metadata.headquarters_province
    },
    differs: {
      industries: !sameSet(industries, otherIndustries),
      regions: !sameSet(provinces, otherRegions)
    },
    empty_for_engine
  };
}

/**
 * The company's profile as the matching engine sees it (per
 * ENGINE_PROFILE_SOURCE), plus the other source as also_on_record and the
 * engine fields that are empty.
 */
export async function companyProfile(companyId, { query = appQuery, source = ENGINE_PROFILE_SOURCE } = {}) {
  const [meta, regions, industries] = await Promise.all([
    query(METADATA_SQL, [companyId]),
    query(REGIONS_SQL, [companyId]),
    query(INDUSTRIES_SQL, [companyId])
  ]);
  return shapeCompanyProfile(
    companyId,
    meta.rows[0] || null,
    regions.rows.map((r) => r.name),
    industries.rows.map((r) => r.name),
    source
  );
}

// ---------------------------------------------------------------------------
// liveGrant / liveGrants
// ---------------------------------------------------------------------------

/*
 * A grant is live when it is the version grant_roots.live_version points at,
 * is not soft-deleted, and its status is 'active' in the grant scope
 * (statuses.scope_id = 1; scope 2 is applications). Root ids are what
 * watchlists and the engine refer to; grants.id is a version.
 */
const LIVE_GRANT_FROM = `
    FROM grant_roots gr
    JOIN grants g   ON g.id = gr.live_version
    JOIN statuses s ON s.id = g.status_id
   WHERE g.deleted_at IS NULL
     AND s.label = 'active'
     AND s.scope_id = 1`;

const LIVE_GRANT_COLUMNS = `
  SELECT gr.id AS root_id, g.id, g.title, g.grantor, g.type, g.value, g.deadline,
         s.label AS status, g.version_number, g.updated_at,
         g.minimum_company_size, g.maximum_company_size,
         g.minimum_company_revenue, g.maximum_company_revenue`;

/** Pure: one row → a live grant record. */
export function shapeLiveGrant(row) {
  if (!row) return null;
  return {
    root_id: row.root_id,
    id: row.id,
    title: row.title,
    grantor: row.grantor ?? null,
    type: row.type ?? null,
    value: row.value ?? null,
    deadline: row.deadline ?? null,
    status: row.status,
    version_number: row.version_number ?? null,
    updated_at: row.updated_at ?? null,
    minimum_company_size: row.minimum_company_size ?? null,
    maximum_company_size: row.maximum_company_size ?? null,
    minimum_company_revenue: row.minimum_company_revenue ?? null,
    maximum_company_revenue: row.maximum_company_revenue ?? null
  };
}

/** The live version of one grant root, or null when it has none. */
export async function liveGrant(rootId, { query = appQuery } = {}) {
  const { rows } = await query(`${LIVE_GRANT_COLUMNS}${LIVE_GRANT_FROM} AND gr.id = $1`, [rootId]);
  return shapeLiveGrant(rows[0]);
}

/** Every live grant, ordered by root id. */
export async function liveGrants({ query = appQuery } = {}) {
  const { rows } = await query(`${LIVE_GRANT_COLUMNS}${LIVE_GRANT_FROM} ORDER BY gr.id`);
  return rows.map(shapeLiveGrant);
}

// ---------------------------------------------------------------------------
// watchlist
// ---------------------------------------------------------------------------

/*
 * A company's watchlists: watchlists + watchlist_grants, both excluding
 * soft-deleted rows. watchlist_grants.grant_id is a grant_roots.id (FK), so
 * each entry is joined to its live version (same rule as liveGrant) and
 * flagged is_live. company_watchlist / company_watchlist_grants are a separate,
 * unused pair and are not read.
 */
const WATCHLIST_SQL = `
  SELECT w.id AS watchlist_id, w.name, w.user_id,
         wg.grant_id AS root_id, wg.created_at AS added_at,
         lg.id AS live_grant_id, lg.title
    FROM watchlists w
    LEFT JOIN watchlist_grants wg
      ON wg.watchlist_id = w.id AND wg.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT g.id, g.title${LIVE_GRANT_FROM}
         AND gr.id = wg.grant_id
    ) lg ON TRUE
   WHERE w.company_id = $1
     AND w.deleted_at IS NULL
   ORDER BY w.id, wg.created_at`;

/** Pure: flat rows → [{watchlist_id, name, user_id, grants: [...]}]. */
export function shapeWatchlists(rows) {
  const lists = new Map();
  for (const row of rows) {
    let list = lists.get(row.watchlist_id);
    if (!list) {
      list = { watchlist_id: row.watchlist_id, name: row.name, user_id: row.user_id ?? null, grants: [] };
      lists.set(row.watchlist_id, list);
    }
    if (row.root_id != null) {
      list.grants.push({
        root_id: row.root_id,
        added_at: row.added_at ?? null,
        is_live: row.live_grant_id != null,
        live_grant_id: row.live_grant_id ?? null,
        title: row.title ?? null
      });
    }
  }
  return [...lists.values()];
}

/** A company's live watchlists and the grants on them. */
export async function watchlist(companyId, { query = appQuery } = {}) {
  const { rows } = await query(WATCHLIST_SQL, [companyId]);
  return shapeWatchlists(rows);
}
