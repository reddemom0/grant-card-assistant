#!/usr/bin/env node
/**
 * Add OAuth Token Columns to Existing Users Table
 *
 * This script adds the missing OAuth columns to the users table.
 */

import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ Error: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

async function addOAuthColumns() {
  try {
    console.log('🚀 Adding OAuth columns to users table...\n');

    // Add the OAuth columns
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS google_access_token TEXT,
      ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
      ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMP;
    `);

    console.log('✅ OAuth columns added successfully!');
    console.log('');

    // Create index for refresh token lookups
    console.log('🔧 Creating index on google_refresh_token...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_refresh_token
      ON users(google_refresh_token);
    `);

    console.log('✅ Index created successfully!');
    console.log('');

    // Verify the columns were added
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name IN ('google_access_token', 'google_refresh_token', 'google_token_expiry')
      ORDER BY column_name;
    `);

    console.log('🔍 Verification - OAuth columns in users table:');
    result.rows.forEach(row => {
      console.log(`  ✓ ${row.column_name}`);
    });
    console.log('');

    if (result.rows.length === 3) {
      console.log('🎉 All done! Your staging database is now ready.');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Try logging into staging: https://grant-card-assistant-staging.up.railway.app');
      console.log('  2. Test creating a conversation');
      console.log('  3. Test Google Docs creation');
    } else {
      console.log('⚠️  Warning: Not all columns were added');
      console.log(`   Expected 3 columns, found ${result.rows.length}`);
    }

  } catch (error) {
    console.error('');
    console.error('❌ Error adding OAuth columns:');
    console.error(error.message);
    console.error('');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addOAuthColumns();
