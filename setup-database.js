#!/usr/bin/env node

/**
 * Database Setup Script
 *
 * Executes database-schema.sql to create conversations and messages tables
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

function colorPrint(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function setupDatabase() {
  console.log('\n' + '='.repeat(60));
  colorPrint('Database Schema Setup', 'cyan');
  console.log('='.repeat(60) + '\n');

  // Check for required environment variable
  if (!process.env.POSTGRES_URL) {
    colorPrint('❌ Error: POSTGRES_URL environment variable not set', 'red');
    console.log('\nMake sure your .env file contains:');
    console.log('POSTGRES_URL=postgresql://user:password@host/database\n');
    process.exit(1);
  }

  // Create connection pool
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Test connection
    colorPrint('🔌 Connecting to database...', 'cyan');
    await pool.query('SELECT NOW()');
    colorPrint('✅ Connected successfully', 'green');

    // Read schema file
    colorPrint('\n📄 Reading database-schema.sql...', 'cyan');
    const schemaPath = path.join(__dirname, 'database-schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute schema
    colorPrint('🔧 Creating tables, indexes, and triggers...', 'cyan');
    await pool.query(schema);
    colorPrint('✅ Schema executed successfully', 'green');

    // Verify tables
    colorPrint('\n🔍 Verifying installation...', 'cyan');

    const tablesResult = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('conversations', 'messages')
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 2) {
      colorPrint('✅ Tables created:', 'green');
      tablesResult.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    } else {
      colorPrint('⚠️  Warning: Expected 2 tables, found ' + tablesResult.rows.length, 'yellow');
    }

    // Verify indexes
    const indexesResult = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('conversations', 'messages')
      AND indexname LIKE 'idx_%'
      ORDER BY indexname
    `);

    colorPrint('\n✅ Indexes created:', 'green');
    indexesResult.rows.forEach(row => {
      console.log(`   - ${row.indexname}`);
    });

    // Verify trigger
    const triggersResult = await pool.query(`
      SELECT trigger_name FROM information_schema.triggers
      WHERE event_object_table = 'messages'
      AND trigger_name = 'trigger_update_conversation_timestamp'
    `);

    if (triggersResult.rows.length > 0) {
      colorPrint('\n✅ Trigger created:', 'green');
      console.log(`   - ${triggersResult.rows[0].trigger_name}`);
    }

    // Check for users table
    const usersCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'users'
    `);

    if (usersCheck.rows.length === 0) {
      colorPrint('\n⚠️  Warning: "users" table not found', 'yellow');
      console.log('The conversations table references the users table.');
      console.log('Make sure to create the users table with your OAuth setup.\n');
      console.log('Example users table schema:');
      console.log(`
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
      `);
    } else {
      colorPrint('\n✅ Users table exists', 'green');
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    colorPrint('✅ Database Setup Complete!', 'green');
    console.log('='.repeat(60));

    console.log('\nNext Steps:');
    console.log('  1. Create API endpoints:');
    console.log('     - api/verify-auth.js');
    console.log('     - api/conversations.js');
    console.log('     - api/messages.js');
    console.log('  2. Update api/chat (or server.js) to use database');
    console.log('  3. Create public/auth.js module');
    console.log('  4. Update agent pages with conversation sidebar\n');

  } catch (error) {
    colorPrint('\n❌ Error during setup:', 'red');
    console.error(error.message);
    console.error('\nFull error:');
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  setupDatabase().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { setupDatabase };
