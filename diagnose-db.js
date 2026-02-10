#!/usr/bin/env node
/**
 * Diagnose Database State
 * Checks if recently_changed column exists and can be queried
 */

import pg from 'pg';

const { Pool } = pg;

async function diagnose() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  const dbHost = process.env.DATABASE_URL.split('@')[1]?.split('/')[0] || 'unknown';
  console.log(`\n🔍 Diagnosing database: ${dbHost}\n`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Check if grants table exists
    const tableCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'grants'
    `);
    console.log('✓ Grants table exists:', tableCheck.rows.length > 0);

    // Check grants table columns
    const columns = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'grants'
      ORDER BY ordinal_position
    `);

    console.log(`\n📋 Grants table has ${columns.rows.length} columns:`);
    const hasRecentlyChanged = columns.rows.find(c => c.column_name === 'recently_changed');

    columns.rows.forEach(col => {
      const marker = col.column_name === 'recently_changed' ? ' ← TARGET COLUMN' : '';
      console.log(`   ${col.column_name} (${col.data_type})${marker}`);
    });

    if (hasRecentlyChanged) {
      console.log('\n✅ recently_changed column EXISTS');

      // Try to query it
      console.log('\n🔍 Testing query with recently_changed column...');
      const testQuery = await pool.query(`
        SELECT grant_id, grant_name, recently_changed
        FROM grants
        LIMIT 2
      `);
      console.log(`✅ Query successful! Retrieved ${testQuery.rows.length} rows`);

      testQuery.rows.forEach(row => {
        console.log(`   - ${row.grant_name}: recently_changed = ${row.recently_changed || 'NULL'}`);
      });

    } else {
      console.log('\n❌ recently_changed column DOES NOT EXIST');
      console.log('   Migration needs to be run!');
    }

    // Check total grant count
    const countResult = await pool.query('SELECT COUNT(*) as count FROM grants');
    console.log(`\n📊 Total grants in database: ${countResult.rows[0].count}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Code:', error.code);
  } finally {
    await pool.end();
  }
}

diagnose();
