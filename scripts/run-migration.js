/**
 * Run a database migration file
 * Usage: railway run node scripts/run-migration.js migrations/009_deactivate_brandon_holden.sql
 */

import { readFileSync } from 'fs';
import { query } from '../src/database/connection.js';

async function runMigration(filePath) {
  try {
    console.log(`\n📄 Reading migration file: ${filePath}\n`);

    const sql = readFileSync(filePath, 'utf8');

    console.log('🔄 Executing migration...\n');
    console.log('---');

    await query(sql);

    console.log('---\n');
    console.log('✅ Migration completed successfully!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const migrationFile = process.argv[2];

if (!migrationFile) {
  console.log('Usage: node scripts/run-migration.js <path-to-migration.sql>');
  console.log('Example: node scripts/run-migration.js migrations/009_deactivate_brandon_holden.sql');
  process.exit(1);
}

runMigration(migrationFile);
