/**
 * Admin endpoint to import GetGranted grants to Postgres
 * GET /api/admin-import-grants
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

export default async function handler(req, res) {
  console.log('🔐 Admin import request received');

  // Basic auth check (you can enhance this)
  const authHeader = req.headers.authorization;
  const expectedAuth = `Bearer ${process.env.ADMIN_API_KEY || 'granted-admin-2025'}`;

  if (authHeader !== expectedAuth) {
    console.log('❌ Unauthorized request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Read export file
    console.log('1️⃣ Reading export file...');
    const exportPath = path.join(process.cwd(), 'data', 'getgranted-all-grants-by-id.json');

    if (!fs.existsSync(exportPath)) {
      console.log('❌ Export file not found');
      return res.status(404).json({ error: 'Export file not found' });
    }

    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    console.log(`   Found ${exportData.total_grants} grants`);

    // Connect to database
    console.log('2️⃣ Connecting to database...');
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!connectionString) {
      return res.status(500).json({ error: 'DATABASE_URL not configured' });
    }

    const pool = new Pool({
      connectionString: connectionString,
      ssl: connectionString.includes('neon.tech') || process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false
    });

    const client = await pool.connect();
    console.log('   ✅ Connected');

    // Clear existing data
    console.log('3️⃣ Clearing existing grants...');
    await client.query('DELETE FROM grants');

    // Import grants
    console.log('4️⃣ Importing grants...');
    let imported = 0;
    let failed = 0;

    for (const grant of exportData.grants) {
      // Skip grants with errors
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
            grant_criteria, best_practices, full_page_text,
            last_updated, extracted_at, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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

    // Verify
    const countResult = await client.query('SELECT COUNT(*) as count FROM grants');
    const activeResult = await client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = true');
    const inactiveResult = await client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = false');

    client.release();
    await pool.end();

    const result = {
      success: true,
      total_grants: exportData.total_grants,
      imported,
      failed,
      database: {
        total: parseInt(countResult.rows[0].count),
        active: parseInt(activeResult.rows[0].count),
        inactive: parseInt(inactiveResult.rows[0].count)
      },
      timestamp: new Date().toISOString()
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
