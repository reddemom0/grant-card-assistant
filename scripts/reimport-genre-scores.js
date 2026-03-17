/**
 * Re-import Genre Scores
 *
 * After database sync (DELETE + INSERT all grants), genre_scores column is NULL.
 * This function re-imports genre scores from the JSON export file.
 *
 * Should be run after every database sync, after smart_tags reimport.
 */

import fs from 'fs';
import path from 'path';

export async function reimportGenreScores(client) {
  console.log('🎯 Re-importing genre_scores from export file...');

  try {
    // Read genre_scores export file
    const exportPath = path.join(process.cwd(), 'data', 'genre-scores-all.json');

    if (!fs.existsSync(exportPath)) {
      console.log('   ⚠️  data/genre-scores-all.json not found - skipping genre score import');
      console.log('   💡 Run batch tagger to generate genre scores for all grants');
      return {
        imported: 0,
        failed: 0,
        unscored: 0,
        skipped: true
      };
    }

    const data = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    console.log(`   📊 Loaded ${data.total_scored} genre scores from export (exported ${data.exported_at})`);

    let imported = 0;
    let failed = 0;
    let notFound = 0;

    for (const result of data.results) {
      try {
        // Build genre_scores object (same structure as stored in DB)
        const genreScoresData = {
          scores: result.scores,
          association_scores: result.association_scores,
          scored_at: result.scored_at
        };

        const updateResult = await client.query(
          'UPDATE grants SET genre_scores = $1 WHERE grant_id = $2',
          [genreScoresData, result.grant_id]
        );

        if (updateResult.rowCount > 0) {
          imported++;
        } else {
          notFound++;
        }
      } catch (error) {
        failed++;
        console.error(`   ⚠️  Failed to import genre scores for grant ${result.grant_id}: ${error.message}`);
      }
    }

    // Count grants without genre scores (new programs since last export)
    const unscoredResult = await client.query(`
      SELECT COUNT(*) as count
      FROM grants
      WHERE genre_scores IS NULL
    `);
    const unscored = parseInt(unscoredResult.rows[0].count);

    console.log(`   ✅ Genre scores re-imported:`);
    console.log(`      Imported: ${imported}`);
    console.log(`      Not found: ${notFound} (grants removed since export)`);
    console.log(`      Failed: ${failed}`);

    if (unscored > 0) {
      console.log(`   ⚠️  Unscored grants: ${unscored} (new programs - need batch scoring)`);
      console.log(`   💡 Run: ANTHROPIC_API_KEY=... node scripts/genre-tagger-batch.js`);
    } else {
      console.log(`   ✅ All grants have genre scores`);
    }

    return {
      imported,
      failed,
      notFound,
      unscored,
      skipped: false
    };

  } catch (error) {
    console.error('   ❌ Error re-importing genre_scores:', error);
    throw error;
  }
}
