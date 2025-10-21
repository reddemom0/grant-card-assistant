#!/usr/bin/env node

/**
 * Check Railway Database
 * Quick check to see if migration is needed
 */

import { config } from 'dotenv';
import pkg from 'pg';
const { Client } = pkg;

config();

async function checkRailwayDB() {
  // Get Railway database URL from environment
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  console.log('\n🔍 Checking Railway Database...\n');
  console.log(`Database: ${dbUrl.split('@')[1]?.split('/')[0] || 'unknown'}`);

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check for tables
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('conversations', 'messages', 'conversation_memory', 'users')
      ORDER BY table_name
    `);

    const tables = result.rows.map(r => r.table_name);

    console.log('Tables found:');
    const required = ['conversations', 'messages', 'conversation_memory'];

    let allPresent = true;
    for (const table of required) {
      if (tables.includes(table)) {
        console.log(`  ✅ ${table}`);
      } else {
        console.log(`  ❌ ${table} - MISSING!`);
        allPresent = false;
      }
    }

    if (tables.includes('users')) {
      console.log(`  ✅ users (optional)`);
    }

    console.log('\n' + '='.repeat(60));

    if (allPresent) {
      console.log('✅ ALL REQUIRED TABLES PRESENT');
      console.log('🚀 Ready to deploy!');
    } else {
      console.log('⚠️  MIGRATION NEEDED');
      console.log('\nRun this command:');
      console.log('  node migrations/run-migration.js');
    }

    console.log('='.repeat(60) + '\n');

    await client.end();
    process.exit(allPresent ? 0 : 1);

  } catch (error) {
    console.error('❌ Error:', error.message);
    await client.end();
    process.exit(1);
  }
}

checkRailwayDB();
