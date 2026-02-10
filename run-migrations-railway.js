#!/usr/bin/env node
/**
 * Run Database Migrations on Railway
 *
 * This script runs all pending migrations on the Railway Postgres database.
 * Execute on Railway: railway run node run-migrations-railway.js
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable not set!');
    process.exit(1);
  }

  const dbHost = process.env.DATABASE_URL.split('@')[1]?.split('/')[0] || 'unknown';
  console.log(`\n🔄 Running migrations on: ${dbHost}\n`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Get list of migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`📋 Found ${migrationFiles.length} migration files\n`);

    // Run each migration
    for (const file of migrationFiles) {
      console.log(`⏳ Running: ${file}`);

      const migrationSQL = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      try {
        await pool.query(migrationSQL);
        console.log(`   ✅ ${file} completed\n`);
      } catch (error) {
        // Check if it's just a "column already exists" error (safe to ignore)
        if (error.code === '42701' || error.message.includes('already exists')) {
          console.log(`   ⚠️  ${file} - already applied (skipped)\n`);
        } else {
          throw error;
        }
      }
    }

    // Verify grants table structure
    console.log('📊 Verifying grants table structure...');
    const columns = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'grants'
      ORDER BY ordinal_position
    `);

    console.log(`   ✅ Grants table has ${columns.rows.length} columns:`);
    columns.rows.forEach(col => {
      console.log(`      - ${col.column_name} (${col.data_type})`);
    });

    // Check for recently_changed specifically
    const hasRecentlyChanged = columns.rows.some(col => col.column_name === 'recently_changed');
    if (hasRecentlyChanged) {
      console.log('\n✅ SUCCESS: recently_changed column exists!\n');
    } else {
      console.log('\n❌ ERROR: recently_changed column is missing!\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Code:', error.code);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
