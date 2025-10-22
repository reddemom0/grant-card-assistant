/**
 * Temporary endpoint to run migrations on Railway
 * Usage: GET /run-migration?file=002_make_user_id_nullable.sql
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './src/database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrationEndpoint(req, res) {
  try {
    const { file, secret } = req.query;

    // Simple security check - use JWT_SECRET if MIGRATION_SECRET not set
    const migrationSecret = process.env.MIGRATION_SECRET || process.env.JWT_SECRET;
    if (secret !== migrationSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!file) {
      return res.status(400).json({ error: 'Missing file parameter' });
    }

    const migrationPath = path.join(__dirname, 'migrations', file);

    if (!fs.existsSync(migrationPath)) {
      return res.status(404).json({ error: `Migration file not found: ${file}` });
    }

    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log(`🔧 Running migration: ${file}`);
    await query(sql);
    console.log(`✅ Migration completed: ${file}`);

    res.json({
      success: true,
      message: `Migration ${file} executed successfully`
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      error: error.message,
      detail: error.detail
    });
  }
}
