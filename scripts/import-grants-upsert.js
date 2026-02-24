/**
 * Import GetGranted Grants — Smart Upsert
 *
 * Reads data/getgranted-all-grants.json (output of export-getgranted-all-grants.js)
 * and upserts into the grants table:
 *   - NEW grants are inserted
 *   - EXISTING grants have content columns updated, embedding preserved
 *
 * Does NOT delete any grants. Safe to run multiple times.
 *
 * Usage:
 *   railway run node scripts/import-grants-upsert.js
 *
 * After this, run embed-getgranted-grants.js to generate VoyageAI embeddings
 * for any new grants that don't have one yet.
 */

import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

async function importGrants() {
  console.log('📥 Importing GetGranted grants (smart upsert)...\n');

  // Read export file
  const exportPath = path.join(process.cwd(), 'data', 'getgranted-all-grants.json');
  if (!fs.existsSync(exportPath)) {
    console.error(`❌ Export file not found: ${exportPath}`);
    console.error('   Run: node scripts/export-getgranted-all-grants.js first');
    process.exit(1);
  }

  console.log('1️⃣  Reading export file...');
  const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
  const grants = exportData.grants || [];
  console.log(`   Found ${grants.length} grants in export`);
  console.log(`   Active: ${exportData.active_grants || '?'}, Inactive: ${exportData.inactive_grants || '?'}`);
  console.log(`   Exported at: ${exportData.exported_at || 'unknown'}\n`);

  // Connect to DB
  console.log('2️⃣  Connecting to database...');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  console.log('   ✅ Connected\n');

  try {
    // Snapshot existing grant IDs
    const existingResult = await client.query('SELECT grant_id FROM grants');
    const existingIds = new Set(existingResult.rows.map(r => r.grant_id));
    console.log(`3️⃣  DB currently has ${existingIds.size} grants\n`);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    console.log('4️⃣  Upserting grants...');

    for (let i = 0; i < grants.length; i++) {
      const grant = grants[i];

      // Skip error records
      if (grant.error) {
        skipped++;
        continue;
      }

      if (i % 50 === 0 && i > 0) {
        console.log(`   📊 Progress: ${i}/${grants.length} — inserted ${inserted}, updated ${updated}`);
      }

      const isNew = !existingIds.has(String(grant.grant_id));

      try {
        await client.query(`
          INSERT INTO grants (
            grant_id, grant_name, grant_type, grant_amount, url,
            regions, industries, program_provider, deadline,
            max_spend, contribution_percentage,
            grant_criteria, best_practices, full_page_text,
            last_updated, extracted_at, is_active, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
          ON CONFLICT (grant_id) DO UPDATE SET
            grant_name            = EXCLUDED.grant_name,
            grant_type            = EXCLUDED.grant_type,
            grant_amount          = EXCLUDED.grant_amount,
            url                   = EXCLUDED.url,
            regions               = EXCLUDED.regions,
            industries            = EXCLUDED.industries,
            program_provider      = EXCLUDED.program_provider,
            deadline              = EXCLUDED.deadline,
            max_spend             = EXCLUDED.max_spend,
            contribution_percentage = EXCLUDED.contribution_percentage,
            grant_criteria        = EXCLUDED.grant_criteria,
            best_practices        = EXCLUDED.best_practices,
            full_page_text        = EXCLUDED.full_page_text,
            last_updated          = EXCLUDED.last_updated,
            extracted_at          = EXCLUDED.extracted_at,
            is_active             = EXCLUDED.is_active,
            updated_at            = NOW()
            -- NOTE: embedding is intentionally NOT updated here.
            --       Preserve existing VoyageAI embeddings.
            --       Run embed-getgranted-grants.js after import to fill new grants.
        `, [
          String(grant.grant_id),
          grant.grant_name || 'Unknown',
          grant.grant_type   || null,
          grant.grant_amount || null,
          grant.url          || `https://app.getgranted.ca/grants/${grant.grant_id}`,
          grant.regions      || null,
          grant.industries   || null,
          grant.program_provider || null,
          grant.deadline     || null,
          grant.max_spend    || null,
          grant.contribution_percentage || null,
          grant.grant_criteria  || null,
          grant.best_practices  || null,
          grant.full_page_text  || null,
          grant.last_updated    || null,
          grant.extracted_at ? new Date(grant.extracted_at) : new Date(),
          grant.is_active !== undefined ? grant.is_active : true
        ]);

        if (isNew) inserted++;
        else updated++;

      } catch (err) {
        console.error(`   ❌ Grant ${grant.grant_id}: ${err.message}`);
        failed++;
      }
    }

    console.log('\n📊 Upsert complete:');
    console.log(`   Inserted (new): ${inserted}`);
    console.log(`   Updated (existing): ${updated}`);
    console.log(`   Skipped (errors): ${skipped}`);
    console.log(`   Failed: ${failed}`);

    // Badge exclusion filter:
    // Any grant in our DB that is NOT in the current export is no longer listed
    // on the platform. Mark it is_active=false so it won't surface in searches.
    console.log('\n5️⃣  Flagging stale grants (not in current export) as inactive...');
    const exportedIds = grants
      .filter(g => !g.error)
      .map(g => String(g.grant_id));

    const staleResult = await client.query(`
      UPDATE grants
      SET is_active = false, updated_at = NOW()
      WHERE grant_id != ALL($1::text[])
        AND is_active = true
      RETURNING grant_id, grant_name
    `, [exportedIds]);

    console.log(`   Flagged ${staleResult.rowCount} previously-active grants as inactive`);
    if (staleResult.rowCount > 0 && staleResult.rowCount <= 20) {
      staleResult.rows.forEach(r => console.log(`     • ${r.grant_id}: ${r.grant_name}`));
    } else if (staleResult.rowCount > 20) {
      console.log(`   (first 5: ${staleResult.rows.slice(0,5).map(r=>r.grant_name).join(', ')}...)`);
    }

    // Verify
    console.log('\n6️⃣  Verifying...');
    const countResult      = await client.query('SELECT COUNT(*) as total FROM grants');
    const activeResult     = await client.query('SELECT COUNT(*) as active FROM grants WHERE is_active = true');
    const inactiveResult   = await client.query('SELECT COUNT(*) as inactive FROM grants WHERE is_active = false');
    const acceptingResult  = await client.query('SELECT COUNT(*) as accepting FROM grants WHERE currently_accepting = true');
    const grant5129Result  = await client.query("SELECT grant_id, grant_name, is_active FROM grants WHERE grant_id = '5129'");

    console.log(`   Total grants in DB: ${countResult.rows[0].total}`);
    console.log(`   Active (is_active=true): ${activeResult.rows[0].active}`);
    console.log(`   Inactive (is_active=false): ${inactiveResult.rows[0].inactive}`);
    console.log(`   Currently accepting: ${acceptingResult.rows[0].accepting}`);
    if (grant5129Result.rows.length > 0) {
      const g = grant5129Result.rows[0];
      console.log(`   Grant 5129 (Alberta Youth Employment Incentive): ✅ IN DB — is_active=${g.is_active}`);
    } else {
      console.log('   Grant 5129: ❌ NOT IN DB');
    }

    console.log('\n✅ Import complete!');

  } finally {
    client.release();
    await pool.end();
  }
}

importGrants()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
  });
