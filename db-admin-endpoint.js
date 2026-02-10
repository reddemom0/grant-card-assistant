/**
 * Database Admin Endpoint
 * Provides diagnostic and migration capabilities
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './src/database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function dbAdminEndpoint(req, res) {
  try {
    const { action, file, secret } = req.query;

    // Simple security check
    const expectedSecret = (process.env.MIGRATION_SECRET || process.env.JWT_SECRET || '').trim();
    const receivedSecret = (secret || '').trim();

    if (receivedSecret !== expectedSecret) {
      // Show first/last 4 chars for debugging
      const mask = (s) => s ? `${s.substring(0, 4)}...${s.substring(s.length - 4)}` : 'empty';
      return res.status(401).json({
        error: 'Unauthorized',
        debug: {
          receivedLength: receivedSecret.length,
          expectedLength: expectedSecret.length,
          receivedMask: mask(receivedSecret),
          expectedMask: mask(expectedSecret)
        }
      });
    }

    // Diagnose database
    if (action === 'diagnose') {
      console.log('🔍 Running database diagnostics...');

      // Check grants table structure
      const columnsResult = await query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'grants'
        ORDER BY ordinal_position
      `);

      const hasRecentlyChanged = columnsResult.rows.some(c => c.column_name === 'recently_changed');

      let testQueryResult = null;
      if (hasRecentlyChanged) {
        try {
          testQueryResult = await query(`
            SELECT grant_id, grant_name, recently_changed
            FROM grants
            LIMIT 2
          `);
        } catch (error) {
          testQueryResult = { error: error.message };
        }
      }

      const countResult = await query('SELECT COUNT(*) as count FROM grants');

      return res.json({
        success: true,
        database: {
          totalGrants: parseInt(countResult.rows[0].count),
          columns: columnsResult.rows.length,
          hasRecentlyChanged,
          columnList: columnsResult.rows.map(c => c.column_name),
          testQuery: hasRecentlyChanged ? testQueryResult : 'Column does not exist'
        }
      });
    }

    // Run migration
    if (action === 'migrate' && file) {
      const migrationPath = path.join(__dirname, 'migrations', file);

      if (!fs.existsSync(migrationPath)) {
        return res.status(404).json({ error: `Migration file not found: ${file}` });
      }

      const sql = fs.readFileSync(migrationPath, 'utf8');

      console.log(`🔧 Running migration: ${file}`);
      await query(sql);
      console.log(`✅ Migration completed: ${file}`);

      return res.json({
        success: true,
        message: `Migration ${file} executed successfully`
      });
    }

    return res.status(400).json({
      error: 'Invalid action',
      usage: 'GET /db-admin?action=diagnose&secret=XXX or GET /db-admin?action=migrate&file=XXX.sql&secret=XXX'
    });

  } catch (error) {
    console.error('DB Admin error:', error);
    return res.status(500).json({
      error: error.message,
      detail: error.detail,
      code: error.code
    });
  }
}
