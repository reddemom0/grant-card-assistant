/**
 * Add smart_tags column to Railway Postgres database
 * Run with: railway shell node fix-railway-smart-tags.js
 */

import { Client } from 'pg';

async function fixRailwayDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('🔍 Connecting to Railway Postgres...\n');
    await client.connect();
    console.log('✅ Connected\n');

    // Step 1: Check if column exists
    console.log('📊 Step 1: Checking for smart_tags column...\n');
    const columnCheck = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'grants' AND column_name = 'smart_tags'
    `);

    if (columnCheck.rows.length === 0) {
      console.log('❌ Column does NOT exist - adding now...\n');

      await client.query(`
        ALTER TABLE grants
        ADD COLUMN smart_tags JSONB DEFAULT NULL
      `);

      console.log('✅ Column added\n');

      // Add index
      console.log('🔧 Creating GIN index...\n');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_grants_smart_tags
        ON grants USING gin(smart_tags)
      `);

      console.log('✅ Index created\n');
    } else {
      console.log('✅ Column already exists\n');
    }

    // Step 2: Check record counts
    console.log('📊 Step 2: Checking data status...\n');
    const counts = await client.query(`
      SELECT
        COUNT(*) as total_grants,
        COUNT(smart_tags) as grants_with_tags
      FROM grants
    `);

    const { total_grants, grants_with_tags } = counts.rows[0];
    console.log(`   Total grants: ${total_grants}`);
    console.log(`   With tags: ${grants_with_tags}`);
    console.log(`   Missing tags: ${total_grants - grants_with_tags}\n`);

    if (parseInt(grants_with_tags) < parseInt(total_grants)) {
      console.log('⚠️  WARNING: Not all grants are tagged');
      console.log('   You need to run the batch tagger on Railway database\n');
    } else {
      console.log('✅ All grants are tagged\n');
    }

    // Step 3: Test SELECT query that was failing
    console.log('📊 Step 3: Testing SELECT query with smart_tags...\n');
    const testQuery = await client.query(`
      SELECT grant_id, grant_name, smart_tags
      FROM grants
      WHERE smart_tags IS NOT NULL
      LIMIT 1
    `);

    if (testQuery.rows.length > 0) {
      console.log('✅ SELECT query works!');
      console.log(`   Sample: ${testQuery.rows[0].grant_name}`);
      console.log(`   Tags: ${JSON.stringify(testQuery.rows[0].smart_tags).substring(0, 100)}...\n`);
    } else {
      console.log('⚠️  Query works but no tagged grants found\n');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Code:', error.code);
    throw error;
  } finally {
    await client.end();
    console.log('✅ Connection closed');
  }
}

fixRailwayDatabase();
