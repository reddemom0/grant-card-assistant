/**
 * Grant Tagger Batch Processor
 * Processes all grants without smart_tags and generates structured tags
 */

import { Client } from 'pg';
import { tagGrant } from './grant-tagger.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);

// PostgreSQL connection
const client = new Client({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Rate limiting delay (ms)
const DELAY_MS = 500;

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main batch processing function
 */
async function processBatch() {
  try {
    console.log('🚀 Starting grant tagging batch process...\n');

    // Connect to database
    await client.connect();
    console.log('✅ Connected to database\n');

    // Get all programs without smart_tags
    const result = await client.query(`
      SELECT
        id,
        grant_id,
        grant_name,
        grant_type,
        grant_amount,
        grant_criteria,
        program_provider,
        regions,
        industries
      FROM grants
      WHERE smart_tags IS NULL
      ORDER BY id
    `);

    const programs = result.rows;
    const total = programs.length;

    console.log(`📊 Found ${total} programs to tag\n`);

    if (total === 0) {
      console.log('✅ All programs are already tagged!');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    // Process each program
    for (let i = 0; i < programs.length; i++) {
      const program = programs[i];
      const progress = i + 1;

      console.log(`\n[${progress}/${total}] Tagging: ${program.grant_name}`);

      try {
        // Generate tags
        const tags = await tagGrant(program);

        if (tags) {
          // Update database
          await client.query(
            `UPDATE grants SET smart_tags = $1 WHERE id = $2`,
            [JSON.stringify(tags), program.id]
          );

          console.log(`  ✅ Tagged ${progress}/${total}: ${program.grant_name}`);
          console.log(`     Intents: ${tags.primary_intents.join(', ')}`);
          console.log(`     Genres: ${tags.genres.join(', ')}`);
          console.log(`     Max funding: $${tags.max_funding_numeric.toLocaleString()}`);
          console.log(`     Complexity: ${tags.complexity}`);

          successCount++;
        } else {
          console.log(`  ⚠️  Failed to tag: ${program.grant_name} (null response)`);
          errorCount++;
        }
      } catch (error) {
        console.log(`  ❌ Error tagging ${program.grant_name}: ${error.message}`);
        errorCount++;
      }

      // Rate limiting delay (except for last item)
      if (i < programs.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Batch Processing Complete');
    console.log('='.repeat(60));
    console.log(`Total programs:     ${total}`);
    console.log(`Successfully tagged: ${successCount} (${((successCount / total) * 100).toFixed(1)}%)`);
    console.log(`Errors:             ${errorCount} (${((errorCount / total) * 100).toFixed(1)}%)`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
  } finally {
    await client.end();
    console.log('\n✅ Database connection closed');
  }
}

// Run if called directly
if (process.argv[1] === __filename) {
  processBatch()
    .then(() => {
      console.log('\n✅ Batch process completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Batch process failed:', error);
      process.exit(1);
    });
}

export { processBatch };
