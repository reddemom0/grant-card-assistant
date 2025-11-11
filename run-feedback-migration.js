/**
 * Run Feedback System Database Migration
 * Executes database-schema-feedback.sql on Railway PostgreSQL
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { config } from 'dotenv';

config();

const { Pool } = pg;

async function runMigration() {
  console.log('🚀 Starting feedback system database migration...\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('neon.tech') || process.env.DATABASE_URL.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined
  });

  try {
    // Read SQL file
    const sql = readFileSync('./database-schema-feedback.sql', 'utf8');

    console.log('📄 Loaded migration file: database-schema-feedback.sql');

    // Execute migration
    console.log('⚙️  Executing migration...\n');
    await pool.query(sql);

    console.log('✅ Migration completed successfully!\n');

    // Verify tables were created
    console.log('🔍 Verifying tables...');

    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('conversation_feedback', 'feedback_notes')
      ORDER BY table_name
    `);

    console.log('\n📊 Tables created:');
    tablesResult.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });

    // Check indexes
    const indexesResult = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('conversation_feedback', 'feedback_notes')
      ORDER BY indexname
    `);

    console.log('\n📑 Indexes created:');
    indexesResult.rows.forEach(row => {
      console.log(`  ✓ ${row.indexname}`);
    });

    console.log('\n🎉 Feedback system database migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
