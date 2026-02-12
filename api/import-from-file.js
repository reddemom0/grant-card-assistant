/**
 * API endpoint to import grants from JSON file to database
 * GET /api/import-from-file?key=<secret>
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

export default async function handler(req, res) {
  try {
    // Simple auth
    if (req.query.key !== process.env.JWT_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('📥 Starting import from file...');

    // Read export file
    const exportPath = path.join(process.cwd(), 'data', 'getgranted-all-grants-by-id.json');

    if (!fs.existsSync(exportPath)) {
      return res.status(404).json({ error: 'Export file not found' });
    }

    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    console.log(`Found ${exportData.total_grants} grants`);

    // Connect to database
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: false // Internal connection doesn't need SSL
    });

    const client = await pool.connect();
    console.log('Connected to database');

    // Clear and import
    await client.query('DELETE FROM grants');
    console.log('Cleared existing grants');

    let imported = 0;
    let failed = 0;

    for (const grant of exportData.grants) {
      if (grant.error) {
        failed++;
        continue;
      }

      try {
        await client.query(`
          INSERT INTO grants (
            grant_id, grant_name, grant_type, grant_amount, url,
            regions, industries, program_provider, deadline,
            max_spend, contribution_percentage, difficulty,
            grant_criteria, best_practices, recently_changed, full_page_text,
            last_updated, extracted_at, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `, [
          grant.grant_id, grant.grant_name, grant.grant_type, grant.grant_amount,
          grant.url, grant.regions, grant.industries, grant.program_provider,
          grant.deadline, grant.max_spend, grant.contribution_percentage,
          grant.difficulty, grant.grant_criteria, grant.best_practices,
          grant.recently_changed, grant.full_page_text, grant.last_updated,
          grant.extracted_at, grant.is_active
        ]);
        imported++;
      } catch (error) {
        console.error(`Failed to import grant ${grant.grant_id}:`, error.message);
        failed++;
      }
    }

    // Verify
    const countResult = await client.query('SELECT COUNT(*) as count FROM grants');
    const activeResult = await client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = true');

    client.release();
    await pool.end();

    console.log(`Import complete: ${imported} imported, ${failed} failed`);

    return res.status(200).json({
      success: true,
      imported,
      failed,
      total_in_db: parseInt(countResult.rows[0].count),
      active: parseInt(activeResult.rows[0].count),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Import failed:', error);
    return res.status(500).json({
      error: 'Import failed',
      message: error.message
    });
  }
}
