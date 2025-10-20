#!/usr/bin/env node
/**
 * migrate-data.js
 *
 * Migrates data from Vercel PostgreSQL to Railway PostgreSQL
 * Run this AFTER create-schema.js
 *
 * Usage:
 *   VERCEL_POSTGRES_URL="postgresql://..." RAILWAY_DATABASE_URL="postgresql://..." node migrate-data.js
 */

const { Pool } = require('pg');

// Get connection strings from environment
const VERCEL_POSTGRES_URL = process.env.VERCEL_POSTGRES_URL || process.env.POSTGRES_URL;
const RAILWAY_DATABASE_URL = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;

if (!VERCEL_POSTGRES_URL || !RAILWAY_DATABASE_URL) {
  console.error('❌ Error: Both VERCEL_POSTGRES_URL and RAILWAY_DATABASE_URL are required');
  console.error('Usage:');
  console.error('  VERCEL_POSTGRES_URL="postgresql://..." \\');
  console.error('  RAILWAY_DATABASE_URL="postgresql://..." \\');
  console.error('  node migrate-data.js');
  process.exit(1);
}

// Create connection pools
const vercelPool = new Pool({
  connectionString: VERCEL_POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});

const railwayPool = new Pool({
  connectionString: RAILWAY_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});

async function migrateData() {
  console.log('\n🚀 Starting data migration from Vercel to Railway...\n');

  try {
    // ========================================================================
    // TEST CONNECTIONS
    // ========================================================================

    console.log('🔌 Testing connections...\n');

    console.log('  Testing Vercel connection...');
    await vercelPool.query('SELECT NOW()');
    console.log('  ✅ Connected to Vercel PostgreSQL');

    console.log('  Testing Railway connection...');
    await railwayPool.query('SELECT NOW()');
    console.log('  ✅ Connected to Railway PostgreSQL\n');

    // ========================================================================
    // COUNT SOURCE DATA
    // ========================================================================

    console.log('📊 Counting source data (Vercel)...\n');

    const vercelUsersCount = await vercelPool.query('SELECT COUNT(*) FROM users');
    const vercelConversationsCount = await vercelPool.query('SELECT COUNT(*) FROM conversations');
    const vercelMessagesCount = await vercelPool.query('SELECT COUNT(*) FROM messages');

    const sourceUsers = parseInt(vercelUsersCount.rows[0].count);
    const sourceConversations = parseInt(vercelConversationsCount.rows[0].count);
    const sourceMessages = parseInt(vercelMessagesCount.rows[0].count);

    console.log(`  Users:         ${sourceUsers}`);
    console.log(`  Conversations: ${sourceConversations}`);
    console.log(`  Messages:      ${sourceMessages}\n`);

    if (sourceUsers === 0) {
      console.log('⚠️  No data to migrate. Exiting.\n');
      return;
    }

    // ========================================================================
    // MIGRATE USERS
    // ========================================================================

    console.log('👥 Migrating users table...\n');

    const usersResult = await vercelPool.query(`
      SELECT id, google_id, email, name, picture, created_at, updated_at
      FROM users
      ORDER BY created_at
    `);

    let usersInserted = 0;
    let usersSkipped = 0;

    for (const user of usersResult.rows) {
      try {
        await railwayPool.query(`
          INSERT INTO users (id, google_id, email, name, picture, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (google_id) DO NOTHING
        `, [
          user.id,
          user.google_id,
          user.email,
          user.name,
          user.picture,
          user.created_at,
          user.updated_at
        ]);
        usersInserted++;
      } catch (error) {
        console.log(`  ⚠️  Skipped user ${user.email}: ${error.message}`);
        usersSkipped++;
      }
    }

    console.log(`  ✅ Migrated ${usersInserted} users`);
    if (usersSkipped > 0) {
      console.log(`  ⚠️  Skipped ${usersSkipped} users (already exist)\n`);
    } else {
      console.log('');
    }

    // ========================================================================
    // MIGRATE CONVERSATIONS
    // ========================================================================

    console.log('💬 Migrating conversations table...\n');

    const conversationsResult = await vercelPool.query(`
      SELECT id, user_id, agent_type, title, created_at, updated_at
      FROM conversations
      ORDER BY created_at
    `);

    let conversationsInserted = 0;
    let conversationsSkipped = 0;

    for (const conv of conversationsResult.rows) {
      try {
        await railwayPool.query(`
          INSERT INTO conversations (id, user_id, agent_type, title, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO NOTHING
        `, [
          conv.id,
          conv.user_id,
          conv.agent_type,
          conv.title,
          conv.created_at,
          conv.updated_at
        ]);
        conversationsInserted++;
      } catch (error) {
        console.log(`  ⚠️  Skipped conversation ${conv.id}: ${error.message}`);
        conversationsSkipped++;
      }
    }

    console.log(`  ✅ Migrated ${conversationsInserted} conversations`);
    if (conversationsSkipped > 0) {
      console.log(`  ⚠️  Skipped ${conversationsSkipped} conversations (already exist)\n`);
    } else {
      console.log('');
    }

    // ========================================================================
    // MIGRATE MESSAGES
    // ========================================================================

    console.log('📨 Migrating messages table...\n');

    const messagesResult = await vercelPool.query(`
      SELECT id, conversation_id, role, content, created_at
      FROM messages
      ORDER BY created_at
    `);

    let messagesInserted = 0;
    let messagesSkipped = 0;
    let messagesBatch = [];
    const BATCH_SIZE = 100;

    for (const msg of messagesResult.rows) {
      messagesBatch.push(msg);

      if (messagesBatch.length >= BATCH_SIZE) {
        // Insert batch
        for (const message of messagesBatch) {
          try {
            await railwayPool.query(`
              INSERT INTO messages (id, conversation_id, role, content, created_at)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (id) DO NOTHING
            `, [
              message.id,
              message.conversation_id,
              message.role,
              message.content,
              message.created_at
            ]);
            messagesInserted++;
          } catch (error) {
            console.log(`  ⚠️  Skipped message ${message.id}: ${error.message}`);
            messagesSkipped++;
          }
        }
        console.log(`  📦 Inserted batch: ${messagesInserted} messages so far...`);
        messagesBatch = [];
      }
    }

    // Insert remaining messages
    for (const message of messagesBatch) {
      try {
        await railwayPool.query(`
          INSERT INTO messages (id, conversation_id, role, content, created_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO NOTHING
        `, [
          message.id,
          message.conversation_id,
          message.role,
          message.content,
          message.created_at
        ]);
        messagesInserted++;
      } catch (error) {
        console.log(`  ⚠️  Skipped message ${message.id}: ${error.message}`);
        messagesSkipped++;
      }
    }

    console.log(`  ✅ Migrated ${messagesInserted} messages`);
    if (messagesSkipped > 0) {
      console.log(`  ⚠️  Skipped ${messagesSkipped} messages (already exist)\n`);
    } else {
      console.log('');
    }

    // ========================================================================
    // VERIFY MIGRATION
    // ========================================================================

    console.log('🔍 Verifying migration...\n');

    const railwayUsersCount = await railwayPool.query('SELECT COUNT(*) FROM users');
    const railwayConversationsCount = await railwayPool.query('SELECT COUNT(*) FROM conversations');
    const railwayMessagesCount = await railwayPool.query('SELECT COUNT(*) FROM messages');

    const destUsers = parseInt(railwayUsersCount.rows[0].count);
    const destConversations = parseInt(railwayConversationsCount.rows[0].count);
    const destMessages = parseInt(railwayMessagesCount.rows[0].count);

    console.log('  Source (Vercel)     → Destination (Railway)');
    console.log('  ───────────────────────────────────────────');
    console.log(`  Users:         ${sourceUsers.toString().padEnd(4)} → ${destUsers}`);
    console.log(`  Conversations: ${sourceConversations.toString().padEnd(4)} → ${destConversations}`);
    console.log(`  Messages:      ${sourceMessages.toString().padEnd(4)} → ${destMessages}\n`);

    // Check if counts match
    const usersMatch = destUsers >= sourceUsers;
    const conversationsMatch = destConversations >= sourceConversations;
    const messagesMatch = destMessages >= sourceMessages;

    if (usersMatch && conversationsMatch && messagesMatch) {
      console.log('✅ Migration completed successfully!\n');
      console.log('📝 Next steps:');
      console.log('  1. Update your .env file with RAILWAY_DATABASE_URL');
      console.log('  2. Update server.js to use RAILWAY_DATABASE_URL instead of POSTGRES_URL');
      console.log('  3. Test your application with Railway database');
      console.log('  4. Deploy to production\n');
    } else {
      console.log('⚠️  Warning: Row counts do not match!\n');
      if (!usersMatch) console.log(`  ❌ Users: Expected ${sourceUsers}, got ${destUsers}`);
      if (!conversationsMatch) console.log(`  ❌ Conversations: Expected ${sourceConversations}, got ${destConversations}`);
      if (!messagesMatch) console.log(`  ❌ Messages: Expected ${sourceMessages}, got ${destMessages}`);
      console.log('\n  Please review the migration logs above for errors.\n');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await vercelPool.end();
    await railwayPool.end();
  }
}

// Run the migration
migrateData();
