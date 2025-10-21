#!/usr/bin/env node

/**
 * Database Verification Script
 * Checks that all required tables exist and are accessible
 */

import { config } from 'dotenv';
import { testConnection, query, closePool } from './src/database/connection.js';

config();

async function verifyDatabase() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 Database Verification');
  console.log('='.repeat(80) + '\n');

  try {
    // Test connection
    console.log('1. Testing database connection...');
    const connected = await testConnection();

    if (!connected) {
      console.error('❌ Database connection failed');
      process.exit(1);
    }

    // Check for required tables
    console.log('\n2. Checking required tables...');
    const result = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('conversations', 'messages', 'conversation_memory', 'users')
      ORDER BY table_name
    `);

    const tables = result.rows.map(r => r.table_name);

    console.log(`\n   Found ${tables.length} tables:`);

    const required = ['conversations', 'messages', 'conversation_memory'];
    for (const table of required) {
      if (tables.includes(table)) {
        console.log(`   ✅ ${table}`);
      } else {
        console.log(`   ❌ ${table} - MISSING!`);
      }
    }

    // Optional tables
    if (tables.includes('users')) {
      console.log(`   ✅ users (optional)`);
    }

    // Check conversation_memory indexes
    console.log('\n3. Checking conversation_memory indexes...');
    const indexResult = await query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'conversation_memory'
      ORDER BY indexname
    `);

    console.log(`   Found ${indexResult.rows.length} indexes:`);
    indexResult.rows.forEach(row => {
      console.log(`   ✅ ${row.indexname}`);
    });

    // Count records
    console.log('\n4. Checking record counts...');

    for (const table of ['conversations', 'messages', 'conversation_memory']) {
      if (tables.includes(table)) {
        const countResult = await query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`   ${table}: ${countResult.rows[0].count} records`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Database verification complete!');
    console.log('='.repeat(80) + '\n');

    await closePool();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    console.error(error);
    await closePool();
    process.exit(1);
  }
}

verifyDatabase();
