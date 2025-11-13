/**
 * Run Feedback Schema Migration on Staging Database
 *
 * This script creates the missing feedback tables in your staging database.
 *
 * Usage:
 *   node run-feedback-migration-staging.js
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the schema SQL
const schemaSQL = fs.readFileSync(
  path.join(__dirname, 'database-schema-feedback.sql'),
  'utf8'
);

async function runMigration() {
  console.log('🔧 Running feedback schema migration on staging database...\n');

  // Use DATABASE_URL from environment (should be staging)
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!databaseUrl) {
    console.error('❌ Error: DATABASE_URL not found in environment');
    console.error('   Make sure you have .env configured or pass DATABASE_URL');
    process.exit(1);
  }

  console.log(`📊 Connecting to database...`);
  console.log(`   Host: ${new URL(databaseUrl).hostname}`);

  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    console.log('📝 Creating feedback tables...');
    console.log('   - conversation_feedback');
    console.log('   - feedback_notes');
    console.log('   - indexes');
    console.log('   - comments\n');

    // Run the schema
    await client.query(schemaSQL);

    console.log('✅ Migration completed successfully!\n');
    console.log('📊 Verifying tables...');

    // Verify tables exist
    const checkTables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('conversation_feedback', 'feedback_notes')
      ORDER BY table_name
    `);

    console.log(`   Found ${checkTables.rows.length} tables:`);
    checkTables.rows.forEach(row => {
      console.log(`   ✓ ${row.table_name}`);
    });

    console.log('\n🎉 Staging database is now ready for feedback!');

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
