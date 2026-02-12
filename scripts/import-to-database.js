/**
 * Import GetGranted export to Postgres database
 * Usage: node scripts/import-to-database.js
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { Pool } = pg;

async function importToDatabase() {
  console.log('📥 Starting database import...\n');

  try {
    // Read export file
    console.log('1️⃣ Reading export file...');
    const exportPath = path.join(__dirname, '..', 'data', 'getgranted-all-grants-by-id.json');

    if (!fs.existsSync(exportPath)) {
      throw new Error('Export file not found at: ' + exportPath);
    }

    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    console.log(`   ✅ Found ${exportData.total_grants} grants\n`);

    // Connect to database
    console.log('2️⃣ Connecting to database...');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('neon.tech') || process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false
    });

    const client = await pool.connect();
    console.log('   ✅ Connected\n');

    // Clear existing data
    console.log('3️⃣ Clearing existing grants...');
    await client.query('DELETE FROM grants');
    console.log('   ✅ Cleared\n');

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

        if (imported % 100 === 0) {
          console.log(`   Imported ${imported}...`);
        }
      } catch (error) {
        console.error(`   ⚠️  Failed to import grant ${grant.grant_id}: ${error.message}`);
        failed++;
      }
    }

    console.log(`   ✅ Import complete\n`);

    // Verify
    console.log('5️⃣ Verifying database...');
    const countResult = await client.query('SELECT COUNT(*) as count FROM grants');
    const activeResult = await client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = true');
    const inactiveResult = await client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = false');

    console.log(`   Total grants in DB: ${countResult.rows[0].count}`);
    console.log(`   Active: ${activeResult.rows[0].count}`);
    console.log(`   Inactive: ${inactiveResult.rows[0].count}`);
    console.log(`   Imported: ${imported}`);
    console.log(`   Failed: ${failed}\n`);

    client.release();
    await pool.end();

    console.log('✅ Database import complete!\n');

  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

importToDatabase()
  .then(() => {
    console.log('🎉 All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
