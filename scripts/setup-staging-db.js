#!/usr/bin/env node
/**
 * Setup Staging Database
 *
 * This script connects to your Railway PostgreSQL database and creates all necessary tables.
 *
 * Usage:
 *   1. Get your DATABASE_URL from Railway staging environment
 *   2. Run: DATABASE_URL="your-url" node scripts/setup-staging-db.js
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

// Get DATABASE_URL from environment
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ Error: DATABASE_URL environment variable is required');
  console.error('');
  console.error('Usage:');
  console.error('  1. Go to Railway dashboard → staging environment → PostgreSQL');
  console.error('  2. Copy the DATABASE_URL variable');
  console.error('  3. Run this script:');
  console.error('     DATABASE_URL="postgresql://..." node scripts/setup-staging-db.js');
  console.error('');
  process.exit(1);
}

console.log('🚀 Setting up staging database...');
console.log('');

// Create database connection
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

async function setupDatabase() {
  try {
    // Read the SQL setup file
    const sqlFilePath = path.join(__dirname, '../migrations/setup-railway-complete.sql');
    const sql = fs.readFileSync(sqlFilePath, 'utf8');

    console.log('📋 Reading setup script from:', sqlFilePath);
    console.log('');

    // Execute the SQL
    console.log('🔧 Creating tables and indexes...');
    await pool.query(sql);

    console.log('✅ Database setup completed successfully!');
    console.log('');

    // Verify tables were created
    console.log('🔍 Verifying tables...');
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log('');
    console.log('Tables created:');
    result.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });

    console.log('');

    // Check users table has OAuth columns
    const usersColumns = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name IN ('google_access_token', 'google_refresh_token', 'google_token_expiry')
      ORDER BY column_name;
    `);

    console.log('OAuth token columns in users table:');
    if (usersColumns.rows.length === 3) {
      usersColumns.rows.forEach(row => {
        console.log(`  ✓ ${row.column_name}`);
      });
      console.log('');
      console.log('🎉 All done! Your staging database is ready.');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Try logging into staging: https://grant-card-assistant-staging.up.railway.app');
      console.log('  2. Test creating a conversation');
      console.log('  3. Test Google Docs creation');
    } else {
      console.log('  ⚠️  Warning: Not all OAuth columns were created');
      console.log('  Expected: google_access_token, google_refresh_token, google_token_expiry');
      console.log(`  Found: ${usersColumns.rows.length} columns`);
    }

  } catch (error) {
    console.error('');
    console.error('❌ Database setup failed:');
    console.error(error.message);
    console.error('');

    if (error.message.includes('connect')) {
      console.error('Connection error - please check:');
      console.error('  1. DATABASE_URL is correct');
      console.error('  2. PostgreSQL service is running in Railway');
      console.error('  3. Your IP is allowed (Railway usually allows all IPs)');
    }

    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the setup
setupDatabase();
