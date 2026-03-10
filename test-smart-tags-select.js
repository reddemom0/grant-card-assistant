/**
 * Test selecting smart_tags column exactly as the search function does
 */

import { Client } from 'pg';
import { config } from 'dotenv';

config();

async function testSmartTagsSelect() {
  // Use DATABASE_URL first (what Railway uses), fallback to POSTGRES_URL (what we use locally)
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  console.log(`🔍 Connecting with: ${connectionString ? connectionString.split('@')[1]?.substring(0, 30) + '...' : 'NO CONNECTION STRING'}\n`);

  const client = new Client({
    connectionString,
    ssl: connectionString?.includes('railway') ? { rejectUnauthorized: false } : undefined
  });

  try {
    await client.connect();
    console.log('✅ Connected\n');

    // Try the exact SELECT that the search function uses
    console.log('📊 Testing SELECT with smart_tags...\n');

    const testQuery = `
      SELECT
        grant_id, grant_name, grant_type, grant_amount, url,
        regions, industries, program_provider, deadline,
        max_spend, contribution_percentage, difficulty,
        grant_criteria, best_practices, recently_changed,
        last_updated, is_active, currently_accepting, exclusion_reason,
        smart_tags
      FROM grants
      LIMIT 1
    `;

    const result = await client.query(testQuery);

    console.log('✅ Query successful!\n');
    console.log('📋 Sample result:');
    console.log(`   Grant: ${result.rows[0]?.grant_name}`);
    console.log(`   smart_tags: ${result.rows[0]?.smart_tags ? 'EXISTS' : 'NULL'}`);

    if (result.rows[0]?.smart_tags) {
      const tags = result.rows[0].smart_tags;
      console.log(`   Primary intents: ${tags.primary_intents?.join(', ')}`);
      console.log(`   Genres: ${tags.genres?.join(', ')}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Code:', error.code);
    console.error('   Detail:', error.detail);
    throw error;
  } finally {
    await client.end();
    console.log('\n✅ Connection closed');
  }
}

testSmartTagsSelect();
