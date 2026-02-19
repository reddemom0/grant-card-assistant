/**
 * Run migration 013: Lead-gen finalization tracking
 */

import 'dotenv/config';
import fs from 'fs';
import { query } from '../src/database/connection.js';

async function runMigration() {
  console.log('Running migration 013: Lead-gen finalization tracking...\n');

  try {
    const sql = fs.readFileSync('migrations/013_lead_gen_finalization.sql', 'utf-8');

    // Split by semicolon and run each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('COMMENT'));

    for (const statement of statements) {
      if (statement) {
        console.log(`Executing: ${statement.substring(0, 80)}...`);
        await query(statement);
        console.log('✓ Success\n');
      }
    }

    console.log('✅ Migration 013 completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

runMigration();
