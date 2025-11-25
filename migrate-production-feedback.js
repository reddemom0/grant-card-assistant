/**
 * Run feedback schema migration on PRODUCTION Railway database
 */

import pg from 'pg';
import fs from 'fs';

const { Pool } = pg;

// Production DATABASE_URL
const PRODUCTION_DB_URL = 'postgresql://postgres:bDLYkwkUCxbuOHawZJMNxUQOroBzeJGN@nozomi.proxy.rlwy.net:16552/railway';

const pool = new Pool({
  connectionString: PRODUCTION_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrateProduction() {
  const client = await pool.connect();

  try {
    console.log('🚀 Running feedback migration on PRODUCTION database...');
    console.log('📍 Database: nozomi.proxy.rlwy.net:16552\n');

    // Drop existing tables if they exist
    console.log('🧹 Dropping existing feedback tables if they exist...');
    await client.query('DROP TABLE IF EXISTS feedback_notes CASCADE');
    await client.query('DROP TABLE IF EXISTS conversation_feedback CASCADE');
    console.log('✅ Dropped old tables\n');

    console.log('🔄 Creating fresh feedback tables...\n');

    // Read and execute the migration SQL
    const migrationSQL = fs.readFileSync('./database-schema-feedback.sql', 'utf8');
    await client.query(migrationSQL);

    console.log('✅ Feedback tables created successfully!');
    console.log('   - conversation_feedback');
    console.log('   - feedback_notes');
    console.log('   - All indexes and constraints');

    // Verify tables exist
    const tables = ['conversation_feedback', 'feedback_notes'];
    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`   ✓ ${table}: ${result.rows[0].count} rows`);
    }

    console.log('\n✅ PRODUCTION migration complete! Feedback system is ready.');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrateProduction().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
