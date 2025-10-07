#!/usr/bin/env node
/**
 * Database Schema Verification Script
 *
 * Checks if the PostgreSQL database has the correct schema for Phase 4
 * (user authentication and user-scoped conversations)
 *
 * Usage: node verify-database-schema.js
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function verifySchema() {
  console.log('🔍 Verifying database schema for Phase 4...\n');

  try {
    // ============================================================================
    // 1. Check if tables exist
    // ============================================================================
    console.log('📋 Checking tables...');
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('users', 'conversations', 'messages')
      ORDER BY table_name
    `);

    const existingTables = tablesResult.rows.map(r => r.table_name);
    console.log('  Tables found:', existingTables.length > 0 ? existingTables.join(', ') : 'NONE');

    const requiredTables = ['users', 'conversations', 'messages'];
    const missingTables = requiredTables.filter(t => !existingTables.includes(t));

    if (missingTables.length > 0) {
      console.log('  ❌ MISSING TABLES:', missingTables.join(', '));
    } else {
      console.log('  ✅ All required tables exist\n');
    }

    // ============================================================================
    // 2. Check users table structure
    // ============================================================================
    if (existingTables.includes('users')) {
      console.log('👤 Checking users table...');
      const usersSchema = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'users'
        ORDER BY ordinal_position
      `);

      console.log('  Columns:');
      usersSchema.rows.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        console.log(`    - ${col.column_name} (${col.data_type}) ${nullable}`);
      });

      // Check if id is UUID or SERIAL
      const idColumn = usersSchema.rows.find(c => c.column_name === 'id');
      if (idColumn) {
        if (idColumn.data_type === 'integer') {
          console.log('  ⚠️  WARNING: users.id is INTEGER (SERIAL) - should migrate to UUID');

          // Check if uuid column exists
          const uuidColumn = usersSchema.rows.find(c => c.column_name === 'uuid');
          if (uuidColumn) {
            console.log('  ✅ users.uuid column exists (migration helper)');
          } else {
            console.log('  ❌ users.uuid column MISSING - run migration');
          }
        } else if (idColumn.data_type === 'uuid') {
          console.log('  ✅ users.id is UUID (correct)');
        }
      }

      // Check required columns
      const requiredUserColumns = ['id', 'google_id', 'email', 'name'];
      const userColumns = usersSchema.rows.map(c => c.column_name);
      const missingUserColumns = requiredUserColumns.filter(c => !userColumns.includes(c));

      if (missingUserColumns.length > 0) {
        console.log('  ❌ MISSING COLUMNS:', missingUserColumns.join(', '));
      } else {
        console.log('  ✅ All required user columns exist');
      }
      console.log();
    }

    // ============================================================================
    // 3. Check conversations table structure
    // ============================================================================
    if (existingTables.includes('conversations')) {
      console.log('💬 Checking conversations table...');
      const conversationsSchema = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'conversations'
        ORDER BY ordinal_position
      `);

      console.log('  Columns:');
      conversationsSchema.rows.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        console.log(`    - ${col.column_name} (${col.data_type}) ${nullable}`);
      });

      // Check for user_id column
      const userIdColumn = conversationsSchema.rows.find(c => c.column_name === 'user_id');
      if (userIdColumn) {
        console.log(`  ✅ user_id column exists (${userIdColumn.data_type})`);

        if (userIdColumn.data_type !== 'uuid') {
          console.log('  ⚠️  WARNING: user_id should be UUID type');
        }

        if (userIdColumn.is_nullable === 'YES') {
          console.log('  ⚠️  WARNING: user_id should be NOT NULL');
        }
      } else {
        console.log('  ❌ user_id column MISSING - run migration');
      }

      // Check required columns
      const requiredConvColumns = ['id', 'user_id', 'agent_type', 'created_at', 'updated_at'];
      const convColumns = conversationsSchema.rows.map(c => c.column_name);
      const missingConvColumns = requiredConvColumns.filter(c => !convColumns.includes(c));

      if (missingConvColumns.length > 0) {
        console.log('  ❌ MISSING COLUMNS:', missingConvColumns.join(', '));
      } else {
        console.log('  ✅ All required conversation columns exist');
      }
      console.log();
    }

    // ============================================================================
    // 4. Check messages table structure
    // ============================================================================
    if (existingTables.includes('messages')) {
      console.log('💬 Checking messages table...');
      const messagesSchema = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'messages'
        ORDER BY ordinal_position
      `);

      console.log('  Columns:');
      messagesSchema.rows.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL';
        console.log(`    - ${col.column_name} (${col.data_type}) ${nullable}`);
      });

      // Check required columns
      const requiredMsgColumns = ['id', 'conversation_id', 'role', 'content', 'created_at'];
      const msgColumns = messagesSchema.rows.map(c => c.column_name);
      const missingMsgColumns = requiredMsgColumns.filter(c => !msgColumns.includes(c));

      if (missingMsgColumns.length > 0) {
        console.log('  ❌ MISSING COLUMNS:', missingMsgColumns.join(', '));
      } else {
        console.log('  ✅ All required message columns exist');
      }
      console.log();
    }

    // ============================================================================
    // 5. Check indexes
    // ============================================================================
    console.log('📇 Checking indexes...');
    const indexesResult = await pool.query(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE tablename IN ('users', 'conversations', 'messages')
      ORDER BY tablename, indexname
    `);

    console.log(`  Total indexes found: ${indexesResult.rows.length}`);

    const requiredIndexes = [
      'idx_users_google_id',
      'idx_conversations_user_id',
      'idx_conversations_updated_at',
      'idx_messages_conversation_id'
    ];

    const existingIndexNames = indexesResult.rows.map(r => r.indexname);
    const missingIndexes = requiredIndexes.filter(idx => !existingIndexNames.includes(idx));

    if (missingIndexes.length > 0) {
      console.log('  ⚠️  MISSING INDEXES:', missingIndexes.join(', '));
    } else {
      console.log('  ✅ All critical indexes exist');
    }

    // Show all indexes
    console.log('  Existing indexes:');
    const groupedIndexes = {};
    indexesResult.rows.forEach(row => {
      if (!groupedIndexes[row.tablename]) {
        groupedIndexes[row.tablename] = [];
      }
      groupedIndexes[row.tablename].push(row.indexname);
    });

    Object.keys(groupedIndexes).sort().forEach(table => {
      console.log(`    ${table}: ${groupedIndexes[table].join(', ')}`);
    });
    console.log();

    // ============================================================================
    // 6. Check foreign key constraints
    // ============================================================================
    console.log('🔗 Checking foreign key constraints...');
    const foreignKeysResult = await pool.query(`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name IN ('conversations', 'messages')
      ORDER BY tc.table_name
    `);

    if (foreignKeysResult.rows.length === 0) {
      console.log('  ⚠️  No foreign key constraints found');
    } else {
      foreignKeysResult.rows.forEach(fk => {
        console.log(`  ✅ ${fk.table_name}.${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`);
      });
    }
    console.log();

    // ============================================================================
    // 7. Check triggers
    // ============================================================================
    console.log('⚡ Checking triggers...');
    const triggersResult = await pool.query(`
      SELECT trigger_name, event_object_table, action_timing, event_manipulation
      FROM information_schema.triggers
      WHERE event_object_table IN ('conversations', 'messages')
      ORDER BY trigger_name
    `);

    if (triggersResult.rows.length === 0) {
      console.log('  ⚠️  No triggers found');
    } else {
      triggersResult.rows.forEach(trigger => {
        console.log(`  ✅ ${trigger.trigger_name} (${trigger.action_timing} ${trigger.event_manipulation} on ${trigger.event_object_table})`);
      });
    }
    console.log();

    // ============================================================================
    // 8. Summary
    // ============================================================================
    console.log('=' .repeat(80));
    console.log('SUMMARY');
    console.log('=' .repeat(80));

    const allGood =
      missingTables.length === 0 &&
      missingIndexes.length === 0 &&
      foreignKeysResult.rows.length >= 2 &&
      triggersResult.rows.length >= 1;

    if (allGood) {
      console.log('✅ Database schema is fully configured for Phase 4');
      console.log('✅ User authentication and user-scoped conversations are ready');
    } else {
      console.log('⚠️  Database schema needs migration');
      console.log('\nRun the migration:');
      console.log('  psql "$POSTGRES_URL" -f database-migration-add-user-id.sql');
      console.log('\nOr use the Neon console:');
      console.log('  1. Copy contents of database-migration-add-user-id.sql');
      console.log('  2. Paste into Neon SQL Editor');
      console.log('  3. Click Run');
    }

  } catch (error) {
    console.error('❌ Error verifying schema:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run verification
verifySchema().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
