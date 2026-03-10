/**
 * Copy smart_tags from Neon database to Railway database
 * Much faster than re-tagging everything with Claude
 */

import { Client } from 'pg';
import { config } from 'dotenv';

config();

async function copyTags() {
  // Source: Neon (local DATABASE_URL in .env)
  const neonClient = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // Target: Railway (POSTGRES_URL from Railway variables)
  const railwayClient = new Client({
    connectionString: process.env.RAILWAY_DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔍 Connecting to Neon (source)...');
    await neonClient.connect();
    console.log('✅ Connected to Neon\n');

    console.log('🔍 Connecting to Railway (target)...');
    await railwayClient.connect();
    console.log('✅ Connected to Railway\n');

    // Get all grants with tags from Neon
    console.log('📥 Fetching smart_tags from Neon...');
    const neonResult = await neonClient.query(`
      SELECT grant_id, smart_tags
      FROM grants
      WHERE smart_tags IS NOT NULL
      ORDER BY grant_id
    `);

    console.log(`✅ Found ${neonResult.rows.length} grants with tags in Neon\n`);

    if (neonResult.rows.length === 0) {
      console.log('⚠️  No tags found in Neon database');
      return;
    }

    // Update Railway database
    console.log('📤 Copying tags to Railway...\n');

    let copied = 0;
    let notFound = 0;

    for (const row of neonResult.rows) {
      try {
        const result = await railwayClient.query(
          'UPDATE grants SET smart_tags = $1 WHERE grant_id = $2',
          [row.smart_tags, row.grant_id]
        );

        if (result.rowCount > 0) {
          copied++;
        } else {
          notFound++;
          console.warn(`⚠️  Grant ${row.grant_id} not found in Railway`);
        }

        if (copied % 50 === 0) {
          console.log(`   Progress: ${copied}/${neonResult.rows.length} (${Math.round(copied/neonResult.rows.length*100)}%)`);
        }

      } catch (error) {
        console.error(`❌ Error copying grant ${row.grant_id}:`, error.message);
      }
    }

    console.log(`\n✅ Copy complete!`);
    console.log(`   Copied: ${copied}`);
    console.log(`   Not found: ${notFound}`);
    console.log(`   Total: ${copied + notFound}\n`);

    // Verify
    console.log('🔍 Verifying Railway database...');
    const verifyResult = await railwayClient.query(`
      SELECT
        COUNT(*) as total,
        COUNT(smart_tags) as tagged
      FROM grants
    `);

    console.log(`   Total grants: ${verifyResult.rows[0].total}`);
    console.log(`   With tags: ${verifyResult.rows[0].tagged}`);
    console.log(`   Percentage: ${Math.round(verifyResult.rows[0].tagged / verifyResult.rows[0].total * 100)}%\n`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    await neonClient.end();
    await railwayClient.end();
    console.log('✅ Connections closed');
  }
}

copyTags();
