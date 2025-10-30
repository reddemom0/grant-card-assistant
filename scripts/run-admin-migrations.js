/**
 * Run Admin Migrations Script
 *
 * Applies admin-related database migrations to Railway PostgreSQL
 * Run with: node scripts/run-admin-migrations.js
 */

import { getPool, query } from '../src/database/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrations = [
  '005_add_admin_roles.sql',
  '006_add_usage_tracking.sql',
  '007_add_error_logging.sql',
  '008_add_audit_log.sql'
];

async function runMigrations() {
  console.log('🚀 Starting admin migrations...\n');

  try {
    // Test connection
    console.log('🔌 Testing database connection...');
    const pool = getPool();
    const testResult = await query('SELECT NOW() as time');
    console.log(`✅ Connected to database at ${testResult.rows[0].time}\n`);

    // Run each migration
    for (const migrationFile of migrations) {
      console.log(`📄 Running migration: ${migrationFile}`);

      const migrationPath = path.join(__dirname, '../migrations', migrationFile);
      const sql = fs.readFileSync(migrationPath, 'utf-8');

      try {
        await query(sql);
        console.log(`✅ ${migrationFile} completed successfully\n`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          console.log(`⚠️  ${migrationFile} appears to already be applied (skipping)\n`);
        } else {
          throw error;
        }
      }
    }

    console.log('✅ All migrations completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('1. Create your first admin user:');
    console.log('   node scripts/create-admin.js your-email@granted.com');
    console.log('2. Verify migrations:');
    console.log('   psql $DATABASE_URL -c "\\d users"');
    console.log('   psql $DATABASE_URL -c "\\d conversation_stats"');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  process.exit(0);
}

runMigrations();
