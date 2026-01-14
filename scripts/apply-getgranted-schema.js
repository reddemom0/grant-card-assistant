/**
 * Apply GetGranted Database Schema
 * Creates grants table with pgvector support
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

config();

const { Pool } = pg;

async function applySchema() {
  console.log('🔧 Applying GetGranted database schema...\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const client = await pool.connect();

    // Read the schema file
    const schemaPath = path.join(process.cwd(), 'migrations', '002_getgranted_full_schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    console.log('1️⃣ Enabling pgvector extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('   ✅ pgvector enabled\n');

    console.log('2️⃣ Creating grants table...');
    await client.query(schema);
    console.log('   ✅ Schema applied\n');

    // Verify table exists
    console.log('3️⃣ Verifying table structure...');
    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'grants'
      ORDER BY ordinal_position;
    `);

    console.log('   Grants table columns:');
    result.rows.forEach(row => {
      console.log(`      - ${row.column_name}: ${row.data_type}`);
    });

    // Check indexes
    console.log('\n4️⃣ Verifying indexes...');
    const indexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'grants';
    `);

    console.log(`   Found ${indexes.rows.length} indexes:`);
    indexes.rows.forEach(idx => {
      console.log(`      - ${idx.indexname}`);
    });

    client.release();
    console.log('\n✅ Schema applied successfully!');

  } catch (error) {
    console.error('❌ Schema application failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applySchema()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });
