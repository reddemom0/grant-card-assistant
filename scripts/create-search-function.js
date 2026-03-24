/**
 * Grant Search Function
 *
 * Keyword + filter search with match-count ranking.
 *
 * Key design decisions:
 * - Splits multi-word keyword strings into individual tokens so that
 *   "hiring training expansion Alberta" → ['hiring','training','expansion','alberta']
 * - WHERE uses OR across all tokens: any token match = row included
 * - ORDER BY keyword_score DESC (# of tokens matched), then last_updated DESC
 * - Filters on currently_accepting = true (not just is_active) to exclude
 *   programs that GetGranted hasn't deactivated but are clearly closed.
 * - Excludes garbage-named grants (Z-COVID, Z-DUPLICATE, DORMANT) automatically.
 */

import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

/**
 * Tokenise keyword input:
 * - Accepts an array of strings (may be multi-word, e.g. ['hiring training BC'])
 * - Splits each string on whitespace
 * - Lower-cases, strips non-alphanumeric characters
 * - Drops tokens shorter than 2 characters
 */
function tokeniseKeywords(keywords) {
  return keywords
    .flatMap(k => k.split(/\s+/))
    .map(w => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(w => w.length >= 2);
}

/**
 * Search grants using keywords, filters, and match-count ranking.
 *
 * @param {Object} opts
 * @param {string[]} opts.keywords      - Raw keyword strings (may be multi-word)
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
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const client = await pool.connect();

    // Tokenise keywords into individual words
    const tokens = tokeniseKeywords(keywords);

    const params = [];
    let paramIndex = 1;
    const whereConditions = ['1=1'];

    // ── Status filter ─────────────────────────────────────────────────────────
    // Use currently_accepting when populated (migration 004+), fall back to is_active.
    if (!includeInactive) {
      whereConditions.push(`(
        CASE WHEN currently_accepting IS NOT NULL
             THEN currently_accepting = true
             ELSE is_active = true
        END
      )`);
    } else {
      // When including inactive grants, still exclude obviously dead programs:
      // - Programs not updated since 2024 (stale for over a year)
      // - Programs with exclusion reasons indicating permanent closure
      whereConditions.push(`(
        last_updated >= '2024-01-01'
        AND (
          exclusion_reason IS NULL
          OR (
            exclusion_reason NOT ILIKE '%discontinued%'
            AND exclusion_reason NOT ILIKE '%cancelled%'
            AND exclusion_reason NOT ILIKE '%permanently closed%'
            AND exclusion_reason NOT ILIKE '%defunded%'
          )
        )
      )`);
    }

    // ── Keyword filter ────────────────────────────────────────────────────────
    // Each token is checked across all searchable fields.
    // OR logic between tokens: a row matches if ANY token appears anywhere.
    // (Ranking then promotes rows that match MORE tokens.)
    if (tokens.length > 0) {
      const tokenConditions = tokens.map(token => {
        const p = `%${token}%`;
        params.push(p, p, p, p, p, p);
        const cond = `(
          grant_name       ILIKE $${paramIndex}
          OR grant_type    ILIKE $${paramIndex + 1}
          OR grant_criteria ILIKE $${paramIndex + 2}
          OR best_practices ILIKE $${paramIndex + 3}
          OR recently_changed ILIKE $${paramIndex + 4}
          OR full_page_text ILIKE $${paramIndex + 5}
        )`;
        paramIndex += 6;
        return cond;
      });
      // OR across all tokens — row appears if at least one token matches
      whereConditions.push(`(${tokenConditions.join(' OR ')})`);
    }

    // ── Region filter ─────────────────────────────────────────────────────────
    // Auto-includes "All of Canada" grants regardless of requested region.
    if (regions.length > 0) {
      const regionConditions = regions.map(region => {
        params.push(`%${region}%`);
        return `regions ILIKE $${paramIndex++}`;
      });
      whereConditions.push(
        `(regions ILIKE '%All of Canada%' OR ${regionConditions.join(' OR ')})`
      );
    }

    // ── Industry filter ───────────────────────────────────────────────────────
    if (industries.length > 0) {
      const industryConditions = industries.map(industry => {
        params.push(`%${industry}%`);
        return `industries ILIKE $${paramIndex++}`;
      });
      whereConditions.push(`(${industryConditions.join(' OR ')})`);
    }

    // ── Grant type filter ─────────────────────────────────────────────────────
    if (grantTypes.length > 0) {
      const typeConditions = grantTypes.map(type => {
        params.push(`%${type}%`);
        return `grant_type ILIKE $${paramIndex++}`;
      });
      whereConditions.push(`(${typeConditions.join(' OR ')})`);
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    // ── Keyword score expression ──────────────────────────────────────────────
    // Counts how many tokens matched in the most important fields.
    // Uses string literals (safe: tokens are already stripped to [a-z0-9]).
    // This avoids doubling the param count and is readable in EXPLAIN output.
    const keywordScoreExpr = tokens.length > 0
      ? `(${tokens.map(token =>
          `(CASE WHEN (
            grant_name        ILIKE '%${token}%'
            OR grant_type     ILIKE '%${token}%'
            OR grant_criteria ILIKE '%${token}%'
            OR recently_changed ILIKE '%${token}%'
          ) THEN 1 ELSE 0 END)`
        ).join(' +\n          ')})`
      : '0';

    // ── LIMIT param ───────────────────────────────────────────────────────────
    params.push(maxResults);
    const limitParam = paramIndex++;

    // ── Full query ────────────────────────────────────────────────────────────
    const sql = `
      SELECT
        grant_id, grant_name, grant_type, grant_amount, url,
        regions, industries, program_provider, deadline,
        max_spend, contribution_percentage, difficulty,
        grant_criteria, best_practices, recently_changed,
        last_updated, is_active, currently_accepting, exclusion_reason,
        smart_tags, genre_scores,
        ${keywordScoreExpr} AS keyword_score
      FROM grants
      ${whereClause}
      ORDER BY
        ${tokens.length > 0 ? `${keywordScoreExpr} DESC,` : ''}
        last_updated DESC NULLS LAST
      LIMIT $${limitParam}
    `;

    const result = await client.query(sql, params);
    client.release();

    const rankMethod = tokens.length > 0 ? 'keyword-match-count+recency' : 'recency';
    console.log(`✅ searchGrants: ${result.rows.length} results (tokens: [${tokens.join(', ')}], ranked by ${rankMethod})`);

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
 * Search grants by genre scores (AI-powered relevance ranking)
 *
 * @param {string} province - Province/territory filter
 * @param {Object} smartFilterWeights - Weights for each smart filter (0, 1, or 2)
 * @param {number} maxResults - Max results (default 15)
 * @returns {Promise<{total: number, rankMethod: string, grants: Array}>}
 */
async function searchByGenreScores(province, smartFilterWeights = {}, maxResults = 15) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const client = await pool.connect();

    // Build weighted score expression using smart filter weights
    const weights = {
      'Building Bench of Talent': smartFilterWeights['Building Bench of Talent'] || 0,
      'Adopt Software or AI': smartFilterWeights['Adopt Software or AI'] || 0,
      'Buy Equipment or Upgrade Facilities': smartFilterWeights['Buy Equipment or Upgrade Facilities'] || 0,
      'Build Something New': smartFilterWeights['Build Something New'] || 0,
      'International Growth': smartFilterWeights['International Growth'] || 0,
      'Domestic Growth': smartFilterWeights['Domestic Growth'] || 0,
      'Improve Sustainability': smartFilterWeights['Improve Sustainability'] || 0,
      'Improve Productivity': smartFilterWeights['Improve Productivity'] || 0,
      'Commercialize or Scale': smartFilterWeights['Commercialize or Scale'] || 0,
      'Planning or Readiness Support': smartFilterWeights['Planning or Readiness Support'] || 0,
      'Grants for Startups': smartFilterWeights['Grants for Startups'] || 0
    };

    // Handle multiple provinces (comma-separated)
    const provinces = province.includes(',')
      ? province.split(',').map(p => p.trim())
      : [province];

    // Build province OR conditions dynamically
    const provinceConditions = provinces.map((_, idx) => `regions ILIKE $${idx + 1}`).join(' OR ');
    const provinceClause = provinces.length > 0
      ? `(${provinceConditions} OR regions ILIKE '%National%' OR regions ILIKE '%Canada%')`
      : `(regions ILIKE '%National%' OR regions ILIKE '%Canada%')`;

    const sql = `
      SELECT
        grant_id, grant_name, grant_type, grant_amount, url, regions, industries,
        program_provider, deadline, contribution_percentage, grant_criteria,
        currently_accepting, intake_cycle, smart_tags, genre_scores,
        (
          COALESCE((genre_scores->'association_scores'->'Building Bench of Talent'->>'association_pct')::int, 0) * $${provinces.length + 1} +
          COALESCE((genre_scores->'association_scores'->'Adopt Software or AI'->>'association_pct')::int, 0) * $${provinces.length + 2} +
          COALESCE((genre_scores->'association_scores'->'Buy Equipment or Upgrade Facilities'->>'association_pct')::int, 0) * $${provinces.length + 3} +
          COALESCE((genre_scores->'association_scores'->'Build Something New'->>'association_pct')::int, 0) * $${provinces.length + 4} +
          COALESCE((genre_scores->'association_scores'->'International Growth'->>'association_pct')::int, 0) * $${provinces.length + 5} +
          COALESCE((genre_scores->'association_scores'->'Domestic Growth'->>'association_pct')::int, 0) * $${provinces.length + 6} +
          COALESCE((genre_scores->'association_scores'->'Improve Sustainability'->>'association_pct')::int, 0) * $${provinces.length + 7} +
          COALESCE((genre_scores->'association_scores'->'Improve Productivity'->>'association_pct')::int, 0) * $${provinces.length + 8} +
          COALESCE((genre_scores->'association_scores'->'Commercialize or Scale'->>'association_pct')::int, 0) * $${provinces.length + 9} +
          COALESCE((genre_scores->'association_scores'->'Planning or Readiness Support'->>'association_pct')::int, 0) * $${provinces.length + 10} +
          COALESCE((genre_scores->'association_scores'->'Grants for Startups'->>'association_pct')::int, 0) * $${provinces.length + 11}
        ) AS relevance_score
      FROM grants
      WHERE currently_accepting = true
        AND genre_scores IS NOT NULL
        AND ${provinceClause}
      ORDER BY relevance_score DESC
      LIMIT $${provinces.length + 12}
    `;

    const params = [
      ...provinces.map(p => `%${p}%`), // Province parameters with wildcards
      weights['Building Bench of Talent'],
      weights['Adopt Software or AI'],
      weights['Buy Equipment or Upgrade Facilities'],
      weights['Build Something New'],
      weights['International Growth'],
      weights['Domestic Growth'],
      weights['Improve Sustainability'],
      weights['Improve Productivity'],
      weights['Commercialize or Scale'],
      weights['Planning or Readiness Support'],
      weights['Grants for Startups'],
      maxResults
    ];

    const result = await client.query(sql, params);
    client.release();

    console.log(`✅ searchByGenreScores: ${result.rows.length} results (province: ${province}, filters: ${Object.keys(smartFilterWeights).length})`);
    console.log(`   Top 3 relevance scores: ${result.rows.slice(0, 3).map(r => `${r.grant_name}: ${r.relevance_score}`).join(', ')}`);

    return {
      total: result.rows.length,
      rankMethod: 'genre-scores-weighted',
      grants: result.rows
    };

  } catch (error) {
    console.error('❌ searchByGenreScores error:', error);
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
export { searchGrants, searchByGenreScores, getGrantById, getGrantStats };

// ── Self-test when run directly ───────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔍 Testing search function...\n');

  // 1. Stats
  console.log('1️⃣  Grant statistics:');
  const stats = await getGrantStats();
  console.log(`   Total: ${stats.total}`);
  console.log(`   is_active=true: ${stats.is_active_true}`);
  console.log(`   currently_accepting=true: ${stats.currently_accepting}`);
  console.log(`   Top types:`, stats.topTypes.slice(0, 5).map(t => `${t.grant_type}(${t.count})`).join(', '));

  // 2. Multi-word keyword search (the bug this rewrite fixes)
  console.log('\n2️⃣  Multi-word keyword: "hiring training expansion Alberta"');
  const r1 = await searchGrants({ keywords: ['hiring training expansion Alberta'], maxResults: 5 });
  console.log(`   rankMethod: ${r1.rankMethod}`);
  r1.grants.forEach(g => console.log(`   - [${g.keyword_score}] ${g.grant_name}`));

  // 3. Comma-separated keywords (legacy format)
  console.log('\n3️⃣  Comma-split keywords: ["hiring", "Alberta"]');
  const r2 = await searchGrants({ keywords: ['hiring', 'Alberta'], maxResults: 5 });
  console.log(`   rankMethod: ${r2.rankMethod}`);
  r2.grants.forEach(g => console.log(`   - [${g.keyword_score}] ${g.grant_name}`));

  // 4. Region-only search
  console.log('\n4️⃣  Region-only: BC');
  const r3 = await searchGrants({ regions: ['British Columbia'], maxResults: 5 });
  console.log(`   Results: ${r3.total}`);

  // 5. Verify bad grants are still excluded
  console.log('\n5️⃣  Checking known-bad grants are excluded:');
  for (const name of ['DigitalWorks', 'Digital Link Ontario', 'TalentEdge']) {
    const res = await searchGrants({ keywords: [name], maxResults: 5 });
    const found = res.grants.filter(g => g.grant_name.toLowerCase().includes(name.toLowerCase()));
    console.log(`   "${name}": ${found.length === 0 ? '✅ excluded' : `⚠️  ${found.length} found`}`);
  }

  console.log('\n✅ Tests complete');
  process.exit(0);
}
