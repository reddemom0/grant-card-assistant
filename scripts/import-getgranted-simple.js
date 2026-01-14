/**
 * Import GetGranted Data to Postgres (Simple - No Embeddings)
 *
 * Reads JSON export and imports directly to database.
 * Oracle (Claude) will handle intelligent matching - no embeddings needed!
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

config();

const { Pool } = pg;

async function importGrants() {
  console.log('📥 Importing GetGranted data to Postgres...\n');

  // Read export file
  console.log('1️⃣ Reading export file...');
  const exportPath = path.join(process.cwd(), 'data', 'getgranted-all-grants-by-id.json');
  const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
  console.log(`   Found ${exportData.total_grants} grants`);
  console.log(`   Active: ${exportData.active_grants}, Inactive: ${exportData.inactive_grants}\n`);

  // Connect to database
  console.log('2️⃣ Connecting to database...');
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_URL environment variable not set');
  }

  console.log(`   Using connection string from ${process.env.DATABASE_URL ? 'DATABASE_URL' : 'POSTGRES_URL'}`);

  const pool = new Pool({
    connectionString: connectionString,
    ssl: connectionString.includes('neon.tech') || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false
  });

  try {
    const client = await pool.connect();
    console.log('   ✅ Connected\n');

    // Clear existing data
    console.log('3️⃣ Clearing existing grants...');
    await client.query('DELETE FROM grants');
    console.log('   ✅ Table cleared\n');

    // Import grants (no embeddings)
    console.log('4️⃣ Importing grants...');
    let imported = 0;
    let failed = 0;

    for (let i = 0; i < exportData.grants.length; i++) {
      const grant = exportData.grants[i];

      // Skip grants with errors
      if (grant.error) {
        console.log(`   [${i}/${exportData.grants.length}] Skipping grant ${grant.grant_id} (error during export)`);
        failed++;
        continue;
      }

      // Progress indicator
      if (i % 10 === 0) {
        console.log(`   [${i}/${exportData.grants.length}] ${grant.grant_name}`);
      }

      try {
        // Insert into database with actual active/inactive status
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
          grant.is_active  // Use actual active/inactive status from scraper
        ]);

        imported++;

      } catch (error) {
        console.error(`   ❌ Failed to import grant ${grant.grant_id}: ${error.message}`);
        failed++;
      }
    }

    client.release();

    console.log('\n📊 Import Summary:');
    console.log(`   Total grants: ${exportData.grants.length}`);
    console.log(`   Imported: ${imported}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Success rate: ${Math.round(imported / exportData.grants.length * 100)}%`);

    // Verify import
    console.log('\n5️⃣ Verifying import...');
    const verifyClient = await pool.connect();

    const countResult = await verifyClient.query('SELECT COUNT(*) as count FROM grants');
    console.log(`   ✅ Database contains ${countResult.rows[0].count} grants`);

    // Check some statistics
    const withCriteria = await verifyClient.query('SELECT COUNT(*) as count FROM grants WHERE grant_criteria IS NOT NULL');
    console.log(`   ✅ ${withCriteria.rows[0].count} grants have criteria`);

    const withBestPractices = await verifyClient.query('SELECT COUNT(*) as count FROM grants WHERE best_practices IS NOT NULL');
    console.log(`   ✅ ${withBestPractices.rows[0].count} grants have best practices`);

    const byType = await verifyClient.query(`
      SELECT grant_type, COUNT(*) as count
      FROM grants
      WHERE grant_type IS NOT NULL
      GROUP BY grant_type
      ORDER BY count DESC
      LIMIT 5
    `);
    console.log('\n   📊 Top grant types:');
    byType.rows.forEach(row => {
      console.log(`      - ${row.grant_type}: ${row.count}`);
    });

    verifyClient.release();

    console.log('\n✅ Import complete!');
    console.log('\nNext steps:');
    console.log('  1. Create search function for Oracle');
    console.log('  2. Update Oracle tool to use database');
    console.log('  3. Test with sample queries');

  } catch (error) {
    console.error('❌ Import failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

importGrants()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });
