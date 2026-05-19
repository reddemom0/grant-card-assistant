/**
 * Federal Grants Tools — query the Government of Canada proactive disclosure
 * dataset (proactive_disclosure_grants, ~1.26M rows) via two tools:
 *
 *   searchFederalGrantsAggregate(input)  — group + roll up; "what's the trend"
 *   searchFederalGrantsRecords(input)    — list agreements; "show me actual recipients"
 *
 * Schemas defined in src/tools/definitions.js (ORACLE_TOOLS array).
 *
 * --- Dedicated-client pattern (important) ---
 *
 * These tools intentionally bypass the shared pool from
 * src/database/connection.js:18 (which sets statement_timeout: 30000).
 * Aggregate queries over 1.26M rows can exceed 30s, particularly on the
 * latest_view fallback path (trigram description search, NAICS resolution,
 * having_distinct). Each call opens its own short-lived pg.Client with a 60s
 * statement_timeout — bounded so runaway queries still fail fast, but generous
 * enough to let the matview-backed paths complete comfortably (sub-second).
 *
 * --- Source routing ---
 *
 *   pdg_program_yearly      pre-aggregated matview, ~thousands of rows. Used
 *                           when group_by + filters + metrics all fit its shape
 *                           (program/department/fiscal_year/province/recipient_type).
 *   pdg_latest_amendments   view exposing one row per ref_number (latest
 *                           amendment). Fallback for shapes the matview can't
 *                           serve (naics, riding, city, description keyword,
 *                           having_distinct, p90_value, fiscal_quarter,
 *                           min_value/max_value, agreement_type, recipient_business_number).
 *   proactive_disclosure_grants  raw table. Records mode only, and only when
 *                           include_amendments=true (audit-trail queries).
 *
 * --- Hard rules ---
 *
 * - Parameterized SQL only. No interpolation of user input.
 * - Whitelist every enum value before it touches SQL.
 * - Hard-cap limit (aggregate 100, records 200) regardless of model input.
 * - Always return { success, ... } / { success:false, error }; never throw.
 */

import pg from 'pg';

// ============================================================================
// LIMITS + WHITELISTS
// ============================================================================

const AGG_LIMIT_MAX = 100;
const REC_LIMIT_MAX = 200;
const STMT_TIMEOUT_MS = 60_000;

const GROUP_BY_DIMS = new Set([
  'program', 'department', 'province', 'recipient_type',
  'naics_industry', 'fiscal_year', 'fiscal_quarter', 'riding',
  'recipient_business_number',
]);

const METRICS = new Set([
  'count', 'total_value', 'avg_value', 'median_value', 'yoy_growth', 'p90_value',
]);

const RECIPIENT_TYPES = new Set(['F', 'N', 'A', 'S', 'P', 'G', 'I', 'O']);
const AGREEMENT_TYPES = new Set(['G', 'C', 'O']);
const HAVING_DISTINCT_FIELDS = new Set(['program', 'department']);
const RECORDS_SORT_BY = new Set([
  'agreement_value_desc', 'agreement_value_asc',
  'start_date_desc', 'start_date_asc',
]);

// Dimensions the matview supports as both group_by and filter keys
const MATVIEW_DIMS = new Set([
  'program', 'department', 'fiscal_year', 'province', 'recipient_type',
]);

// Metrics computable from the matview's pre-aggregated columns
const MATVIEW_METRICS = new Set([
  'count', 'total_value', 'avg_value', 'median_value', 'yoy_growth',
]);

// Filter keys the matview path can serve. Anything outside this set forces fallback.
const MATVIEW_FILTERS = new Set([
  'program_name', 'department', 'province', 'recipient_type', 'date_range',
]);

// ============================================================================
// CLIENT
// ============================================================================

async function withDedicatedClient(fn) {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    return { success: false, error: 'DATABASE_URL not configured' };
  }

  // SSL config mirrors src/database/connection.js:34-38
  const client = new pg.Client({
    connectionString: dbUrl,
    statement_timeout: STMT_TIMEOUT_MS,
    ssl: dbUrl.includes('neon.tech')
      || dbUrl.includes('railway.app')
      || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  });

  try {
    await client.connect();
    return await fn(client);
  } finally {
    try { await client.end(); } catch { /* swallow close errors */ }
  }
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/** Throws on unknown enum value. */
function assertEnum(value, allowed, fieldName) {
  if (value == null) return;
  if (!allowed.has(value)) {
    throw new Error(
      `Invalid ${fieldName}: ${JSON.stringify(value)}. Allowed: ${[...allowed].join(', ')}`
    );
  }
}

function clampLimit(value, max) {
  if (value == null) return Math.min(25, max);
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return Math.min(25, max);
  return Math.min(Math.floor(n), max);
}

function parseDateRange(dr) {
  if (!dr) return null;
  if (dr.lookback_months != null && (dr.start || dr.end)) {
    throw new Error('date_range: lookback_months is mutually exclusive with start/end');
  }
  if (dr.lookback_months != null) {
    const months = Number(dr.lookback_months);
    if (!Number.isFinite(months) || months <= 0) {
      throw new Error('date_range.lookback_months must be a positive number');
    }
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - months);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
  return { start: dr.start || null, end: dr.end || null };
}

// ============================================================================
// NAICS RESOLUTION
// ============================================================================

/**
 * Resolve a NAICS industry label substring to a list of { code, length }.
 * Returns [] if no labels match (caller should surface the no-match as an error).
 */
async function resolveNaicsIndustry(client, label) {
  const r = await client.query(
    `SELECT code, length FROM naics_labels WHERE label_en ILIKE $1 ORDER BY length, code`,
    [`%${label}%`]
  );
  return r.rows;
}

// ============================================================================
// FILTER BUILDER (shared by aggregate + records)
// ============================================================================

/**
 * Build a WHERE clause from filters + date_range. Returns { sql, params }.
 * `client` is needed only when filters include `naics_industry` (requires lookup).
 *
 * `allowedKeys` whitelists which filter keys this path supports; unknown filter
 * KEYS are silently ignored (forward-compatible); unknown filter VALUES (enums)
 * throw — this asymmetry is intentional and confirmed in the plan.
 */
async function buildWhere(client, filters, dateRange, allowedKeys, params, opts = {}) {
  const conditions = [];
  if (!filters) filters = {};

  // Date column varies by source: latest_view/raw have agreement_start_date,
  // matview has `year` (DATE_TRUNC'd). Caller passes opts.dateColumn = 'year'
  // for the matview path and we truncate start/end to year boundaries so the
  // semantics line up.
  const dateColumn = opts.dateColumn || 'agreement_start_date';
  const truncToYear = dateColumn === 'year';
  const yearOf = (iso) => `${iso.slice(0, 4)}-01-01`;

  if (dateRange?.start) {
    params.push(truncToYear ? yearOf(dateRange.start) : dateRange.start);
    conditions.push(`${dateColumn} >= $${params.length}`);
  }
  if (dateRange?.end) {
    params.push(truncToYear ? yearOf(dateRange.end) : dateRange.end);
    conditions.push(`${dateColumn} <= $${params.length}`);
  }

  for (const [key, raw] of Object.entries(filters)) {
    if (raw == null || raw === '') continue;
    if (!allowedKeys.has(key)) continue; // forward-compat: unknown keys ignored

    switch (key) {
      case 'program_name':
        params.push(`%${raw}%`);
        conditions.push(`prog_name_en ILIKE $${params.length}`);
        break;
      case 'department':
        params.push(`%${raw}%`);
        conditions.push(`owner_org_title ILIKE $${params.length}`);
        break;
      case 'province':
        params.push(String(raw).toUpperCase());
        conditions.push(`recipient_province = $${params.length}`);
        break;
      case 'recipient_type':
        assertEnum(raw, RECIPIENT_TYPES, 'recipient_type');
        params.push(raw);
        conditions.push(`recipient_type = $${params.length}`);
        break;
      case 'agreement_type':
        assertEnum(raw, AGREEMENT_TYPES, 'agreement_type');
        params.push(raw);
        conditions.push(`agreement_type = $${params.length}`);
        break;
      case 'naics_industry': {
        if (!client) throw new Error('naics_industry filter requires client (internal bug)');
        const codes = await resolveNaicsIndustry(client, String(raw));
        if (codes.length === 0) {
          throw new Error(`naics_industry "${raw}" matched no NAICS labels`);
        }
        // longest-prefix-match: OR across distinct code lengths
        const byLength = new Map();
        for (const { code, length } of codes) {
          if (!byLength.has(length)) byLength.set(length, []);
          byLength.get(length).push(code);
        }
        const orParts = [];
        for (const [length, codeList] of byLength) {
          params.push(codeList);
          orParts.push(`LEFT(naics_identifier, ${Number(length)}) = ANY($${params.length}::text[])`);
        }
        conditions.push(`(${orParts.join(' OR ')})`);
        break;
      }
      case 'naics_prefix': {
        const prefix = String(raw).trim();
        if (!/^\d{1,6}$/.test(prefix)) {
          throw new Error(`naics_prefix must be a 1-6 digit numeric string; got "${raw}"`);
        }
        params.push(prefix + '%');
        conditions.push(`naics_identifier LIKE $${params.length}`);
        break;
      }
      case 'riding_number':
        params.push(String(raw));
        conditions.push(`federal_riding_number = $${params.length}`);
        break;
      case 'city':
        params.push(`%${raw}%`);
        conditions.push(`recipient_city ILIKE $${params.length}`);
        break;
      case 'min_value':
        params.push(Number(raw));
        conditions.push(`agreement_value >= $${params.length}`);
        break;
      case 'max_value':
        params.push(Number(raw));
        conditions.push(`agreement_value <= $${params.length}`);
        break;
      case 'description_keyword':
        params.push(String(raw));
        conditions.push(`description_en % $${params.length}`);
        break;
      case 'recipient_name_query':
        params.push(String(raw));
        conditions.push(`(recipient_legal_name % $${params.length} OR recipient_operating_name % $${params.length})`);
        break;
      case 'recipient_business_number':
        params.push(String(raw));
        conditions.push(`recipient_business_number = $${params.length}`);
        break;
      default:
        // unreachable given allowedKeys gate above
        break;
    }
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

// ============================================================================
// AGGREGATE TOOL
// ============================================================================

const LATEST_VIEW_FILTER_KEYS = new Set([
  'program_name', 'department', 'province', 'recipient_type', 'agreement_type',
  'naics_industry', 'naics_prefix', 'riding_number', 'city',
  'min_value', 'max_value', 'description_keyword',
  'recipient_business_number',
]);

/** Decide between matview and latest_view based on the query shape. */
function pickAggregateSource({ group_by, metrics, filters, having_distinct }) {
  if (having_distinct) return 'latest_view';
  for (const dim of group_by) {
    if (!MATVIEW_DIMS.has(dim)) return 'latest_view';
  }
  for (const m of metrics) {
    if (!MATVIEW_METRICS.has(m)) return 'latest_view';
  }
  if (filters) {
    for (const key of Object.keys(filters)) {
      if (filters[key] == null || filters[key] === '') continue;
      if (!MATVIEW_FILTERS.has(key)) return 'latest_view';
    }
  }
  return 'matview';
}

/** Map a group_by dimension to (a) SQL expression and (b) result key name. */
function groupExprAndAlias(dim, source) {
  switch (dim) {
    case 'program':
      return { expr: 'prog_name_en', alias: 'program' };
    case 'department':
      return { expr: 'owner_org_title', alias: 'department' };
    case 'province':
      return { expr: 'recipient_province', alias: 'province' };
    case 'recipient_type':
      return { expr: 'recipient_type', alias: 'recipient_type' };
    case 'fiscal_year':
      return source === 'matview'
        ? { expr: 'year', alias: 'year' }
        : { expr: `DATE_TRUNC('year', agreement_start_date)::DATE`, alias: 'year' };
    case 'fiscal_quarter':
      return { expr: `DATE_TRUNC('quarter', agreement_start_date)::DATE`, alias: 'quarter' };
    case 'naics_industry':
      // Aggregate at 2-digit prefix on latest_view
      return { expr: `LEFT(naics_identifier, 2)`, alias: 'naics_prefix' };
    case 'riding':
      return { expr: 'federal_riding_number', alias: 'riding_number' };
    case 'recipient_business_number':
      return { expr: 'recipient_business_number', alias: 'recipient_business_number' };
    default:
      throw new Error(`Unknown group_by: ${dim}`);
  }
}

/** Build the SELECT expressions for the requested metrics. */
function metricExprs(metrics, source) {
  const parts = [];
  for (const m of metrics) {
    switch (m) {
      case 'count':
        parts.push(source === 'matview'
          ? `SUM(agreement_count) AS count`
          : `COUNT(*) AS count`);
        break;
      case 'total_value':
        parts.push(source === 'matview'
          ? `SUM(total_value) AS total_value`
          : `SUM(agreement_value) AS total_value`);
        break;
      case 'avg_value':
        parts.push(source === 'matview'
          // Re-derive average across grouped rows (weighted by agreement_count)
          ? `(SUM(total_value) / NULLIF(SUM(agreement_count), 0)) AS avg_value`
          : `AVG(agreement_value) AS avg_value`);
        break;
      case 'median_value':
        // PERCENTILE_CONT cannot operate on pre-aggregated medians; on the
        // matview path the median is approximate (per-bucket median averaged).
        parts.push(source === 'matview'
          ? `AVG(median_value) AS median_value`
          : `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY agreement_value) AS median_value`);
        break;
      case 'p90_value':
        // Only available on latest_view (matview lacks per-agreement distribution)
        parts.push(`PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY agreement_value) AS p90_value`);
        break;
      case 'yoy_growth':
        // Handled in a wrapper query below; emit nothing here.
        break;
      default:
        throw new Error(`Unknown metric: ${m}`);
    }
  }
  return parts;
}

export async function searchFederalGrantsAggregate(input) {
  try {
    const group_by = Array.isArray(input?.group_by) ? input.group_by : [];
    if (group_by.length === 0) {
      return { success: false, error: 'group_by must contain at least one dimension' };
    }
    for (const dim of group_by) assertEnum(dim, GROUP_BY_DIMS, 'group_by');

    const metrics = Array.isArray(input?.metrics) && input.metrics.length > 0
      ? input.metrics
      : ['count', 'total_value'];
    for (const m of metrics) assertEnum(m, METRICS, 'metrics');

    if (metrics.includes('yoy_growth') && group_by.includes('fiscal_year')) {
      return {
        success: false,
        error: 'yoy_growth implies a year-over-year comparison; do not also pass fiscal_year as a group_by',
      };
    }

    const filters = input?.filters || {};

    // Reject both naics_industry and naics_prefix simultaneously — confusing semantic
    if (filters.naics_industry && filters.naics_prefix) {
      return { success: false, error: 'Pass either naics_industry OR naics_prefix, not both' };
    }

    const dateRange = parseDateRange(input?.date_range);
    const limit = clampLimit(input?.limit, AGG_LIMIT_MAX);

    let having_distinct = null;
    if (input?.having_distinct) {
      const { field, min_count } = input.having_distinct;
      assertEnum(field, HAVING_DISTINCT_FIELDS, 'having_distinct.field');
      const n = Number(min_count);
      if (!Number.isFinite(n) || n < 1) {
        return { success: false, error: 'having_distinct.min_count must be a positive integer' };
      }
      having_distinct = { field, min_count: Math.floor(n) };
    }

    const source = pickAggregateSource({ group_by, metrics, filters, having_distinct });
    const sourceTable = source === 'matview' ? 'pdg_program_yearly' : 'pdg_latest_amendments';
    const allowedFilterKeys = source === 'matview' ? MATVIEW_FILTERS : LATEST_VIEW_FILTER_KEYS;

    return await withDedicatedClient(async (client) => {
      const params = [];
      const where = await buildWhere(client, filters, dateRange, allowedFilterKeys, params, {
        dateColumn: source === 'matview' ? 'year' : 'agreement_start_date',
      });

      const groupSpecs = group_by.map((dim) => groupExprAndAlias(dim, source));
      const selectGroup = groupSpecs.map((g) => `${g.expr} AS ${g.alias}`).join(', ');
      const groupByClause = groupSpecs.map((g) => g.expr).join(', ');

      const metricParts = metricExprs(metrics, source);

      // sort_by: default to total_value desc; if user provides a metric name, use it
      const wantsYoY = metrics.includes('yoy_growth');
      const sortMetric = (input?.sort_by && METRICS.has(input.sort_by) && !['yoy_growth'].includes(input.sort_by))
        ? input.sort_by
        : (metricParts.some((p) => p.startsWith('SUM(') || p.includes(' AS total_value')) ? 'total_value' : 'count');

      let havingClause = '';
      if (having_distinct) {
        const havingCol = having_distinct.field === 'program' ? 'prog_name_en' : 'owner_org_title';
        params.push(having_distinct.min_count);
        havingClause = `HAVING COUNT(DISTINCT ${havingCol}) >= $${params.length}`;
      }

      // ----- YoY path: compare last 12 months vs previous 12 months per group -----
      if (wantsYoY) {
        // Pull non-YoY metrics for "current" window; compare to prior window.
        // For simplicity & SQL safety: build two parallel sub-aggregates joined on group cols.
        // Override the date_range to two windows.
        const now = new Date();
        const oneYearAgo = new Date(now); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const twoYearsAgo = new Date(now); twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const iso = (d) => d.toISOString().slice(0, 10);

        // Rebuild WHERE without date_range for the inner subqueries
        const baseParams = [];
        const baseWhere = await buildWhere(client, filters, null, allowedFilterKeys, baseParams);

        // Append current/prior window date params
        baseParams.push(iso(oneYearAgo)); const pCurStart = baseParams.length;
        baseParams.push(iso(now));         const pCurEnd = baseParams.length;
        baseParams.push(iso(twoYearsAgo)); const pPriorStart = baseParams.length;
        baseParams.push(iso(oneYearAgo));  const pPriorEnd = baseParams.length;

        const inner = (startIdx, endIdx) => `
          SELECT ${selectGroup}, SUM(${source === 'matview' ? 'total_value' : 'agreement_value'}) AS window_total
          FROM ${sourceTable}
          ${baseWhere.sql ? baseWhere.sql + ' AND ' : 'WHERE '} agreement_start_date >= $${startIdx} AND agreement_start_date < $${endIdx}
          GROUP BY ${groupByClause}
        `;

        // Matview path doesn't have agreement_start_date — fall back to latest_view for yoy
        if (source === 'matview') {
          return {
            success: false,
            error: 'yoy_growth requires latest_view path; remove matview-incompatible filters/dims (internal: yoy should never route to matview)',
          };
        }

        const sql = `
          WITH cur AS (${inner(pCurStart, pCurEnd)}),
               prior AS (${inner(pPriorStart, pPriorEnd)})
          SELECT
            ${groupSpecs.map((g) => `COALESCE(cur.${g.alias}, prior.${g.alias}) AS ${g.alias}`).join(', ')},
            COALESCE(cur.window_total, 0) AS total_value,
            COALESCE(prior.window_total, 0) AS prior_total_value,
            CASE
              WHEN COALESCE(prior.window_total, 0) = 0 THEN NULL
              ELSE (COALESCE(cur.window_total, 0) - prior.window_total) / NULLIF(prior.window_total, 0)
            END AS yoy_growth
          FROM cur FULL OUTER JOIN prior USING (${groupSpecs.map((g) => g.alias).join(', ')})
          ORDER BY yoy_growth DESC NULLS LAST
          LIMIT ${Number(limit)}
        `;
        const r = await client.query(sql, baseParams);
        return {
          success: true,
          query_path: 'latest_view',
          mode: 'yoy_growth',
          group_by,
          row_count: r.rows.length,
          groups: r.rows,
        };
      }

      // ----- Standard aggregate path -----
      if (metricParts.length === 0) {
        return { success: false, error: 'No queryable metrics selected' };
      }

      const orderBy = `${sortMetric} DESC NULLS LAST`;
      params.push(Number(limit));
      const limitParam = `$${params.length}`;

      const sql = `
        SELECT ${selectGroup}, ${metricParts.join(', ')}
        FROM ${sourceTable}
        ${where.sql}
        GROUP BY ${groupByClause}
        ${havingClause}
        ORDER BY ${orderBy}
        LIMIT ${limitParam}
      `;

      const r = await client.query(sql, params);
      return {
        success: true,
        query_path: source,
        group_by,
        metrics,
        row_count: r.rows.length,
        groups: r.rows,
      };
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================================
// RECORDS TOOL
// ============================================================================

const RECORDS_FILTER_KEYS = new Set([
  'recipient_name_query', 'recipient_business_number',
  'program_name', 'department', 'province', 'city', 'riding_number',
  'recipient_type', 'naics_industry', 'naics_prefix',
  'min_value', 'max_value', 'description_keyword', 'agreement_type',
]);

const RECORD_PROJECTION = [
  'ref_number', 'amendment_number', 'recipient_legal_name', 'recipient_operating_name',
  'recipient_province', 'recipient_city', 'prog_name_en', 'owner_org_title',
  'agreement_value', 'agreement_start_date', 'agreement_end_date',
  'recipient_type', 'agreement_type', 'naics_identifier', 'federal_riding_name_en',
].join(', ');

export async function searchFederalGrantsRecords(input) {
  try {
    const filters = input?.filters || {};
    if (filters.naics_industry && filters.naics_prefix) {
      return { success: false, error: 'Pass either naics_industry OR naics_prefix, not both' };
    }

    const dateRange = parseDateRange(input?.date_range);
    const limit = clampLimit(input?.limit, REC_LIMIT_MAX);
    const includeAmendments = input?.include_amendments === true;
    const sortBy = input?.sort_by || 'agreement_value_desc';
    assertEnum(sortBy, RECORDS_SORT_BY, 'sort_by');

    const sortClause = (() => {
      switch (sortBy) {
        case 'agreement_value_desc': return 'agreement_value DESC NULLS LAST';
        case 'agreement_value_asc':  return 'agreement_value ASC NULLS LAST';
        case 'start_date_desc':      return 'agreement_start_date DESC NULLS LAST';
        case 'start_date_asc':       return 'agreement_start_date ASC NULLS LAST';
      }
    })();

    const sourceTable = includeAmendments ? 'proactive_disclosure_grants' : 'pdg_latest_amendments';

    return await withDedicatedClient(async (client) => {
      const params = [];
      const where = await buildWhere(client, filters, dateRange, RECORDS_FILTER_KEYS, params);
      params.push(Number(limit));
      const limitParam = `$${params.length}`;

      const sql = `
        SELECT ${RECORD_PROJECTION}
        FROM ${sourceTable}
        ${where.sql}
        ORDER BY ${sortClause}
        LIMIT ${limitParam}
      `;

      const r = await client.query(sql, params);
      return {
        success: true,
        query_path: includeAmendments ? 'raw_table' : 'latest_view',
        count: r.rows.length,
        records: r.rows,
      };
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}
