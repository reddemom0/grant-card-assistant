#!/usr/bin/env node
/**
 * create-schema.js
 *
 * Creates the database schema on Railway PostgreSQL
 * Run this FIRST before migrate-data.js
 *
 * Usage:
 *   RAILWAY_DATABASE_URL="postgresql://..." node create-schema.js
 */

const { Pool } = require('pg');

// Get Railway connection string from environment
const RAILWAY_DATABASE_URL = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;

if (!RAILWAY_DATABASE_URL) {
  console.error('❌ Error: RAILWAY_DATABASE_URL environment variable is required');
  console.error('Usage: RAILWAY_DATABASE_URL="postgresql://..." node create-schema.js');
  process.exit(1);
}

// Create connection pool for Railway (destination)
const railwayPool = new Pool({
  connectionString: RAILWAY_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createSchema() {
  console.log('\n🚀 Starting schema creation on Railway PostgreSQL...\n');

  try {
    // Test connection
    console.log('🔌 Testing Railway connection...');
    await railwayPool.query('SELECT NOW()');
    console.log('✅ Connected to Railway PostgreSQL\n');

    // ========================================================================
    // CREATE TABLES
    // ========================================================================

    console.log('📋 Creating tables...\n');

    // 1. Create users table
    console.log('  Creating users table...');
    await railwayPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        google_id VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        picture TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✅ Users table created');

    // 2. Create conversations table
    console.log('  Creating conversations table...');
    await railwayPool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agent_type VARCHAR(50) NOT NULL,
        title VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✅ Conversations table created');

    // 3. Create messages table
    console.log('  Creating messages table...');
    await railwayPool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✅ Messages table created\n');

    // ========================================================================
    // CREATE INDEXES
    // ========================================================================

    console.log('📊 Creating indexes...\n');

    // Users indexes
    console.log('  Creating users indexes...');
    await railwayPool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)
    `);
    await railwayPool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);
    console.log('  ✅ Users indexes created');

    // Conversations indexes
    console.log('  Creating conversations indexes...');
    await railwayPool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)
    `);
    await railwayPool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC)
    `);
    await railwayPool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_user_agent ON conversations(user_id, agent_type)
    `);
    console.log('  ✅ Conversations indexes created');

    // Messages indexes
    console.log('  Creating messages indexes...');
    await railwayPool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)
    `);
    console.log('  ✅ Messages indexes created\n');

    // ========================================================================
    // CREATE TRIGGER
    // ========================================================================

    console.log('⚡ Creating trigger function...\n');

    // Create trigger function
    await railwayPool.query(`
      CREATE OR REPLACE FUNCTION update_conversation_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE conversations
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.conversation_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log('  ✅ Trigger function created');

    // Create trigger
    await railwayPool.query(`
      DROP TRIGGER IF EXISTS trigger_update_conversation_timestamp ON messages
    `);
    await railwayPool.query(`
      CREATE TRIGGER trigger_update_conversation_timestamp
      AFTER INSERT ON messages
      FOR EACH ROW
      EXECUTE FUNCTION update_conversation_timestamp()
    `);
    console.log('  ✅ Trigger created\n');

    // ========================================================================
    // VERIFY SCHEMA
    // ========================================================================

    console.log('🔍 Verifying schema...\n');

    // Check tables
    const tablesResult = await railwayPool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('users', 'conversations', 'messages')
      ORDER BY table_name
    `);
    console.log('  Tables created:', tablesResult.rows.map(r => r.table_name).join(', '));

    // Check indexes
    const indexesResult = await railwayPool.query(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE tablename IN ('users', 'conversations', 'messages')
      ORDER BY tablename, indexname
    `);
    console.log('  Indexes created:', indexesResult.rowCount);

    // Check trigger
    const triggerResult = await railwayPool.query(`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE event_object_table = 'messages'
    `);
    console.log('  Triggers created:', triggerResult.rowCount);

    console.log('\n✅ Schema creation completed successfully!\n');
    console.log('📝 Next step: Run migrate-data.js to copy data from Vercel\n');

  } catch (error) {
    console.error('\n❌ Schema creation failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await railwayPool.end();
  }
}

// Run the schema creation
createSchema();
