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
