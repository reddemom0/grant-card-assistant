/**
 * Create Search Function for Oracle
 *
 * Provides simple keyword/filter-based search that returns candidate grants.
 * Oracle (Claude) will then analyze the results to select the best matches.
 */

import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

/**
 * Search grants using keywords and filters
 * Returns up to maxResults grants that match the criteria
 */
async function searchGrants({
  keywords = [],           // Array of keywords to search across all text fields
  regions = [],            // Array of regions to filter by
  industries = [],         // Array of industries to filter by
  grantTypes = [],         // Array of grant types to filter by
  includeInactive = false, // Whether to include inactive grants
  maxResults = 50          // Maximum number of results to return
}) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const client = await pool.connect();

    // Build the query
    let query = `
      SELECT
        grant_id,
        grant_name,
        grant_type,
        grant_amount,
        url,
        regions,
        industries,
        program_provider,
        deadline,
        max_spend,
        contribution_percentage,
        difficulty,
        grant_criteria,
        best_practices,
        last_updated,
        is_active
      FROM grants
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // Filter by active status
    if (!includeInactive) {
      query += ` AND is_active = true`;
    }

    // Keyword search (searches across multiple fields)
    if (keywords.length > 0) {
      const keywordConditions = keywords.map(keyword => {
        const param = `%${keyword}%`;
        params.push(param, param, param, param, param);
        const condition = `(
          grant_name ILIKE $${paramIndex} OR
          grant_criteria ILIKE $${paramIndex + 1} OR
          best_practices ILIKE $${paramIndex + 2} OR
          grant_type ILIKE $${paramIndex + 3} OR
          full_page_text ILIKE $${paramIndex + 4}
        )`;
        paramIndex += 5;
        return condition;
      });

      query += ` AND (${keywordConditions.join(' AND ')})`;
    }

    // Region filter
    if (regions.length > 0) {
      const regionConditions = regions.map(region => {
        params.push(`%${region}%`);
        return `regions ILIKE $${paramIndex++}`;
      });
      query += ` AND (${regionConditions.join(' OR ')})`;
    }

    // Industry filter
    if (industries.length > 0) {
      const industryConditions = industries.map(industry => {
        params.push(`%${industry}%`);
        return `industries ILIKE $${paramIndex++}`;
      });
      query += ` AND (${industryConditions.join(' OR ')})`;
    }

    // Grant type filter
    if (grantTypes.length > 0) {
      const typeConditions = grantTypes.map(type => {
        params.push(`%${type}%`);
        return `grant_type ILIKE $${paramIndex++}`;
      });
      query += ` AND (${typeConditions.join(' OR ')})`;
    }

    // Limit results
    query += ` LIMIT $${paramIndex}`;
    params.push(maxResults);

    // Execute query
    const result = await client.query(query, params);

    client.release();

    return {
      total: result.rows.length,
      grants: result.rows
    };

  } catch (error) {
    console.error('Search error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * Get grant by ID
 */
async function getGrantById(grantId) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const client = await pool.connect();

    const result = await client.query(
      'SELECT * FROM grants WHERE grant_id = $1',
      [grantId]
    );

    client.release();

    return result.rows[0] || null;

  } catch (error) {
    console.error('Get grant error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * Get grant statistics
 */
async function getGrantStats() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const client = await pool.connect();

    const totalResult = await client.query('SELECT COUNT(*) as count FROM grants');
    const activeResult = await client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = true');
    const inactiveResult = await client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = false');

    const typeResult = await client.query(`
      SELECT grant_type, COUNT(*) as count
      FROM grants
      WHERE grant_type IS NOT NULL
      GROUP BY grant_type
      ORDER BY count DESC
      LIMIT 10
    `);

    client.release();

    return {
      total: parseInt(totalResult.rows[0].count),
      active: parseInt(activeResult.rows[0].count),
      inactive: parseInt(inactiveResult.rows[0].count),
      topTypes: typeResult.rows
    };

  } catch (error) {
    console.error('Stats error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Export functions
export { searchGrants, getGrantById, getGrantStats };

// Test if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔍 Testing search function...\n');

  // Test 1: Get stats
  console.log('1️⃣ Getting grant statistics...');
  const stats = await getGrantStats();
  console.log(`   Total grants: ${stats.total}`);
  console.log(`   Active: ${stats.active}`);
  console.log(`   Inactive: ${stats.inactive}`);
  console.log(`   Top 5 types:`, stats.topTypes.slice(0, 5).map(t => `${t.grant_type}: ${t.count}`).join(', '));

  // Test 2: Search by keyword
  console.log('\n2️⃣ Searching for "hiring" grants...');
  const hiringResults = await searchGrants({
    keywords: ['hiring'],
    maxResults: 5
  });
  console.log(`   Found ${hiringResults.total} results`);
  hiringResults.grants.forEach(grant => {
    console.log(`   - ${grant.grant_name} (${grant.is_active ? 'Active' : 'Inactive'})`);
  });

  // Test 3: Search by region
  console.log('\n3️⃣ Searching for BC grants...');
  const bcResults = await searchGrants({
    regions: ['British Columbia'],
    maxResults: 5
  });
  console.log(`   Found ${bcResults.total} results`);
  bcResults.grants.forEach(grant => {
    console.log(`   - ${grant.grant_name}`);
  });

  // Test 4: Combined search
  console.log('\n4️⃣ Searching for "training" in "Ontario"...');
  const combinedResults = await searchGrants({
    keywords: ['training'],
    regions: ['Ontario'],
    maxResults: 5
  });
  console.log(`   Found ${combinedResults.total} results`);
  combinedResults.grants.forEach(grant => {
    console.log(`   - ${grant.grant_name}`);
  });

  console.log('\n✅ Search function test complete!');
  process.exit(0);
}
