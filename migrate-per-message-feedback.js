/**
 * Migrate Feedback System to Per-Message Ratings
 * Changes conversation_feedback from per-conversation to per-message
 */

import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

async function migrate() {
  console.log('🚀 Starting per-message feedback migration...\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('neon.tech') || process.env.DATABASE_URL.includes('railway.app')
      ? { rejectUnauthorized: false }
      : undefined
  });

  try {
    // Step 1: Remove old UNIQUE constraint on conversation_id
    console.log('📋 Step 1: Removing UNIQUE constraint on conversation_id...');
    await pool.query(`
      ALTER TABLE conversation_feedback
      DROP CONSTRAINT IF EXISTS conversation_feedback_conversation_id_key
    `);
    console.log('✅ Old constraint removed\n');

    // Step 2: Add message_id column (UUID to match messages table)
    console.log('📋 Step 2: Adding message_id column...');
    await pool.query(`
      ALTER TABLE conversation_feedback
      ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE CASCADE
    `);
    console.log('✅ message_id column added\n');

    // Step 3: Create index on message_id
    console.log('📋 Step 3: Creating index on message_id...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_feedback_message ON conversation_feedback(message_id)
    `);
    console.log('✅ Index created\n');

    // Step 4: Add UNIQUE constraint on message_id (one rating per message)
    console.log('📋 Step 4: Adding UNIQUE constraint on message_id...');
    await pool.query(`
      ALTER TABLE conversation_feedback
      ADD CONSTRAINT unique_message_rating UNIQUE(message_id)
    `);
    console.log('✅ UNIQUE constraint added\n');

    // Step 5: Update comments
    console.log('📋 Step 5: Updating table comments...');
    await pool.query(`
      COMMENT ON TABLE conversation_feedback IS 'Per-message ratings (thumbs up/down) with quality metrics'
    `);
    await pool.query(`
      COMMENT ON COLUMN conversation_feedback.message_id IS 'The specific message being rated'
    `);
    console.log('✅ Comments updated\n');

    // Verification
    console.log('🔍 Verifying changes...');
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'conversation_feedback'
      AND column_name = 'message_id'
    `);

    if (result.rows.length > 0) {
      console.log('\n✅ Migration successful!');
      console.log('   message_id column:', result.rows[0]);
    } else {
      throw new Error('message_id column not found after migration');
    }

    console.log('\n🎉 Per-message feedback migration complete!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
