/**
 * Endpoint to import GetGranted grants from JSON export
 * Usage: GET /import-grants?secret=<JWT_SECRET>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './src/database/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function importGrantsEndpoint(req, res) {
  try {
    const { secret } = req.query;

    // Security check - use JWT_SECRET
    console.log('🔐 Auth check:', {
      provided: secret?.substring(0, 10) + '...',
      expected: process.env.JWT_SECRET?.substring(0, 10) + '...',
      match: secret === process.env.JWT_SECRET
    });

    if (secret !== process.env.JWT_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('📥 Starting GetGranted import...');

    // Read export file
    const exportPath = path.join(__dirname, 'data', 'getgranted-all-grants-by-id.json');

    if (!fs.existsSync(exportPath)) {
      return res.status(404).json({ error: 'Export file not found' });
    }

    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    console.log(`   Found ${exportData.total_grants} grants in export`);

    // Clear existing data
    console.log('   Clearing existing grants...');
    await query('DELETE FROM grants');

    // Import grants
    let imported = 0;
    let failed = 0;

    for (const grant of exportData.grants) {
      // Skip grants with errors
      if (grant.error) {
        failed++;
        continue;
      }

      try {
        await query(`
          INSERT INTO grants (
            grant_id, grant_name, grant_type, grant_amount, url,
            regions, industries, program_provider, deadline,
            max_spend, contribution_percentage, difficulty,
            grant_criteria, best_practices, recently_changed, full_page_text,
            last_updated, extracted_at, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `, [
          grant.grant_id,
          grant.grant_name,
          grant.grant_type,
          grant.grant_amount,
          grant.url,
          grant.regions,
          grant.industries,
          grant.program_provider,
          grant.deadline,
          grant.max_spend,
          grant.contribution_percentage,
          grant.difficulty,
          grant.grant_criteria,
          grant.best_practices,
          grant.recently_changed,
          grant.full_page_text,
          grant.last_updated,
          grant.extracted_at,
          grant.is_active
        ]);

        imported++;
      } catch (error) {
        console.error(`Failed to import grant ${grant.grant_id}:`, error.message);
        failed++;
      }
    }

    // Verify import
    const countResult = await query('SELECT COUNT(*) as count FROM grants');
    const activeResult = await query('SELECT COUNT(*) as count FROM grants WHERE is_active = true');
    const inactiveResult = await query('SELECT COUNT(*) as count FROM grants WHERE is_active = false');

    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      source: {
        total_grants: exportData.total_grants,
        exported_at: exportData.exported_at
      },
      import: {
        imported,
        failed
      },
      database: {
        total: parseInt(countResult.rows[0].count),
        active: parseInt(activeResult.rows[0].count),
        inactive: parseInt(inactiveResult.rows[0].count)
      }
    };

    console.log('✅ Import complete:', result);

    return res.status(200).json(result);

  } catch (error) {
    console.error('❌ Import failed:', error);
    return res.status(500).json({
      error: 'Import failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
