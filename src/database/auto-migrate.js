/**
 * Auto-Migration System
 * Automatically runs pending migrations on server startup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track which migrations have been applied
const appliedMigrations = new Set();

/**
 * Check if the conversations table exists
 */
async function checkTablesExist() {
  try {
    const result = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'conversations'
      );
    `);
    return result.rows[0].exists;
  } catch (error) {
    console.error('Error checking if tables exist:', error);
    return false;
  }
}

/**
 * Check if a migration has been applied by checking if the schema matches
 */
async function checkUserIdType() {
  try {
    const result = await query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'conversations'
      AND column_name = 'user_id'
    `);

    if (result.rows.length > 0) {
      return result.rows[0].data_type; // 'integer' or 'uuid'
    }
    return null;
  } catch (error) {
    console.error('Error checking user_id type:', error);
    return null;
  }
}

/**
 * Run a specific migration file
 */
async function runMigration(migrationFile) {
  try {
    const migrationPath = path.join(__dirname, '../../migrations', migrationFile);

    if (!fs.existsSync(migrationPath)) {
      console.warn(`⚠️  Migration file not found: ${migrationFile}`);
      return false;
    }

    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log(`🔧 Running migration: ${migrationFile}`);
    await query(sql);
    console.log(`✅ Migration completed: ${migrationFile}`);

    appliedMigrations.add(migrationFile);
    return true;
  } catch (error) {
    console.error(`❌ Migration failed: ${migrationFile}`, error);
    throw error;
  }
}

/**
 * Auto-apply necessary migrations based on current database state
 */
export async function autoMigrate() {
  try {
    console.log('\n🔍 Checking database schema...');

    // Check if initial schema exists
    const tablesExist = await checkTablesExist();

    if (!tablesExist) {
      console.log('⚠️  Database tables not found - creating initial schema...');
      await runMigration('000_initial_schema.sql');
      console.log('✅ Initial schema created successfully');
      return true;
    }

    console.log('✅ Database tables exist');

    // Check if user_id needs to be fixed
    const userIdType = await checkUserIdType();

    if (userIdType === 'uuid') {
      console.log('⚠️  Found UUID user_id - applying fix migrations...');

      // Apply migration 004 (fix conversations.user_id)
      await runMigration('004_fix_user_id_type.sql');

      // Apply migration 005 (fix users.id)
      await runMigration('005_fix_users_id_type.sql');

      console.log('✅ Schema migrations completed successfully');
      return true;
    } else if (userIdType === 'integer') {
      console.log('✅ Schema is up-to-date (user_id is INTEGER)');
      return false;
    } else {
      console.warn('⚠️  Could not determine user_id type');
      return false;
    }
  } catch (error) {
    console.error('❌ Auto-migration failed:', error);
    // Don't throw - allow server to start anyway
    return false;
  }
}
