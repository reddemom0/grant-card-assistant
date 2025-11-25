/**
 * Run feedback schema migration on Railway database
 * Creates conversation_feedback and feedback_notes tables
 */

import pg from 'pg';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('🔄 Running feedback schema migration on Railway database...\n');

    // Read the migration SQL
    const migrationSQL = fs.readFileSync('./database-schema-feedback.sql', 'utf8');

    // Execute the migration
    await client.query(migrationSQL);

    console.log('✅ Feedback tables created successfully!');
    console.log('   - conversation_feedback');
    console.log('   - feedback_notes');
    console.log('   - All indexes and constraints');

    // Verify tables exist
    const tables = ['conversation_feedback', 'feedback_notes'];
    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*) FROM ${table}`
      );
      console.log(`   ✓ ${table}: ${result.rows[0].count} rows`);
    }

    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
