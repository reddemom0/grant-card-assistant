#!/usr/bin/env node

/**
 * Migration Runner
 * Executes SQL migration files against the database
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

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

async function runMigration(migrationFile) {
  console.log('\n' + '='.repeat(60));
  colorPrint('Running Database Migration', 'cyan');
  console.log('='.repeat(60) + '\n');

  // Check for required environment variable
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    colorPrint('❌ Error: DATABASE_URL or POSTGRES_URL environment variable not set', 'red');
    console.log('\nMake sure your .env file contains:');
    console.log('DATABASE_URL=postgresql://user:password@host/database\n');
    process.exit(1);
  }

  // Create connection pool
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('neon.tech') || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false
  });

  try {
    // Test connection
    colorPrint('🔌 Connecting to database...', 'cyan');
    await pool.query('SELECT NOW()');
    colorPrint('✅ Connected successfully', 'green');

    // Read migration file
    const migrationPath = path.join(__dirname, migrationFile);
    colorPrint(`\n📄 Reading ${migrationFile}...`, 'cyan');

    if (!fs.existsSync(migrationPath)) {
      colorPrint(`❌ Migration file not found: ${migrationPath}`, 'red');
      process.exit(1);
    }

    const migration = fs.readFileSync(migrationPath, 'utf8');

    // Execute migration
    colorPrint('🔧 Executing migration...', 'cyan');
    await pool.query(migration);
    colorPrint('✅ Migration executed successfully', 'green');

    // Verify table exists
    colorPrint('\n🔍 Verifying installation...', 'cyan');
    const tableResult = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'conversation_memory'
    `);

    if (tableResult.rows.length > 0) {
      colorPrint('✅ Table created: conversation_memory', 'green');
    } else {
      colorPrint('⚠️  Warning: Table not found after migration', 'yellow');
    }

    // Show indexes
    const indexesResult = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'conversation_memory'
      ORDER BY indexname
    `);

    if (indexesResult.rows.length > 0) {
      colorPrint('\n✅ Indexes created:', 'green');
      indexesResult.rows.forEach(row => {
        console.log(`   - ${row.indexname}`);
      });
    }

    colorPrint('\n' + '='.repeat(60), 'green');
    colorPrint('Migration completed successfully!', 'green');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    colorPrint('\n❌ Migration failed:', 'red');
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Get migration file from command line or use default
const migrationFile = process.argv[2] || '001_add_conversation_memory.sql';
runMigration(migrationFile);
