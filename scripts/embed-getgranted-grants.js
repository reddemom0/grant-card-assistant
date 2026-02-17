/**
 * Add Vector Embeddings to GetGranted Database
 *
 * Generates Voyage AI embeddings for all grants in the database
 * and stores them in the embedding column for semantic search.
 *
 * Cost: ~$0.05 for 598 grants (one-time)
 *
 * Usage:
 *   railway run node scripts/embed-getgranted-grants.js
 */

// Load environment variables BEFORE any imports
import 'dotenv/config';

import { VoyageAIClient } from 'voyageai';
import pg from 'pg';
const { Pool } = pg;

// Initialize clients
const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Stats
const stats = {
  total: 0,
  processed: 0,
  skipped: 0,
  errors: [],
  cost: 0
};

/**
 * Generate embedding for grant text
 */
async function generateEmbedding(text) {
  try {
    const response = await voyage.embed({
      input: text,
      model: 'voyage-3'
    });

    // Estimate cost: ~0.75 words per token, $0.10 per 1M tokens
    const estimatedTokens = text.split(' ').length / 0.75;
    stats.cost += (estimatedTokens / 1000000) * 0.10;

    return response.data[0].embedding;
  } catch (error) {
    console.error(`❌ Embedding failed: ${error.message}`);
    throw error;
  }
}

/**
 * Build searchable text from grant data for embedding.
 *
 * Includes recently_changed so the embedding captures current program status
 * (e.g. "program is closed", "intake open until March 31") — critical for
 * ranking currently-active programs above stale or closed ones in vector search.
 */
function buildGrantText(grant) {
  const parts = [];

  // Core identity fields
  parts.push(grant.grant_name);
  if (grant.grant_type) parts.push(`Type: ${grant.grant_type}`);
  if (grant.program_provider) parts.push(`Provider: ${grant.program_provider}`);
  if (grant.regions) parts.push(`Regions: ${grant.regions}`);
  if (grant.industries) parts.push(`Industries: ${grant.industries}`);
  if (grant.deadline) parts.push(`Deadline: ${grant.deadline}`);
  if (grant.grant_amount) parts.push(`Amount: ${grant.grant_amount}`);

  // Current status — most important for freshness signal
  // Include in full so "at capacity", "closed", "open until X" all get encoded
  if (grant.recently_changed) {
    parts.push(`Recent Status: ${grant.recently_changed.slice(0, 500)}`);
  }

  // Rich eligibility content (most important for semantic matching)
  if (grant.grant_criteria) {
    // Truncate criteria to 2000 chars — captures key eligibility without bloat
    const criteria = grant.grant_criteria.slice(0, 2000);
    parts.push(`Criteria: ${criteria}`);
  }

  if (grant.best_practices) {
    const practices = grant.best_practices.slice(0, 800);
    parts.push(`Best Practices: ${practices}`);
  }

  return parts.join('\n\n');
}

/**
 * Process a single grant
 */
async function processGrant(grant, index, total) {
  try {
    console.log(`\n[${index + 1}/${total}] ${Math.round((index / total) * 100)}%`);
    console.log(`📄 ${grant.grant_name} (ID: ${grant.grant_id})`);

    // Build text for embedding
    const text = buildGrantText(grant);
    console.log(`   📝 Text length: ${text.length} chars`);

    // Generate embedding
    const embedding = await generateEmbedding(text);
    console.log(`   ✅ Generated embedding (${embedding.length} dimensions)`);

    // Update database
    await pool.query(
      'UPDATE grants SET embedding = $1, updated_at = NOW() WHERE grant_id = $2',
      [JSON.stringify(embedding), grant.grant_id]
    );

    stats.processed++;
    console.log(`   💾 Saved to database`);

  } catch (error) {
    console.error(`   ❌ Failed: ${error.message}`);
    stats.errors.push({ grant_id: grant.grant_id, error: error.message });
    stats.skipped++;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 GETGRANTED VECTOR EMBEDDING GENERATION');
  console.log('='.repeat(80));
  console.log('\nAdding semantic search to GetGranted database...\n');

  try {
    // Fetch all currently-accepting grants for embedding.
    // We embed currently_accepting grants only — stale/archived grants don't
    // need vector search since they're filtered out at query time anyway.
    // recently_changed, deadline, and grant_amount are included in the embedding
    // text so vector search captures program status and funding signals.
    console.log('📊 Fetching grants from database...');
    const result = await pool.query(`
      SELECT grant_id, grant_name, grant_type, grant_amount,
             regions, industries, program_provider, deadline,
             grant_criteria, best_practices, recently_changed,
             is_active, currently_accepting
      FROM grants
      WHERE currently_accepting = true
         OR (currently_accepting IS NULL AND is_active = true)
      ORDER BY grant_id::integer
    `);

    const grants = result.rows;
    stats.total = grants.length;

    console.log(`✅ Found ${grants.length} currently-accepting grants to embed\n`);
    console.log('─'.repeat(80));
    console.log('Processing grants...\n');

    // Process in batches to avoid rate limits
    const BATCH_SIZE = 100;
    for (let i = 0; i < grants.length; i += BATCH_SIZE) {
      const batch = grants.slice(i, Math.min(i + BATCH_SIZE, grants.length));

      console.log(`\n📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(grants.length / BATCH_SIZE)}`);

      for (let j = 0; j < batch.length; j++) {
        await processGrant(batch[j], i + j, grants.length);

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('✅ EMBEDDING GENERATION COMPLETE');
    console.log('='.repeat(80));
    console.log(`\n📊 Statistics:`);
    console.log(`   Grants processed: ${stats.processed}/${stats.total}`);
    console.log(`   Grants skipped: ${stats.skipped}`);
    console.log(`\n💰 Cost:`);
    console.log(`   Voyage AI: $${stats.cost.toFixed(4)}`);

    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors: ${stats.errors.length}`);
      stats.errors.slice(0, 5).forEach(err => {
        console.log(`   • Grant ${err.grant_id}: ${err.error}`);
      });
    }

    console.log('\n🎉 Semantic search ready! Update the search endpoint to use vector search.\n');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
