/**
 * Sync GetGranted Database
 *
 * Runs the full export and import process to keep database up to date.
 * Should be run weekly via cron job or Railway scheduled task.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { config } from 'dotenv';
import { applyCurrentlyAcceptingHeuristics } from './apply-currently-accepting-heuristics.js';
import { reimportSmartTags } from './reimport-smart-tags.js';

config();

const execAsync = promisify(exec);
const { Pool } = pg;

async function syncDatabase() {
  console.log('🔄 Starting GetGranted database sync...\n');
  console.log(`⏰ Started at: ${new Date().toISOString()}\n`);

  try {
    // Step 1: Export all grants from GetGranted
    console.log('1️⃣ Exporting all grants from GetGranted...');
    console.log('   This will take 30-45 minutes for ~1000 IDs\n');

    const exportStart = Date.now();
    await execAsync('node scripts/export-all-grants-by-id.js');
    const exportDuration = Math.round((Date.now() - exportStart) / 1000 / 60);

    console.log(`   ✅ Export complete (${exportDuration} minutes)\n`);

    // Step 2: Check if export file exists
    console.log('2️⃣ Verifying export file...');
    const exportPath = path.join(process.cwd(), 'data', 'getgranted-all-grants-by-id.json');

    if (!fs.existsSync(exportPath)) {
      throw new Error('Export file not found!');
    }

    const exportData = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
    console.log(`   ✅ Found ${exportData.total_grants} grants`);
    console.log(`   📊 ${exportData.active_grants} active, ${exportData.inactive_grants} inactive\n`);

    // Step 3: Update database
    console.log('3️⃣ Updating database...');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });

    const client = await pool.connect();

    // Start transaction
    await client.query('BEGIN');

    try {
      // Clear existing data
      console.log('   Clearing old data...');
      await client.query('DELETE FROM grants');

      // Insert new data
      console.log('   Inserting new data...');
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
              last_updated, extracted_at, is_active,
              intake_cycle
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
            grant.is_active,
            grant.intake_cycle
          ]);

          imported++;

        } catch (error) {
          console.error(`   ⚠️  Failed to import grant ${grant.grant_id}: ${error.message}`);
          failed++;
        }
      }

      // Commit transaction
      await client.query('COMMIT');

      console.log(`   ✅ Database updated`);
      console.log(`      Imported: ${imported}`);
      console.log(`      Failed: ${failed}\n`);

      // Verify
      console.log('4️⃣ Verifying database...');
      const countResult = await client.query('SELECT COUNT(*) as count FROM grants');
      const activeResult = await client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = true');
      const inactiveResult = await client.query('SELECT COUNT(*) as count FROM grants WHERE is_active = false');

      console.log(`   ✅ Total grants in DB: ${countResult.rows[0].count}`);
      console.log(`   ✅ Active: ${activeResult.rows[0].count}`);
      console.log(`   ✅ Inactive: ${inactiveResult.rows[0].count}\n`);

      // Apply currently_accepting heuristics (migration 004)
      console.log('5️⃣ Applying currently_accepting heuristics...');
      const heuristicsResult = await applyCurrentlyAcceptingHeuristics(client);
      console.log(`   ✅ Heuristics complete\n`);

      // Re-import smart_tags from export file (migration 017)
      console.log('6️⃣ Re-importing smart_tags...');
      const tagsResult = await reimportSmartTags(client);
      console.log(`   ✅ Smart tags complete\n`);

      // Create sync log
      const syncSummary = {
        synced_at: new Date().toISOString(),
        duration_minutes: Math.round((Date.now() - exportStart) / 1000 / 60),
        total_grants: imported,
        active_grants: parseInt(activeResult.rows[0].count),
        inactive_grants: parseInt(inactiveResult.rows[0].count),
        currently_accepting: heuristicsResult.accepting,
        excluded: heuristicsResult.excluded,
        false_positives_caught: heuristicsResult.falsepositives,
        smart_tags_imported: tagsResult.imported,
        smart_tags_untagged: tagsResult.untagged,
        smart_tags_skipped: tagsResult.skipped || false,
        failed: failed,
        success: true
      };

      const logPath = path.join(process.cwd(), 'data', 'sync-log.json');
      const logs = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf-8')) : [];
      logs.unshift(syncSummary);

      // Keep last 30 sync logs
      if (logs.length > 30) logs.length = 30;

      fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));

      console.log('✅ Sync complete!');
      console.log(`⏱️  Total time: ${syncSummary.duration_minutes} minutes`);
      console.log(`📝 Log saved to: ${logPath}\n`);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await pool.end();
    }

  } catch (error) {
    console.error('❌ Sync failed:', error);
    console.error(error.stack);

    // Log failure
    const syncSummary = {
      synced_at: new Date().toISOString(),
      error: error.message,
      success: false
    };

    const logPath = path.join(process.cwd(), 'data', 'sync-log.json');
    const logs = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf-8')) : [];
    logs.unshift(syncSummary);
    if (logs.length > 30) logs.length = 30;
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));

    process.exit(1);
  }
}

syncDatabase()
  .then(() => {
    console.log('🎉 All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
