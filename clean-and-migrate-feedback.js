/**
 * Clean and recreate feedback tables on Railway database
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

async function cleanAndMigrate() {
  const client = await pool.connect();

  try {
    console.log('🧹 Dropping existing feedback tables if they exist...\n');

    // Drop tables in correct order (child tables first)
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

    // Verify tables exist and are empty
    const tables = ['conversation_feedback', 'feedback_notes'];
    for (const table of tables) {
      const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
      console.log(`   ✓ ${table}: ${result.rows[0].count} rows`);
    }

    console.log('\n✅ Migration complete! Feedback system is ready.');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanAndMigrate().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
