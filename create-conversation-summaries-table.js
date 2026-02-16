#!/usr/bin/env node
/**
 * Create conversation_summaries table on Railway
 *
 * This script creates the missing conversation_summaries table needed for auto-compaction.
 * Run on Railway: railway run node create-conversation-summaries-table.js
 * Run locally: node create-conversation-summaries-table.js
 */

import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

async function createTable() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable not set!');
    process.exit(1);
  }

  const dbHost = process.env.DATABASE_URL.split('@')[1]?.split('/')[0] || 'unknown';
  console.log(`\n🔄 Creating conversation_summaries table on: ${dbHost}\n`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', '010_add_conversation_summaries.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📋 Running migration: 010_add_conversation_summaries.sql\n');

    // Run the migration
    await pool.query(migrationSQL);

    console.log('✅ conversation_summaries table created successfully!\n');

    // Verify the table exists
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'conversation_summaries'
      ORDER BY ordinal_position
    `);

    if (result.rows.length > 0) {
      console.log('📊 Table structure:');
      result.rows.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type})`);
      });
      console.log('\n✅ SUCCESS: conversation_summaries table is ready!\n');
    } else {
      console.log('❌ ERROR: Table was not created\n');
      process.exit(1);
    }

  } catch (error) {
    // Check if table already exists
    if (error.code === '42P07' || error.message.includes('already exists')) {
      console.log('⚠️  Table already exists (skipped)\n');

      // Still verify it
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'conversation_summaries'
        ORDER BY ordinal_position
      `);

      console.log('📊 Existing table structure:');
      result.rows.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type})`);
      });
      console.log('\n✅ Table is already configured correctly!\n');
    } else {
      console.error('\n❌ Migration failed:', error.message);
      console.error('Code:', error.code);
      console.error('Stack:', error.stack);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

createTable();
