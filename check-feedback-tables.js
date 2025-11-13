/**
 * Check if feedback tables exist in Railway database
 * Run with: node check-feedback-tables.js
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkTables() {
  const client = await pool.connect();

  try {
    console.log('🔍 Checking feedback tables in database...\n');

    // Check for required tables
    const tables = ['conversation_feedback', 'feedback_notes', 'conversations', 'messages', 'users'];

    for (const table of tables) {
      const result = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = $1
        )`,
        [table]
      );

      const exists = result.rows[0].exists;
      console.log(`${exists ? '✅' : '❌'} ${table}: ${exists ? 'EXISTS' : 'MISSING'}`);

      if (exists) {
        // Count rows
        const countResult = await client.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`   └─ ${countResult.rows[0].count} rows\n`);
      } else {
        console.log('');
      }
    }

    console.log('\n📊 Database Connection: SUCCESS');
    console.log(`🔗 Connected to: ${process.env.DATABASE_URL?.substring(0, 30)}...`);

  } catch (error) {
    console.error('❌ Error checking tables:', error.message);
    console.error('Full error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

checkTables();
