#!/usr/bin/env node
/**
 * Check Staging Database
 * Shows current state of tables and columns
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

async function checkDatabase() {
  try {
    console.log('🔍 Checking staging database...\n');

    // Check tables
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log('📋 Existing tables:');
    if (tables.rows.length === 0) {
      console.log('  (none)');
    } else {
      tables.rows.forEach(row => {
        console.log(`  - ${row.table_name}`);
      });
    }
    console.log('');

    // Check users table columns if it exists
    if (tables.rows.some(r => r.table_name === 'users')) {
      const columns = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'users'
        ORDER BY ordinal_position;
      `);

      console.log('👤 users table columns:');
      columns.rows.forEach(row => {
        console.log(`  - ${row.column_name} (${row.data_type})`);
      });
      console.log('');

      // Check for OAuth columns
      const hasAccessToken = columns.rows.some(r => r.column_name === 'google_access_token');
      const hasRefreshToken = columns.rows.some(r => r.column_name === 'google_refresh_token');
      const hasTokenExpiry = columns.rows.some(r => r.column_name === 'google_token_expiry');

      console.log('OAuth columns:');
      console.log(`  google_access_token: ${hasAccessToken ? '✓' : '✗'}`);
      console.log(`  google_refresh_token: ${hasRefreshToken ? '✓' : '✗'}`);
      console.log(`  google_token_expiry: ${hasTokenExpiry ? '✓' : '✗'}`);
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkDatabase();
