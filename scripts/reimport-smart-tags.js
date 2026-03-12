/**
 * Re-import Smart Tags
 *
 * After database sync (DELETE + INSERT all grants), smart_tags column is NULL.
 * This function re-imports tags from the JSON export file.
 *
 * Should be run after every database sync, after currently_accepting heuristics.
 */

import fs from 'fs';
import path from 'path';

export async function reimportSmartTags(client) {
  console.log('🏷️  Re-importing smart_tags from export file...');

  try {
    // Read smart_tags export file
    const exportPath = path.join(process.cwd(), 'smart-tags-export.json');

    if (!fs.existsSync(exportPath)) {
      console.log('   ⚠️  smart-tags-export.json not found - skipping tag import');
      console.log('   💡 Run batch tagger to generate tags for all grants');
      return {
        imported: 0,
        failed: 0,
        untagged: 0,
        skipped: true
      };
    }

    const data = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    console.log(`   📊 Loaded ${data.total_count} tags from export (exported ${data.exported_at})`);

    let imported = 0;
    let failed = 0;
    let notFound = 0;

    for (const row of data.tags) {
      try {
        const result = await client.query(
          'UPDATE grants SET smart_tags = $1 WHERE grant_id = $2',
          [row.smart_tags, row.grant_id]
        );

        if (result.rowCount > 0) {
          imported++;
        } else {
          notFound++;
        }
      } catch (error) {
        failed++;
        console.error(`   ⚠️  Failed to import tag for grant ${row.grant_id}: ${error.message}`);
      }
    }

    // Count grants without tags (new programs since last tag export)
    const untaggedResult = await client.query(`
      SELECT COUNT(*) as count
      FROM grants
      WHERE smart_tags IS NULL
    `);
    const untagged = parseInt(untaggedResult.rows[0].count);

    console.log(`   ✅ Tags re-imported:`);
    console.log(`      Imported: ${imported}`);
    console.log(`      Not found: ${notFound} (grants removed since export)`);
    console.log(`      Failed: ${failed}`);

    if (untagged > 0) {
      console.log(`   ⚠️  Untagged grants: ${untagged} (new programs - need batch tagging)`);
      console.log(`   💡 Run: ANTHROPIC_API_KEY=... node src/services/grant-tagger-batch.js`);
    } else {
      console.log(`   ✅ All grants have tags`);
    }

    return {
      imported,
      failed,
      notFound,
      untagged,
      skipped: false
    };

  } catch (error) {
    console.error('   ❌ Error re-importing smart_tags:', error);
    throw error;
  }
}
