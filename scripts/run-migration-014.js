/**
 * Run Migration 014: Add intake_cycle column
 *
 * Adds the intake_cycle field to the grants table.
 */

import fs from 'fs';
import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

async function runMigration() {
  console.log('🔄 Running migration 014: Add intake_cycle field...\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const client = await pool.connect();

    // Read migration file
    const migrationSQL = fs.readFileSync('migrations/014_add_intake_cycle.sql', 'utf-8');

    console.log('📄 Executing migration SQL...\n');
    await client.query(migrationSQL);

    console.log('\n✅ Migration 014 complete!');

    client.release();
    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error(error.stack);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
