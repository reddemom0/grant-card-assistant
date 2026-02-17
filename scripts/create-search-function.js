/**
 * Grant Search Function
 *
 * Keyword + filter search with vector similarity ranking when a text query
 * is provided. Results are ordered by relevance (vector score) then recency.
 *
 * Key design decisions:
 * - Filters on currently_accepting = true (not just is_active) to exclude
 *   programs that GetGranted hasn't deactivated but are clearly closed.
 * - Excludes garbage-named grants (Z-COVID, Z-DUPLICATE, DORMANT) automatically.
 * - When a text query is provided, uses pgvector cosine distance for ranking.
 * - Falls back to last_updated DESC when no query/embedding is available.
 */

import pg from 'pg';
import voyageai from 'voyageai';
import { config } from 'dotenv';

config();

const { Pool } = pg;

// Voyage AI client for query embeddings (optional — gracefully degrades)
let voyage = null;
try {
  if (process.env.VOYAGE_API_KEY) {
    voyage = new voyageai.Client(process.env.VOYAGE_API_KEY);
  }
} catch (err) {
  console.warn('⚠️  Voyage AI unavailable, vector ranking disabled:', err.message);
}

/**
 * Embed a query string using Voyage AI
 * Returns null if embeddings are unavailable
 */
async function embedQuery(text) {
  if (!voyage || !text?.trim()) return null;
  try {
    const result = await voyage.embed([text.trim()], { model: 'voyage-2' });
    return result.embeddings[0];
  } catch (err) {
    console.warn('⚠️  Query embedding failed, falling back to keyword ranking:', err.message);
    return null;
  }
}

/**
 * Search grants using keywords, filters, and optional vector similarity ranking
 *
 * @param {Object} opts
 * @param {string[]} opts.keywords      - Keywords searched across name, criteria, type, full text
 * @param {string[]} opts.regions       - Province/territory filter (OR logic)
 * @param {string[]} opts.industries    - Industry filter (OR logic)
 * @param {string[]} opts.grantTypes    - Grant type filter (OR logic)
 * @param {boolean}  opts.includeInactive  - Include excluded/inactive grants (default false)
 * @param {number}   opts.maxResults    - Max results (default 50)
 * @returns {Promise<{total: number, grants: Array}>}
 */
async function searchGrants({
  keywords = [],
  regions = [],
  industries = [],
  grantTypes = [],
  includeInactive = false,
  maxResults = 50
}) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const client = await pool.connect();

    // Embed the keyword query for vector ranking (fire off in parallel with DB query)
    const queryText = keywords.join(' ').trim();
    const embeddingPromise = queryText ? embedQuery(queryText) : Promise.resolve(null);

    // ── Build WHERE clause ────────────────────────────────────────────────────

    let whereClause = 'WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    // Status filter: use currently_accepting when available, fall back to is_active
    // includeInactive bypasses both filters (for admin/debugging use)
    if (!includeInactive) {
      whereClause += `
        AND (
          -- Prefer the derived currently_accepting field (migration 004+)
          CASE WHEN currently_accepting IS NOT NULL
               THEN currently_accepting = true
               ELSE is_active = true
          END
        )`;
    }

    // Keyword search across all relevant text fields
    if (keywords.length > 0) {
      const keywordConditions = keywords.map(keyword => {
        const param = `%${keyword}%`;
        params.push(param, param, param, param, param, param);
        const condition = `(
          grant_name ILIKE $${paramIndex}
          OR grant_type ILIKE $${paramIndex + 1}
          OR grant_criteria ILIKE $${paramIndex + 2}
          OR best_practices ILIKE $${paramIndex + 3}
          OR recently_changed ILIKE $${paramIndex + 4}
          OR full_page_text ILIKE $${paramIndex + 5}
        )`;
        paramIndex += 6;
        return condition;
      });
      whereClause += ` AND (${keywordConditions.join(' AND ')})`;
    }

    // Region filter (OR — match any of the requested regions)
    if (regions.length > 0) {
      const regionConditions = regions.map(region => {
        params.push(`%${region}%`);
        return `regions ILIKE $${paramIndex++}`;
      });
      whereClause += ` AND (regions ILIKE '%All of Canada%' OR ${regionConditions.join(' OR ')})`;
    }

    // Industry filter (OR)
    if (industries.length > 0) {
      const industryConditions = industries.map(industry => {
        params.push(`%${industry}%`);
        return `industries ILIKE $${paramIndex++}`;
      });
      whereClause += ` AND (${industryConditions.join(' OR ')})`;
    }

    // Grant type filter (OR)
    if (grantTypes.length > 0) {
      const typeConditions = grantTypes.map(type => {
        params.push(`%${type}%`);
        return `grant_type ILIKE $${paramIndex++}`;
      });
      whereClause += ` AND (${typeConditions.join(' OR ')})`;
    }

    // ── Wait for embedding ────────────────────────────────────────────────────
    const queryEmbedding = await embeddingPromise;

    // ── Build SELECT + ORDER BY ───────────────────────────────────────────────

    let selectClause;
    let orderByClause;

    if (queryEmbedding) {
      // Vector ranking: cosine distance to query embedding
      // Lower distance = higher similarity; we convert to similarity score for display
      const embeddingLiteral = `'[${queryEmbedding.join(',')}]'::vector`;
      selectClause = `
        SELECT
          grant_id, grant_name, grant_type, grant_amount, url,
          regions, industries, program_provider, deadline,
          max_spend, contribution_percentage, difficulty,
          grant_criteria, best_practices, recently_changed,
          last_updated, is_active, currently_accepting, exclusion_reason,
          CASE
            WHEN embedding IS NOT NULL
            THEN ROUND(CAST((1 - (embedding <=> ${embeddingLiteral})) * 100 AS NUMERIC), 1)
            ELSE NULL
          END AS vector_score
        FROM grants
      `;
      orderByClause = `
        ORDER BY
          -- Grants with embeddings ranked by vector similarity first
          CASE WHEN embedding IS NOT NULL THEN 0 ELSE 1 END ASC,
          -- Then by vector similarity (higher = better)
          CASE WHEN embedding IS NOT NULL THEN (embedding <=> ${embeddingLiteral}) ELSE 1 END ASC,
          -- Recency as tiebreaker
          last_updated DESC NULLS LAST
        LIMIT $${paramIndex}
      `;
    } else {
      // No embedding — pure recency ordering
      selectClause = `
        SELECT
          grant_id, grant_name, grant_type, grant_amount, url,
          regions, industries, program_provider, deadline,
          max_spend, contribution_percentage, difficulty,
          grant_criteria, best_practices, recently_changed,
          last_updated, is_active, currently_accepting, exclusion_reason,
          NULL::NUMERIC AS vector_score
        FROM grants
      `;
      orderByClause = `
        ORDER BY last_updated DESC NULLS LAST
        LIMIT $${paramIndex}
      `;
    }

    params.push(maxResults);

    const fullQuery = `${selectClause} ${whereClause} ${orderByClause}`;

    // ── Execute ───────────────────────────────────────────────────────────────
    const result = await client.query(fullQuery, params);
    client.release();

    const rankMethod = queryEmbedding ? 'vector+recency' : 'recency';
    console.log(`✅ searchGrants: ${result.rows.length} results (ranked by ${rankMethod})`);

    return {
      total: result.rows.length,
      rankMethod,
      grants: result.rows
    };

  } catch (error) {
    console.error('❌ searchGrants error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * Get a single grant by ID
 */
async function getGrantById(grantId) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM grants WHERE grant_id = $1', [grantId]);
    client.release();
    return result.rows[0] || null;
  } catch (error) {
    console.error('getGrantById error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * Get grant database statistics
 */
async function getGrantStats() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();

    const [totalResult, activeResult, inactiveResult, acceptingResult, typeResult, staleness] =
      await Promise.all([
        client.query('SELECT COUNT(*) as count FROM grants'),
        client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = true'),
        client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = false'),
        client.query('SELECT COUNT(*) as count FROM grants WHERE currently_accepting = true'),
        client.query(`
          SELECT TRIM(grant_type) as grant_type, COUNT(*) as count
          FROM grants
          WHERE grant_type IS NOT NULL AND currently_accepting = true
          GROUP BY TRIM(grant_type)
          ORDER BY count DESC
          LIMIT 15
        `),
        client.query(`
          SELECT
            COUNT(*) FILTER (WHERE last_updated >= '2025/01/01') AS updated_2025_plus,
            COUNT(*) FILTER (WHERE last_updated >= '2024/01/01' AND last_updated < '2025/01/01') AS updated_2024,
            COUNT(*) FILTER (WHERE last_updated >= '2022/01/01' AND last_updated < '2024/01/01') AS updated_2022_2023,
            COUNT(*) FILTER (WHERE last_updated < '2022/01/01') AS updated_pre_2022,
            COUNT(*) FILTER (WHERE last_updated IS NULL) AS no_date
          FROM grants
          WHERE currently_accepting = true
        `)
      ]);

    client.release();

    return {
      total: parseInt(totalResult.rows[0].count),
      is_active_true: parseInt(activeResult.rows[0].count),
      is_active_false: parseInt(inactiveResult.rows[0].count),
      currently_accepting: parseInt(acceptingResult.rows[0].count),
      topTypes: typeResult.rows,
      staleness: staleness.rows[0]
    };

  } catch (error) {
    console.error('getGrantStats error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Export functions
export { searchGrants, getGrantById, getGrantStats };

// ── Self-test when run directly ───────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔍 Testing search function...\n');

  // 1. Stats
  console.log('1️⃣  Grant statistics:');
  const stats = await getGrantStats();
  console.log(`   Total: ${stats.total}`);
  console.log(`   is_active=true: ${stats.is_active_true}`);
  console.log(`   currently_accepting=true: ${stats.currently_accepting}`);
  console.log(`   Staleness (accepting):`, stats.staleness);
  console.log(`   Top types:`, stats.topTypes.slice(0, 5).map(t => `${t.grant_type}(${t.count})`).join(', '));

  // 2. Vector search for "hiring"
  console.log('\n2️⃣  Vector search: "hiring grants BC tech"');
  const hiringResults = await searchGrants({
    keywords: ['hiring'],
    regions: ['British Columbia'],
    maxResults: 5
  });
  console.log(`   rankMethod: ${hiringResults.rankMethod}`);
  hiringResults.grants.forEach(g => {
    console.log(`   - [${g.vector_score ?? 'N/A'}] ${g.grant_name} (${g.last_updated})`);
  });

  // 3. Verify problematic grants are excluded
  console.log('\n3️⃣  Checking known-bad grants are excluded:');
  const badNames = ['Digital Link Ontario', 'DigitalWorks', 'Z-COVID', 'DORMANT'];
  for (const name of badNames) {
    const res = await searchGrants({ keywords: [name], maxResults: 5 });
    const found = res.grants.filter(g => g.grant_name.toLowerCase().includes(name.toLowerCase()));
    console.log(`   "${name}": ${found.length === 0 ? '✅ excluded' : `⚠️  ${found.length} found`}`);
  }

  // 4. Verify DigitalWorks shows with includeInactive
  console.log('\n4️⃣  DigitalWorks with includeInactive=true:');
  const dwRes = await searchGrants({ keywords: ['DigitalWorks'], includeInactive: true, maxResults: 2 });
  dwRes.grants.forEach(g => {
    console.log(`   ${g.grant_name} | currently_accepting=${g.currently_accepting} | reason: ${g.exclusion_reason}`);
  });

  console.log('\n✅ Tests complete');
  process.exit(0);
}
